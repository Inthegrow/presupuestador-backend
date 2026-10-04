"""AI-powered plan analysis using GPT-4o Vision."""

from __future__ import annotations

import base64
import io
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile

from app.auth import require_editor
from app.calculations import calc_item_from_resources, calc_resource_subtotal
from app.config import get_settings
from app.db import get_data_db

router = APIRouter()
logger = logging.getLogger(__name__)

# Max image size: 4MB (after resize). GPT-4o Vision accepts up to 20MB but
# smaller is faster and cheaper.
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_DIMENSION = 2048  # px — resize larger images

ALLOWED_IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
ALLOWED_PDF_EXT = (".pdf",)
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXT + ALLOWED_PDF_EXT

_SYSTEM_PROMPT_BASE = """Sos un ingeniero civil senior con 20 años de experiencia en presupuestos de obra en Argentina.
Tu tarea es analizar este plano y generar la lista MÁS COMPLETA POSIBLE de ítems de presupuesto.

REGLA CRÍTICA: NO podés parar antes de haber cubierto las 14 categorías. Un edificio típico tiene MÍNIMO 50 ítems. Si generás menos de 50, estás siendo incompleto.

CHECKLIST OBLIGATORIO — debés generar ítems para CADA uno de estos puntos:

CATEGORÍA 1 — TAREAS PRELIMINARES (mínimo 3 ítems):
□ Obrador / cartel de obra
□ Replanteo y nivelación
□ Limpieza y preparación del terreno

CATEGORÍA 2 — MOVIMIENTO DE SUELOS (mínimo 3 ítems):
□ Excavación para fundaciones (m³)
□ Relleno y compactación (m³)
□ Retiro de tierra sobrante (m³)

CATEGORÍA 3 — ESTRUCTURA (mínimo 8 ítems):
□ Hormigón de limpieza (m³)
□ Fundaciones / zapatas (m³ hormigón por grado: H-21 o H-30)
□ Columnas planta baja (m³ hormigón)
□ Columnas plantas superiores (m³ hormigón) — si hay más de 1 planta
□ Vigas de encadenado (m³ hormigón)
□ Losa planta baja (m²)
□ Losa plantas superiores (m²) — una por planta
□ Escalera (m³ hormigón o gl)
□ Acero en barras (kg) — para toda la estructura

CATEGORÍA 4 — MAMPOSTERÍA (mínimo 3 ítems):
□ Muros exteriores (m²)
□ Muros interiores / tabiques (m²)
□ Dinteles (ml o u)

CATEGORÍA 5 — REVOQUES (mínimo 3 ítems):
□ Revoque grueso interior (m²)
□ Revoque fino interior / enlucido (m²)
□ Revoque exterior (m²)

CATEGORÍA 6 — CONTRAPISOS Y CARPETAS (mínimo 2 ítems):
□ Contrapiso sobre terreno (m²)
□ Carpeta de nivelación (m²)

CATEGORÍA 7 — INSTALACIÓN SANITARIA (mínimo 4 ítems):
□ Instalación agua fría (gl o m lineales)
□ Instalación agua caliente (gl)
□ Instalación desagüe cloacal (gl)
□ Instalación pluviales (gl)

CATEGORÍA 8 — INSTALACIÓN ELÉCTRICA (mínimo 4 ítems):
□ Tablero general (u)
□ Circuitos / cableado (gl o m)
□ Bocas de luz (u)
□ Tomas corriente (u)

CATEGORÍA 9 — INSTALACIÓN DE GAS (mínimo 2 ítems):
□ Cañería de gas (gl)
□ Ventilación artefactos (gl)

CATEGORÍA 10 — PISOS Y REVESTIMIENTOS (mínimo 3 ítems):
□ Piso cerámico / porcelanato (m²)
□ Revestimiento azulejo en baños y cocina (m²)
□ Zócalos (ml)

CATEGORÍA 11 — CIELORRASO (mínimo 2 ítems):
□ Cielorraso de yeso / durlock (m²)
□ Cielorraso suspendido en áreas húmedas (m²)

CATEGORÍA 12 — CARPINTERÍA (mínimo 3 ítems):
□ Puertas interiores (u)
□ Ventanas (u o m²)
□ Puerta de acceso principal (u)

CATEGORÍA 13 — PINTURA (mínimo 3 ítems):
□ Pintura interior paredes (m²)
□ Pintura interior cielorraso (m²)
□ Pintura exterior (m²)

CATEGORÍA 14 — VARIOS (mínimo 2 ítems):
□ Limpieza de obra (gl)
□ Conexión a redes (agua, cloaca, gas) (gl)

{catalog_context}

INSTRUCCIÓN FINAL: Antes de cerrar el JSON, verificá mentalmente que cubriste las 14 categorías y que tenés al menos 50 ítems en total. Si te faltan categorías, agregarlas.

Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta (sin markdown, sin texto extra):
{{
  "proyecto": {{
    "descripcion": "descripción breve del proyecto",
    "superficie_total_m2": number,
    "ambientes_detectados": ["ambiente1", "ambiente2"]
  }},
  "secciones": [
    {{
      "codigo": "1",
      "nombre": "Tareas Preliminares",
      "items": [
        {{
          "codigo": "1.1",
          "descripcion": "Obrador y cartel de obra",
          "unidad": "gl",
          "cantidad": 1,
          "confianza": "alta",
          "notas": "Incluye instalación eléctrica provisoria",
          "memoria_calculo": "Estimado global para obra de esta envergadura"
        }}
      ]
    }}
  ]
}}
{recursos_instruction}"""

_RECURSOS_INSTRUCTION_WITH_CATALOG = ""

_RECURSOS_INSTRUCTION_WITHOUT_CATALOG = ""


def _build_system_prompt(catalog_context: str) -> str:
    """Build the system prompt, injecting catalog context and matching instruction."""
    if catalog_context:
        return _SYSTEM_PROMPT_BASE.format(
            catalog_context=catalog_context,
            recursos_instruction=_RECURSOS_INSTRUCTION_WITH_CATALOG,
        )
    return _SYSTEM_PROMPT_BASE.format(
        catalog_context="",
        recursos_instruction=_RECURSOS_INSTRUCTION_WITHOUT_CATALOG,
    )


def _get_file_ext(filename: str | None) -> str:
    """Extract lowercase file extension with dot prefix."""
    if not filename or "." not in filename:
        return ""
    return "." + filename.lower().rsplit(".", 1)[-1]


def _resize_image_if_needed(content: bytes, ext: str) -> bytes:
    """Resize image if larger than MAX_DIMENSION in any direction."""
    try:
        from PIL import Image as PILImage

        img = PILImage.open(io.BytesIO(content))
        w, h = img.size
        if w <= MAX_DIMENSION and h <= MAX_DIMENSION and len(content) <= MAX_IMAGE_BYTES:
            return content

        # Calculate new size preserving aspect ratio
        ratio = min(MAX_DIMENSION / w, MAX_DIMENSION / h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.resize(new_size, PILImage.LANCZOS)

        buf = io.BytesIO()
        fmt = "JPEG" if ext in (".jpg", ".jpeg") else "PNG"
        img.save(buf, format=fmt, quality=85)
        return buf.getvalue()
    except ImportError:
        # Pillow not installed — send as-is
        logger.warning("Pillow not installed — skipping image resize")
        return content


def _pdf_pages_to_images(content: bytes) -> list[bytes]:
    """Extract ALL pages of PDF as PNG images, capped at MAX_DIMENSION px each.

    Returns a list of PNG bytes, one per page (max 8 pages).
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=content, filetype="pdf")
        pages_png: list[bytes] = []
        max_pages = min(len(doc), 16)  # cap at 16 pages for multi-plan buildings

        for page_num in range(max_pages):
            page = doc[page_num]
            rect = page.rect
            native_w, native_h = rect.width, rect.height
            max_native = max(native_w, native_h)
            scale = min(MAX_DIMENSION / max_native, 2.0) if max_native > 0 else 1.0
            mat = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat)
            png_bytes = pix.tobytes("png")
            pages_png.append(png_bytes)

        doc.close()
        return pages_png
    except ImportError:
        raise HTTPException(
            501,
            "Soporte PDF no disponible en el servidor. "
            "Subí el plano como imagen JPG o PNG.",
        )


def _load_catalog_context(db, org_id: str) -> str:
    """Load catalog entries for the org and return a formatted context string."""
    try:
        catalogs = (
            db.table("price_catalogs")
            .select("id,name")
            .eq("org_id", org_id)
            .execute()
        )
        if not catalogs.data:
            return ""

        catalog_ids = [c["id"] for c in catalogs.data]
        entries = (
            db.table("catalog_entries")
            .select("codigo,descripcion,unidad,precio_sin_iva,tipo")
            .in_("catalog_id", catalog_ids)
            .execute()
        )
        if not entries.data:
            return ""

        # Group by tipo
        by_tipo: dict[str, list[dict]] = {}
        for e in entries.data:
            tipo = e.get("tipo") or "material"
            by_tipo.setdefault(tipo, []).append(e)

        tipo_labels = {
            "material": "MATERIALES",
            "mano_obra": "MANO DE OBRA (jornal diario)",
            "equipo": "EQUIPOS (por día)",
            "subcontrato": "SUBCONTRATOS",
        }

        parts = []
        for tipo, label in tipo_labels.items():
            if tipo not in by_tipo:
                continue
            lines = []
            for e in by_tipo[tipo]:
                code = e.get("codigo") or "SIN-COD"
                desc = e.get("descripcion") or ""
                unit = e.get("unidad") or ""
                price = float(e.get("precio_sin_iva") or 0)
                lines.append(f"  - {code}: {desc}, {unit}, ${price:,.0f}")
            parts.append(f"\n{label}:\n" + "\n".join(lines))

        if not parts:
            return ""

        return "Tenés disponibles estos catálogos de precios:" + "".join(parts)
    except Exception:
        logger.warning("Failed to load catalog context", exc_info=True)
        return ""


def _normalize_recursos(raw_recursos: object) -> dict | None:
    """Normalize the recursos dict from AI response. Returns None if invalid/empty."""
    if not isinstance(raw_recursos, dict):
        return None

    normalized: dict[str, list] = {
        "materiales": [],
        "mano_obra": [],
        "equipos": [],
        "mo_materiales": [],
        "subcontratos": [],
    }

    def _safe_list(val: object) -> list:
        return val if isinstance(val, list) else []

    for mat in _safe_list(raw_recursos.get("materiales")):
        if not isinstance(mat, dict):
            continue
        normalized["materiales"].append({
            "codigo": str(mat.get("codigo") or ""),
            "descripcion": str(mat.get("descripcion") or ""),
            "unidad": str(mat.get("unidad") or "u"),
            "cantidad_por_unidad": float(mat.get("cantidad_por_unidad") or 0),
            "desperdicio_pct": float(mat.get("desperdicio_pct") or 0),
        })

    for mo in _safe_list(raw_recursos.get("mano_obra")):
        if not isinstance(mo, dict):
            continue
        normalized["mano_obra"].append({
            "codigo": str(mo.get("codigo") or ""),
            "descripcion": str(mo.get("descripcion") or ""),
            "trabajadores": float(mo.get("trabajadores") or 1),
            "dias_por_unidad": float(mo.get("dias_por_unidad") or 0),
            "cargas_sociales_pct": float(mo.get("cargas_sociales_pct") or 25),
        })

    for eq in _safe_list(raw_recursos.get("equipos")):
        if not isinstance(eq, dict):
            continue
        normalized["equipos"].append({
            "codigo": str(eq.get("codigo") or ""),
            "descripcion": str(eq.get("descripcion") or ""),
            "unidad": str(eq.get("unidad") or "día"),
            "cantidad_por_unidad": float(eq.get("cantidad_por_unidad") or 0),
            "desperdicio_pct": float(eq.get("desperdicio_pct") or 0),
        })

    for mom in _safe_list(raw_recursos.get("mo_materiales")):
        if not isinstance(mom, dict):
            continue
        normalized["mo_materiales"].append({
            "codigo": str(mom.get("codigo") or ""),
            "descripcion": str(mom.get("descripcion") or ""),
            "unidad": str(mom.get("unidad") or "u"),
            "cantidad_por_unidad": float(mom.get("cantidad_por_unidad") or 0),
            "desperdicio_pct": float(mom.get("desperdicio_pct") or 0),
        })

    for sub in _safe_list(raw_recursos.get("subcontratos")):
        if not isinstance(sub, dict):
            continue
        normalized["subcontratos"].append({
            "codigo": str(sub.get("codigo") or ""),
            "descripcion": str(sub.get("descripcion") or ""),
            "unidad": str(sub.get("unidad") or "gl"),
            "cantidad_por_unidad": float(sub.get("cantidad_por_unidad") or 0),
            "desperdicio_pct": float(sub.get("desperdicio_pct") or 0),
        })

    # Return None if all lists are empty (no point storing empty recursos)
    total = sum(len(v) for v in normalized.values())
    return normalized if total > 0 else None


@router.post("/{budget_id}/analyze-plan")
async def analyze_plan(
    budget_id: UUID,
    file: UploadFile = File(...),
    user: dict = Depends(require_editor),
):
    """Analyze a construction plan image with GPT-4o Vision."""
    settings = get_settings()
    client = settings.openai_client
    if client is None:
        raise HTTPException(
            503,
            "Análisis IA no disponible — OPENAI_API_KEY no está configurada.",
        )

    # Validate file type
    ext = _get_file_ext(file.filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Formato no soportado. Aceptamos: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Validate budget belongs to org
    db = get_data_db()
    org_id = user["org_id"]
    budget = (
        db.table("budgets")
        .select("id")
        .eq("id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    # Read file content
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(400, "El archivo es muy grande. Máximo 20 MB.")

    # Handle PDF: extract ALL pages as images
    image_contents: list[dict] = []  # list of {"b64": ..., "mime": ...}

    if ext in ALLOWED_PDF_EXT:
        pages = _pdf_pages_to_images(content)
        logger.info("PDF has %d page(s) — sending all to GPT-4o Vision", len(pages))
        for page_bytes in pages:
            # Validate each page size
            if len(page_bytes) > 10 * 1024 * 1024:
                logger.warning("PDF page too large (%d bytes), skipping", len(page_bytes))
                continue
            image_contents.append({
                "b64": base64.b64encode(page_bytes).decode("utf-8"),
                "mime": "image/png",
            })

        # Save first page to storage
        content = pages[0] if pages else content
    else:
        # Resize large images
        content = _resize_image_if_needed(content, ext)
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else f"image/{ext.lstrip('.')}"

        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(
                400,
                "El archivo procesado supera los 10 MB. "
                "Por favor, reducí la resolución del plano o exportalo como JPG de menor calidad antes de subirlo.",
            )

        image_contents.append({
            "b64": base64.b64encode(content).decode("utf-8"),
            "mime": mime,
        })

    if not image_contents:
        raise HTTPException(400, "No se pudo procesar el archivo. Verificá que sea un PDF o imagen válida.")

    # Save plan image to Supabase Storage (non-fatal)
    try:
        import uuid as uuid_mod
        file_ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "png"
        storage_path = f"plans/{budget_id}/{uuid_mod.uuid4().hex[:8]}.{file_ext}"
        db.storage.from_("plans").upload(
            storage_path,
            content,
            {"content-type": file.content_type or "image/png"},
        )
        db.table("budgets").update({"source_file": storage_path}).eq("id", str(budget_id)).execute()
    except Exception as e:
        # Non-fatal — continue even if storage fails
        logger.warning("Could not save plan to storage: %s", e)

    # Load user's catalog entries to inject context into the prompt
    catalog_context = _load_catalog_context(db, org_id)
    if catalog_context:
        logger.info("Catalog context loaded (%d chars) for org %s", len(catalog_context), org_id)
    else:
        logger.info("No catalog context found for org %s — proceeding without it", org_id)

    system_prompt = _build_system_prompt(catalog_context)

    # Build message content: text prompt + all images
    num_pages = len(image_contents)
    page_note = f"\n\nNOTA: Te estoy enviando {num_pages} página(s) del plano. Analizá TODAS las páginas en conjunto para generar la lista COMPLETA de ítems." if num_pages > 1 else ""

    message_content: list[dict] = [
        {"type": "text", "text": system_prompt + page_note},
    ]
    for img in image_contents:
        message_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{img['mime']};base64,{img['b64']}"},
        })

    # Call GPT-4o Vision with timeout
    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL_VISION,
            messages=[
                {
                    "role": "user",
                    "content": message_content,
                }
            ],
            max_tokens=16384,
            temperature=0,
            timeout=180,
        )
    except Exception as e:
        logger.error("OpenAI API error: %s", str(e))
        raise HTTPException(
            502,
            "Error al comunicarse con la IA. Intentá de nuevo en unos segundos.",
        )

    raw = response.choices[0].message.content or ""
    logger.info("AI raw response length: %d chars", len(raw))
    logger.debug("AI raw response: %s", raw[:2000])

    # Check if response was truncated
    finish_reason = response.choices[0].finish_reason
    if finish_reason == "length":
        logger.warning("AI response was TRUNCATED (finish_reason=length). Response length: %d chars", len(raw))

    # Extract JSON from response (handle markdown code blocks)
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.error("Failed to parse AI response as JSON: %s", cleaned[:500])
        raise HTTPException(
            422,
            "La IA no devolvió un formato válido. Intentá con otra imagen más clara.",
        )

    # Validate structure
    if not isinstance(data, dict) or "secciones" not in data:
        # Backwards compat: if it returned a flat array, wrap it
        if isinstance(data, list):
            data = {
                "proyecto": {
                    "descripcion": "Análisis de plano",
                    "superficie_total_m2": 0,
                    "ambientes_detectados": [],
                },
                "secciones": [
                    {
                        "codigo": "1",
                        "nombre": "Items detectados",
                        "items": [
                            {
                                "codigo": s.get("code", f"1.{i+1}"),
                                "descripcion": s.get("description", ""),
                                "unidad": s.get("unidad", "u"),
                                "cantidad": float(s.get("cantidad_estimada", s.get("cantidad", 1))),
                                "confianza": "media",
                                "notas": "",
                                "notas_calculo": "",
                            }
                            for i, s in enumerate(data)
                            if isinstance(s, dict) and s.get("description")
                        ],
                    }
                ],
            }
        else:
            raise HTTPException(
                422,
                "La IA devolvió una estructura no reconocida. Intentá con otra imagen.",
            )

    # Normalize and validate sections
    proyecto = data.get("proyecto", {})
    secciones = data.get("secciones", [])

    normalized_sections = []
    for sec in secciones:
        if not isinstance(sec, dict):
            continue
        items = []
        for item in sec.get("items", []):
            if not isinstance(item, dict) or not item.get("descripcion"):
                continue
            normalized_item: dict = {
                "codigo": str(item.get("codigo", "")),
                "descripcion": str(item["descripcion"]),
                "unidad": str(item.get("unidad", "u")),
                "cantidad": float(item.get("cantidad", 1)),
                "confianza": item.get("confianza", "media") if item.get("confianza") in ("alta", "media", "baja") else "media",
                "notas": str(item.get("notas", "")),
                "notas_calculo": str(item.get("memoria_calculo", "")),
            }
            # Extract and normalize recursos if present
            recursos = _normalize_recursos(item.get("recursos"))
            if recursos is not None:
                normalized_item["recursos"] = recursos
            items.append(normalized_item)
        if items:
            normalized_sections.append({
                "codigo": str(sec.get("codigo", "")),
                "nombre": str(sec.get("nombre", "Sin nombre")),
                "items": items,
            })

    total_items = sum(len(s["items"]) for s in normalized_sections)

    # Try to match each item against the org's template library
    templates: list[dict] = []
    try:
        templates_result = (
            db.table("item_templates")
            .select("id,nombre,unidad,categoria,recursos")
            .eq("org_id", org_id)
            .execute()
        )
        templates = templates_result.data or []

        if templates:
            for section in normalized_sections:
                for item in section.get("items", []):
                    item_desc = (item.get("descripcion") or "").lower()
                    item_unit = (item.get("unidad") or "").lower()

                    best_match = None
                    best_score = 0

                    for tmpl in templates:
                        tmpl_name = (tmpl.get("nombre") or "").lower()
                        tmpl_unit = (tmpl.get("unidad") or "").lower()

                        # Simple keyword matching
                        score = 0
                        for word in tmpl_name.split():
                            if len(word) > 2 and word in item_desc:
                                score += 1
                        # Bonus for matching unit
                        if tmpl_unit and tmpl_unit == item_unit:
                            score += 2

                        if score > best_score:
                            best_score = score
                            best_match = tmpl

                    if best_match and best_score >= 2:
                        item["template_match"] = {
                            "id": best_match["id"],
                            "nombre": best_match["nombre"],
                            "score": best_score,
                            "recursos": best_match.get("recursos", []),
                        }
    except Exception:
        pass  # Non-fatal

    return {
        "budget_id": str(budget_id),
        "proyecto": {
            "descripcion": proyecto.get("descripcion", ""),
            "superficie_total_m2": float(proyecto.get("superficie_total_m2", 0)),
            "ambientes_detectados": proyecto.get("ambientes_detectados", []),
        },
        "secciones": normalized_sections,
        "total_items": total_items,
        "catalog_loaded": bool(catalog_context),
        "templates_available": len(templates),
    }


def _find_catalog_entry(db, org_id: str, codigo: str) -> dict | None:
    """Try to find a catalog entry by codigo across all org catalogs."""
    if not codigo:
        return None
    try:
        catalogs = (
            db.table("price_catalogs")
            .select("id")
            .eq("org_id", org_id)
            .execute()
        )
        if not catalogs.data:
            return None
        catalog_ids = [c["id"] for c in catalogs.data]
        result = (
            db.table("catalog_entries")
            .select("id,precio_sin_iva")
            .in_("catalog_id", catalog_ids)
            .eq("codigo", codigo)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception:
        logger.warning("Catalog entry lookup failed for codigo=%s", codigo, exc_info=True)
        return None


def _create_resources_for_item(
    db,
    item_id: str,
    org_id: str,
    item_cantidad: float,
    recursos: dict,
) -> list[dict]:
    """Create item_resources rows from AI-generated recursos dict.

    Returns the list of inserted resource rows (may be empty on failure).
    """
    rows: list[dict] = []

    # ── materiales ──────────────────────────────────────────────────────────
    for mat in recursos.get("materiales", []):
        codigo = mat.get("codigo", "")
        qty_por_unidad = float(mat.get("cantidad_por_unidad") or 0)
        total_qty = qty_por_unidad * item_cantidad
        desperdicio_pct = float(mat.get("desperdicio_pct") or 0)

        catalog_entry = _find_catalog_entry(db, org_id, codigo)
        precio_unitario = float(catalog_entry["precio_sin_iva"]) if catalog_entry else 0.0
        catalog_entry_id = catalog_entry["id"] if catalog_entry else None

        resource = {
            "item_id": item_id,
            "org_id": org_id,
            "tipo": "material",
            "codigo": codigo,
            "descripcion": mat.get("descripcion", ""),
            "unidad": mat.get("unidad", "u"),
            "cantidad": total_qty,
            "desperdicio_pct": desperdicio_pct,
            "precio_unitario": precio_unitario,
            "catalog_entry_id": catalog_entry_id,
            "trabajadores": 0,
            "dias": 0,
            "cargas_sociales_pct": 0,
        }
        calc_resource_subtotal(resource)
        rows.append(resource)

    # ── mano_obra ───────────────────────────────────────────────────────────
    for mo in recursos.get("mano_obra", []):
        codigo = mo.get("codigo", "")
        trabajadores = float(mo.get("trabajadores") or 1)
        dias_por_unidad = float(mo.get("dias_por_unidad") or 0)
        total_dias = dias_por_unidad * item_cantidad
        cargas_sociales_pct = float(mo.get("cargas_sociales_pct") or 25)

        catalog_entry = _find_catalog_entry(db, org_id, codigo)
        precio_unitario = float(catalog_entry["precio_sin_iva"]) if catalog_entry else 0.0
        catalog_entry_id = catalog_entry["id"] if catalog_entry else None

        resource = {
            "item_id": item_id,
            "org_id": org_id,
            "tipo": "mano_obra",
            "codigo": codigo,
            "descripcion": mo.get("descripcion", ""),
            "unidad": "día",
            "cantidad": 0,
            "desperdicio_pct": 0,
            "precio_unitario": precio_unitario,
            "catalog_entry_id": catalog_entry_id,
            "trabajadores": trabajadores,
            "dias": total_dias,
            "cargas_sociales_pct": cargas_sociales_pct,
        }
        calc_resource_subtotal(resource)
        rows.append(resource)

    # ── equipos ─────────────────────────────────────────────────────────────
    for eq in recursos.get("equipos", []):
        codigo = eq.get("codigo", "")
        qty_por_unidad = float(eq.get("cantidad_por_unidad") or 0)
        total_qty = qty_por_unidad * item_cantidad
        desperdicio_pct = float(eq.get("desperdicio_pct") or 0)

        catalog_entry = _find_catalog_entry(db, org_id, codigo)
        precio_unitario = float(catalog_entry["precio_sin_iva"]) if catalog_entry else 0.0
        catalog_entry_id = catalog_entry["id"] if catalog_entry else None

        resource = {
            "item_id": item_id,
            "org_id": org_id,
            "tipo": "equipo",
            "codigo": codigo,
            "descripcion": eq.get("descripcion", ""),
            "unidad": eq.get("unidad", "día"),
            "cantidad": total_qty,
            "desperdicio_pct": desperdicio_pct,
            "precio_unitario": precio_unitario,
            "catalog_entry_id": catalog_entry_id,
            "trabajadores": 0,
            "dias": 0,
            "cargas_sociales_pct": 0,
        }
        calc_resource_subtotal(resource)
        rows.append(resource)

    # ── mo_materiales ───────────────────────────────────────────────────────
    for mom in recursos.get("mo_materiales", []):
        codigo = mom.get("codigo", "")
        qty_por_unidad = float(mom.get("cantidad_por_unidad") or 0)
        total_qty = qty_por_unidad * item_cantidad
        desperdicio_pct = float(mom.get("desperdicio_pct") or 0)

        catalog_entry = _find_catalog_entry(db, org_id, codigo)
        precio_unitario = float(catalog_entry["precio_sin_iva"]) if catalog_entry else 0.0
        catalog_entry_id = catalog_entry["id"] if catalog_entry else None

        resource = {
            "item_id": item_id,
            "org_id": org_id,
            "tipo": "mo_material",
            "codigo": codigo,
            "descripcion": mom.get("descripcion", ""),
            "unidad": mom.get("unidad", "u"),
            "cantidad": total_qty,
            "desperdicio_pct": desperdicio_pct,
            "precio_unitario": precio_unitario,
            "catalog_entry_id": catalog_entry_id,
            "trabajadores": 0,
            "dias": 0,
            "cargas_sociales_pct": 0,
        }
        calc_resource_subtotal(resource)
        rows.append(resource)

    # ── subcontratos ────────────────────────────────────────────────────────
    for sub in recursos.get("subcontratos", []):
        codigo = sub.get("codigo", "")
        qty_por_unidad = float(sub.get("cantidad_por_unidad") or 0)
        total_qty = qty_por_unidad * item_cantidad
        desperdicio_pct = float(sub.get("desperdicio_pct") or 0)

        catalog_entry = _find_catalog_entry(db, org_id, codigo)
        precio_unitario = float(catalog_entry["precio_sin_iva"]) if catalog_entry else 0.0
        catalog_entry_id = catalog_entry["id"] if catalog_entry else None

        resource = {
            "item_id": item_id,
            "org_id": org_id,
            "tipo": "subcontrato",
            "codigo": codigo,
            "descripcion": sub.get("descripcion", ""),
            "unidad": sub.get("unidad", "gl"),
            "cantidad": total_qty,
            "desperdicio_pct": desperdicio_pct,
            "precio_unitario": precio_unitario,
            "catalog_entry_id": catalog_entry_id,
            "trabajadores": 0,
            "dias": 0,
            "cargas_sociales_pct": 0,
        }
        calc_resource_subtotal(resource)
        rows.append(resource)

    if not rows:
        return []

    try:
        result = db.table("item_resources").insert(rows).execute()
        return result.data or []
    except Exception:
        logger.warning("Failed to insert resources for item %s", item_id, exc_info=True)
        return []


def _auto_assign_catalog_resources(
    db,
    item_id: str,
    org_id: str,
    item_desc: str,
    item_unidad: str,
    item_cantidad: float,
) -> list[dict]:
    """Auto-generate basic resources for an item by matching catalog entries.

    Uses simple keyword matching to find relevant materials and MO,
    then creates resources with catalog prices.
    Returns list of created resource rows.
    """
    try:
        # Load all catalog entries for this org
        catalogs = (
            db.table("price_catalogs")
            .select("id")
            .eq("org_id", org_id)
            .execute()
        )
        if not catalogs.data:
            return []

        catalog_ids = [c["id"] for c in catalogs.data]
        entries = (
            db.table("catalog_entries")
            .select("id,codigo,descripcion,unidad,precio_sin_iva,tipo")
            .in_("catalog_id", catalog_ids)
            .execute()
        )
        if not entries.data:
            return []

        desc_lower = item_desc.lower()
        rows: list[dict] = []

        # --- Step 1: Find best matching MATERIAL ---
        ITEM_MATERIAL_MAP = {
            "hormigón": ["hormigon", "h-21", "h-30", "h21", "h30"],
            "h-30": ["h-30", "h30", "hormigon"],
            "h-21": ["h-21", "h21", "hormigon"],
            "zapata": ["hormigon", "h-30", "h30"],
            "columna": ["hormigon", "h-30", "h30"],
            "viga": ["hormigon", "h-21", "h21"],
            "losa": ["hormigon", "h-21", "h21"],
            "escalera": ["hormigon", "h-21", "h21"],
            "mampostería": ["ladrillo", "LH"],
            "muro": ["ladrillo", "LH"],
            "tabique": ["ladrillo", "LH"],
            "revoque grueso": ["cemite", "cemento", "arena", "cal"],
            "revoque fino": ["cemite", "cemento", "arena", "cal"],
            "contrapiso": ["hormigon", "cemento", "arena"],
            "carpeta": ["cemento", "arena"],
            "piso": ["ceramico", "porcelanato", "pegamento"],
            "cerámico": ["ceramico", "pegamento"],
            "porcelanato": ["porcelanato", "pegamento"],
            "azulejo": ["ceramico", "azulejo", "pegamento"],
            "pintura": ["pintura", "latex", "rodillo"],
            "cielorraso": ["durlock", "placa", "perfil"],
            "durlock": ["durlock", "placa", "perfil"],
            "membrana": ["membrana", "asfaltica"],
            "puerta": ["puerta"],
            "ventana": ["ventana", "aluminio"],
            "excavación": [],
            "replanteo": [],
            "limpieza": [],
            "obrador": [],
        }

        match_keywords = []
        for key, keywords in ITEM_MATERIAL_MAP.items():
            if key in desc_lower:
                match_keywords.extend(keywords)
                break

        best_material = None
        best_score = 0
        for entry in entries.data:
            if entry.get("tipo") != "material":
                continue
            entry_desc = (entry.get("descripcion") or "").lower()
            entry_code = (entry.get("codigo") or "").lower()
            score = 0
            for kw in match_keywords:
                if kw.lower() in entry_desc or kw.lower() in entry_code:
                    score += 1
            if score > best_score:
                best_score = score
                best_material = entry

        if best_material and best_score >= 1:
            precio = float(best_material.get("precio_sin_iva") or 0)
            qty_per_unit = 1.0
            if item_unidad in ("m2", "m²"):
                qty_per_unit = 1.05
            elif item_unidad in ("m3", "m³"):
                qty_per_unit = 1.10
            elif item_unidad in ("ml", "m"):
                qty_per_unit = 1.05

            resource = {
                "item_id": item_id,
                "org_id": org_id,
                "tipo": "material",
                "codigo": best_material.get("codigo", ""),
                "descripcion": best_material.get("descripcion", ""),
                "unidad": best_material.get("unidad", "u"),
                "cantidad": qty_per_unit * item_cantidad,
                "desperdicio_pct": 5,
                "precio_unitario": precio,
                "catalog_entry_id": best_material.get("id"),
                "trabajadores": 0,
                "dias": 0,
                "cargas_sociales_pct": 0,
            }
            calc_resource_subtotal(resource)
            rows.append(resource)

        # --- Step 2: Always add MO (Oficial + Ayudante) ---
        mo_entries = {e.get("codigo", "").upper(): e for e in entries.data if e.get("tipo") == "mano_obra"}

        oficial = mo_entries.get("MO-OF")
        ayudante = mo_entries.get("MO-AY")

        dias_oficial = 0.5
        dias_ayudante = 0.5
        if any(kw in desc_lower for kw in ["hormigón", "h-30", "h-21", "zapata", "columna", "viga", "losa"]):
            dias_oficial = 0.8
            dias_ayudante = 1.0
        elif any(kw in desc_lower for kw in ["mampostería", "muro", "tabique"]):
            dias_oficial = 0.15
            dias_ayudante = 0.15
        elif any(kw in desc_lower for kw in ["revoque", "enlucido"]):
            dias_oficial = 0.12
            dias_ayudante = 0.10
        elif any(kw in desc_lower for kw in ["pintura", "latex"]):
            dias_oficial = 0.05
            dias_ayudante = 0.03
        elif any(kw in desc_lower for kw in ["piso", "cerám", "porcelan"]):
            dias_oficial = 0.15
            dias_ayudante = 0.10
        elif any(kw in desc_lower for kw in ["cielorraso", "durlock"]):
            dias_oficial = 0.20
            dias_ayudante = 0.15
        elif any(kw in desc_lower for kw in ["excavación", "movimiento"]):
            dias_oficial = 0.0
            dias_ayudante = 0.5

        if oficial and dias_oficial > 0:
            resource = {
                "item_id": item_id,
                "org_id": org_id,
                "tipo": "mano_obra",
                "codigo": "MO-OF",
                "descripcion": oficial.get("descripcion", "Oficial"),
                "unidad": "día",
                "cantidad": 0,
                "desperdicio_pct": 0,
                "precio_unitario": float(oficial.get("precio_sin_iva") or 0),
                "catalog_entry_id": oficial.get("id"),
                "trabajadores": 1,
                "dias": dias_oficial * item_cantidad,
                "cargas_sociales_pct": 25,
            }
            calc_resource_subtotal(resource)
            rows.append(resource)

        if ayudante and dias_ayudante > 0:
            resource = {
                "item_id": item_id,
                "org_id": org_id,
                "tipo": "mano_obra",
                "codigo": "MO-AY",
                "descripcion": ayudante.get("descripcion", "Ayudante"),
                "unidad": "día",
                "cantidad": 0,
                "desperdicio_pct": 0,
                "precio_unitario": float(ayudante.get("precio_sin_iva") or 0),
                "catalog_entry_id": ayudante.get("id"),
                "trabajadores": 1,
                "dias": dias_ayudante * item_cantidad,
                "cargas_sociales_pct": 25,
            }
            calc_resource_subtotal(resource)
            rows.append(resource)

        if not rows:
            return []

        result = db.table("item_resources").insert(rows).execute()
        return result.data or []
    except Exception:
        logger.warning("Failed to auto-assign catalog resources for item %s", item_id, exc_info=True)
        return []


@router.post("/{budget_id}/items/from-ai")
async def insert_ai_suggestions(
    budget_id: UUID,
    items: list[dict] = Body(..., embed=True),
    user: dict = Depends(require_editor),
):
    """Insert AI-suggested items into budget_items.

    Accepts a list of items, each with:
      - seccion_nombre: parent section name
      - seccion_codigo: parent section code
      - codigo, descripcion, unidad, cantidad, notas
      - recursos (optional): AI-generated resource composition
    Groups items by section and creates parent items for each section.
    After inserting resources, recalculates each item's unit prices from resources.
    """
    db = get_data_db()
    org_id = user["org_id"]

    budget_result = (
        db.table("budgets")
        .select("*")
        .eq("id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not budget_result.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    if not items:
        return {"inserted": 0, "sections_created": 0, "resources_created": 0}

    # Get current max sort_order
    existing = (
        db.table("budget_items")
        .select("sort_order")
        .eq("budget_id", str(budget_id))
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
    )
    base_sort = (existing.data[0]["sort_order"] + 100 if existing.data else 1000)

    # Group items by section
    sections_map: dict[str, list[dict]] = {}
    for item in items:
        sec_name = item.get("seccion_nombre", "Items IA")
        if sec_name not in sections_map:
            sections_map[sec_name] = []
        sections_map[sec_name].append(item)

    total_inserted = 0
    sections_created = 0
    total_resources_created = 0
    created_items: list[dict] = []  # Track items for cascade indirects

    for si, (sec_name, sec_items) in enumerate(sections_map.items()):
        sec_code = sec_items[0].get("seccion_codigo", str(si + 1))
        sort_base = base_sort + si * 100

        # Create parent/section item
        parent = (
            db.table("budget_items")
            .insert({
                "budget_id": str(budget_id),
                "org_id": org_id,
                "code": sec_code,
                "description": sec_name,
                "unidad": "gl",
                "cantidad": 1,
                "sort_order": sort_base,
                "notas": "Sección generada por IA",
            })
            .execute()
        )
        parent_id = parent.data[0]["id"] if parent.data else None
        sections_created += 1

        # Create child items, then add resources
        for ii, item in enumerate(sec_items):
            item_cantidad = float(item.get("cantidad", 1))
            row = {
                "budget_id": str(budget_id),
                "org_id": org_id,
                "code": item.get("codigo", f"{sec_code}.{ii + 1}"),
                "description": item.get("descripcion", "Item IA"),
                "unidad": item.get("unidad", "u"),
                "cantidad": item_cantidad,
                "notas": item.get("notas", "Sugerido por IA"),
                "notas_calculo": item.get("notas_calculo", ""),
                "sort_order": sort_base + ii + 1,
                "mat_unitario": 0,
                "mo_unitario": 0,
                "mat_total": 0,
                "mo_total": 0,
                "directo_total": 0,
                "neto_total": 0,
            }
            if parent_id:
                row["parent_id"] = parent_id

            result = db.table("budget_items").insert(row).execute()
            if not result.data:
                continue
            total_inserted += 1
            new_item_id = result.data[0]["id"]
            created_items.append(result.data[0])

            # Create resources if the item has them
            item_resources_count = 0
            recursos = item.get("recursos")
            if isinstance(recursos, dict):
                inserted_resources = _create_resources_for_item(
                    db,
                    item_id=new_item_id,
                    org_id=org_id,
                    item_cantidad=item_cantidad,
                    recursos=recursos,
                )
                resources_count = len(inserted_resources)
                total_resources_created += resources_count
                item_resources_count = resources_count

                if resources_count > 0:
                    # Recalculate item unit prices from the inserted resources
                    try:
                        calc_item_from_resources(row, inserted_resources)
                        db.table("budget_items").update({
                            "mat_unitario": row.get("mat_unitario", 0),
                            "mo_unitario": row.get("mo_unitario", 0),
                            "mat_total": row.get("mat_total", 0),
                            "mo_total": row.get("mo_total", 0),
                            "directo_total": row.get("directo_total", 0),
                            "neto_total": row.get("directo_total", 0),  # Will be recalculated by cascade
                        }).eq("id", new_item_id).execute()
                    except Exception:
                        logger.warning(
                            "Failed to recalculate item %s from resources",
                            new_item_id,
                            exc_info=True,
                        )

            # FALLBACK: If no resources were created (AI didn't generate any),
            # auto-assign from catalog based on item description
            if item_resources_count == 0:
                auto_resources = _auto_assign_catalog_resources(
                    db,
                    item_id=new_item_id,
                    org_id=org_id,
                    item_desc=item.get("descripcion", ""),
                    item_unidad=item.get("unidad", "u"),
                    item_cantidad=item_cantidad,
                )
                if auto_resources:
                    total_resources_created += len(auto_resources)
                    # Recalculate item from auto-assigned resources
                    try:
                        calc_item_from_resources(row, auto_resources)
                        db.table("budget_items").update({
                            "mat_unitario": row.get("mat_unitario", 0),
                            "mo_unitario": row.get("mo_unitario", 0),
                            "mat_total": row.get("mat_total", 0),
                            "mo_total": row.get("mo_total", 0),
                            "directo_total": row.get("directo_total", 0),
                            "neto_total": row.get("directo_total", 0),
                        }).eq("id", new_item_id).execute()
                    except Exception:
                        logger.warning(
                            "Failed to recalculate item %s from auto resources",
                            new_item_id,
                            exc_info=True,
                        )

    # After all items are inserted, apply cascade indirects
    if created_items:
        try:
            from app.budget_prices import budget_config
            from app.calculations import calc_cascade_indirects
            config = budget_config(db, org_id, budget_result.data)

            for item_row in created_items:
                if float(item_row.get("directo_total", 0)) > 0:
                    updated = calc_cascade_indirects(dict(item_row), config)
                    db.table("budget_items").update({
                        "indirecto_total": updated["indirecto_total"],
                        "beneficio_total": updated["beneficio_total"],
                        "impuestos_total": updated.get("impuestos_total", 0),
                        "neto_total": updated["neto_total"],
                        "iva_total": updated.get("iva_total", 0),
                        "total_final": updated.get("total_final", 0),
                    }).eq("id", item_row["id"]).execute()
        except Exception:
            logger.warning("Failed to apply cascade indirects after AI insertion", exc_info=True)

    return {
        "inserted": total_inserted,
        "sections_created": sections_created,
        "resources_created": total_resources_created,
    }
