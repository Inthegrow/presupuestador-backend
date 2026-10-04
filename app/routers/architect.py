"""ArquitectoAI — Multi-step construction plan analysis agent.

Pipeline:
  PASO 0:  Classify uploaded plans (arquitectura/estructura/cortes)
  PASO 1A: Architectural analysis (rooms, walls, openings per floor)
  PASO 1B: Structural analysis (one plan at a time → aggregate)
  PASO 1C: Section/cut analysis (heights, thicknesses, staircase)
  PASO 1D: Cross-reference synthesis → full cómputo métrico
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile

from app.auth import require_editor
from app.config import get_settings
from app.db import get_data_db
from app.routers.ai import _pdf_pages_to_images

router = APIRouter()
logger = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_json_response(raw: str) -> dict:
    """Strip markdown fences and parse JSON from an LLM response."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    return json.loads(cleaned)


def _validate_budget(budget_id: UUID, user: dict):
    """Check the budget exists and belongs to the user's org."""
    db = get_data_db()
    budget = (
        db.table("budgets")
        .select("id")
        .eq("id", str(budget_id))
        .eq("org_id", user["org_id"])
        .single()
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")


async def _extract_pages_b64(files: list[UploadFile]) -> tuple[list[str], list[str], list[list[str]]]:
    """Read PDFs and return (all_pages_b64, file_names, pages_per_file).

    pages_per_file[i] = list of base64 pages for file i.
    """
    all_b64: list[str] = []
    file_names: list[str] = []
    pages_per_file: list[list[str]] = []

    for f in files:
        ext = (f.filename or "").lower().rsplit(".", 1)[-1] if f.filename else ""
        if ext != "pdf":
            raise HTTPException(400, f"Solo se aceptan PDFs: {f.filename}")
        content = await f.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(400, f"Archivo muy grande (>20MB): {f.filename}")
        pages = _pdf_pages_to_images(content)
        if not pages:
            raise HTTPException(400, f"No se pudo leer el PDF: {f.filename}")
        file_b64 = [base64.b64encode(p).decode("utf-8") for p in pages]
        pages_per_file.append(file_b64)
        all_b64.extend(file_b64)
        file_names.append(f.filename or f"archivo_{len(file_names)+1}.pdf")

    return all_b64, file_names, pages_per_file


async def _call_vision(client, model: str, system_msg: str, prompt: str, images_b64: list[str], max_tokens: int = 8192) -> dict:
    """Send images + prompt to GPT-4o Vision and return parsed JSON."""
    user_content: list[dict] = [{"type": "text", "text": prompt}]
    for b64 in images_b64:
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
        })

    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_content},
    ]

    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=0,
        timeout=300,
    )

    raw = response.choices[0].message.content or ""
    finish_reason = response.choices[0].finish_reason
    logger.info("Vision response: %d chars, finish=%s", len(raw), finish_reason)

    if finish_reason == "length":
        logger.warning("Response truncated — consider raising max_tokens")

    return _parse_json_response(raw)


async def _call_text(client, model: str, system_msg: str, prompt: str, max_tokens: int = 16384) -> dict:
    """Send text-only prompt (no images) and return parsed JSON."""
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt},
        ],
        max_tokens=max_tokens,
        temperature=0,
        timeout=300,
    )
    raw = response.choices[0].message.content or ""
    return _parse_json_response(raw)


# ─── System prompts ──────────────────────────────────────────────────────────

_SYS_CLASSIFY = """Sos un ingeniero civil argentino senior con 20 años de experiencia en presupuestos de obra.
Clasificás planos de construcción por tipo. Siempre respondés con JSON válido."""

_SYS_ARCH = """Sos un ingeniero civil senior con 20 años de experiencia en presupuestos de obra en Argentina.
Tu tarea es analizar planos de arquitectura para generar un presupuesto detallado.
Siempre respondés con JSON válido, sin markdown, sin texto extra."""

_SYS_STRUCT = """Sos un ingeniero estructural senior con 20 años de experiencia en presupuestos de obra en Argentina.
Tu tarea es analizar planos de estructura para calcular volúmenes de hormigón y kilos de acero para el presupuesto.
Siempre respondés con JSON válido, sin markdown, sin texto extra."""

_SYS_SECTIONS = """Sos un ingeniero civil senior con 20 años de experiencia en presupuestos de obra en Argentina.
Tu tarea es analizar cortes y fachadas de edificios para extraer datos de presupuesto.
Siempre respondés con JSON válido, sin markdown, sin texto extra."""

_SYS_SYNTH = """Sos un ingeniero civil senior especialista en cómputo métrico y presupuestos de obra en Argentina.
Tu tarea es cruzar datos de distintos análisis de planos y generar el cómputo métrico COMPLETO y REALISTA de un edificio.
Siempre respondés con JSON válido, sin markdown, sin texto extra."""


# ─── PASO 0: Classification ──────────────────────────────────────────────────

_CLASSIFY_PROMPT = """Te voy a mostrar la PRIMERA PÁGINA de varios planos de un proyecto de construcción.
Clasificá cada plano según su tipo y extraé metadata clave.

TIPOS POSIBLES:
- "arquitectura": Plantas de arquitectura, distribución de ambientes, cotas, aberturas
- "estructura": Planos de estructura (fundaciones, columnas, vigas, losas, armaduras)
- "cortes": Cortes transversales/longitudinales, fachadas, contrafachadas
- "calculo_estructural": Planillas de cálculo, memorias de cálculo, tablas de armado

Las imágenes están en ORDEN (imagen 1 = archivo 1, imagen 2 = archivo 2, etc.)

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin texto extra):
{
  "clasificaciones": [
    {
      "indice": 0,
      "tipo": "arquitectura|estructura|cortes|calculo_estructural",
      "subtipo": "descripción breve (ej: 'Planta tipo 1ro y 2do piso')",
      "pisos_o_niveles": ["PB", "1", "2"],
      "elementos_detectados": ["columnas", "vigas", "losas"],
      "tiene_armaduras": false,
      "tiene_cotas": true,
      "confianza": "alta|media|baja",
      "notas": "observaciones relevantes"
    }
  ]
}"""


@router.post("/{budget_id}/classify")
async def classify_plans(
    budget_id: UUID,
    files: list[UploadFile] = File(...),
    user: dict = Depends(require_editor),
):
    """PASO 0: Classify multiple construction plan PDFs."""
    settings = get_settings()
    client = settings.openai_client
    if client is None:
        raise HTTPException(503, "IA no disponible — OPENAI_API_KEY no configurada.")
    if not files:
        raise HTTPException(400, "Enviá al menos un archivo PDF.")
    if len(files) > 20:
        raise HTTPException(400, "Máximo 20 archivos por clasificación.")

    _validate_budget(budget_id, user)

    # Extract first page from each PDF
    file_info: list[dict] = []
    first_pages_b64: list[str] = []

    for f in files:
        content = await f.read()
        pages = _pdf_pages_to_images(content)
        if not pages:
            raise HTTPException(400, f"No se pudo leer el PDF: {f.filename}")
        first_pages_b64.append(base64.b64encode(pages[0]).decode("utf-8"))
        file_info.append({
            "nombre_archivo": f.filename or f"archivo_{len(file_info)+1}.pdf",
            "paginas_total": len(pages),
            "tamano_bytes": len(content),
        })

    prompt = _CLASSIFY_PROMPT + f"\n\nSon {len(first_pages_b64)} archivos en total."

    logger.info("PASO 0: Classifying %d plans for budget %s", len(files), budget_id)

    try:
        data = await _call_vision(client, settings.OPENAI_MODEL_VISION, _SYS_CLASSIFY, prompt, first_pages_b64, max_tokens=4096)
    except json.JSONDecodeError:
        raise HTTPException(422, "La IA no devolvió un formato válido para clasificación.")
    except Exception as e:
        logger.error("OpenAI API error in classify: %s", e)
        raise HTTPException(502, "Error al comunicarse con la IA.")

    clasificaciones = data.get("clasificaciones", [])

    results = []
    for i, info in enumerate(file_info):
        clasif = clasificaciones[i] if i < len(clasificaciones) else {}
        results.append({
            **info,
            "tipo": clasif.get("tipo", "desconocido"),
            "subtipo": clasif.get("subtipo", ""),
            "pisos_o_niveles": clasif.get("pisos_o_niveles", []),
            "elementos_detectados": clasif.get("elementos_detectados", []),
            "tiene_armaduras": clasif.get("tiene_armaduras", False),
            "tiene_cotas": clasif.get("tiene_cotas", False),
            "confianza": clasif.get("confianza", "baja"),
            "notas": clasif.get("notas", ""),
        })

    grupos = {}
    for r in results:
        grupos.setdefault(r["tipo"], []).append(r["nombre_archivo"])

    return {
        "budget_id": str(budget_id),
        "total_archivos": len(results),
        "clasificaciones": results,
        "grupos": grupos,
    }


# ─── PASO 1A: Architecture ───────────────────────────────────────────────────

_ARCH_PROMPT = """Analizá estos planos de arquitectura de un edificio residencial.
Necesito extraer TODOS los datos medibles para armar el presupuesto de obra.

Para CADA PLANTA/NIVEL que aparezca:
1. Nombre del nivel y código (SS, PB, P1-P8, SM, TQ)
2. Superficie total, cubierta y semicubierta en m²
3. Lista de ambientes con nombre, dimensiones aproximadas y superficie
4. Metros lineales de muros (exteriores e interiores)
5. Aberturas: código, tipo (puerta/ventana), dimensiones, cantidad
6. Altura de piso a techo

REGLA: Si un dato no es legible en el plano, estimalo con sentido ingenieril y marcá "estimado".
Si varias plantas son iguales (planta tipo), indicalo en vez de repetir.

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin texto extra):
{
  "pisos": [
    {
      "nombre": "Planta Baja",
      "nivel": "PB",
      "superficie_total_m2": 250.0,
      "superficie_cubierta_m2": 230.0,
      "superficie_semicubierta_m2": 20.0,
      "altura_libre_m": 2.70,
      "es_planta_tipo": false,
      "aplica_a_pisos": [],
      "ambientes": [
        {"nombre": "Hall de acceso", "largo_m": 5.0, "ancho_m": 3.0, "superficie_m2": 15.0}
      ],
      "muros_exteriores_ml": 60.0,
      "muros_interiores_ml": 45.0,
      "aberturas": [
        {"codigo": "P1", "tipo": "puerta", "ancho_m": 0.80, "alto_m": 2.00, "cantidad": 4}
      ],
      "notas": ""
    }
  ],
  "resumen": {
    "total_pisos": 10,
    "superficie_total_edificio_m2": 2500.0,
    "total_departamentos": 32,
    "total_cocheras": 20,
    "total_aberturas": 150
  }
}"""


@router.post("/{budget_id}/analyze-architecture")
async def analyze_architecture(
    budget_id: UUID,
    files: list[UploadFile] = File(...),
    building_context: str = Body("", embed=True),
    user: dict = Depends(require_editor),
):
    """PASO 1A: Deep analysis of architecture plans."""
    settings = get_settings()
    client = settings.openai_client
    if client is None:
        raise HTTPException(503, "IA no disponible.")

    _validate_budget(budget_id, user)
    all_b64, file_names, _ = await _extract_pages_b64(files)

    if not all_b64:
        raise HTTPException(400, "No se pudieron extraer páginas de los PDFs.")

    logger.info("PASO 1A: %d pages from %d files", len(all_b64), len(files))

    prompt = _ARCH_PROMPT
    if building_context:
        prompt = f"Contexto del edificio: {building_context}\n\n" + prompt
    prompt += f"\n\nArchivos: {', '.join(file_names)}\nTotal páginas: {len(all_b64)}"

    try:
        data = await _call_vision(client, settings.OPENAI_MODEL_VISION, _SYS_ARCH, prompt, all_b64, max_tokens=16384)
    except json.JSONDecodeError:
        raise HTTPException(422, "La IA no devolvió JSON válido para análisis arquitectónico.")
    except Exception as e:
        logger.error("PASO 1A error: %s", e)
        raise HTTPException(502, "Error al comunicarse con la IA.")

    return {"budget_id": str(budget_id), "paso": "1A", "archivos": file_names, **data}


# ─── PASO 1B: Structure (one plan at a time) ─────────────────────────────────

_STRUCT_SINGLE_PROMPT = """Estoy armando el cómputo métrico de un edificio para el presupuesto de obra.
Este plano muestra parte de la estructura. Identificá TODOS los elementos estructurales visibles con sus dimensiones.

Para cada elemento extraé:
- Tipo (zapata/columna/viga/losa/escalera/encadenado/viga_fundacion)
- Código si es visible (Z1, C1, V1, etc.)
- Sección o dimensiones
- Cantidad de elementos iguales visibles
- Volumen unitario de hormigón en m³
- A qué nivel/planta corresponde

Ratios de acero CIRSOC para estimar kg: zapatas 65 kg/m³, columnas 120, vigas 130, losas 70, escalera 110.

Respondé ÚNICAMENTE con JSON válido (sin markdown):
{
  "plano_descripcion": "qué muestra este plano",
  "nivel_o_planta": "PB / Fundaciones / Piso Tipo / etc",
  "elementos": [
    {
      "tipo": "columna",
      "codigo": "C1",
      "seccion_cm": "30x40",
      "altura_o_luz_m": 2.70,
      "volumen_unitario_m3": 0.32,
      "kg_acero_unitario": 38.9,
      "cantidad": 8,
      "notas": ""
    }
  ],
  "hormigon_parcial_m3": 0,
  "acero_parcial_kg": 0
}"""


@router.post("/{budget_id}/analyze-structure")
async def analyze_structure(
    budget_id: UUID,
    files: list[UploadFile] = File(...),
    building_context: str = Body("", embed=True),
    user: dict = Depends(require_editor),
):
    """PASO 1B: Structural analysis — sends each plan individually then aggregates.

    GPT-4o refuses multiple structural plans at once, so we send one at a time.
    """
    settings = get_settings()
    client = settings.openai_client
    if client is None:
        raise HTTPException(503, "IA no disponible.")

    _validate_budget(budget_id, user)
    _, file_names, pages_per_file = await _extract_pages_b64(files)

    if not pages_per_file:
        raise HTTPException(400, "No se pudieron extraer páginas.")

    logger.info("PASO 1B: %d structural files, sending one at a time", len(files))

    context_prefix = f"Contexto del edificio: {building_context}\n\n" if building_context else ""

    all_results = []
    total_h = 0.0
    total_acero = 0.0

    # Send each file's first page individually
    for i, (name, file_pages) in enumerate(zip(file_names, pages_per_file)):
        prompt = context_prefix + _STRUCT_SINGLE_PROMPT + f"\n\nArchivo: {name}"
        try:
            result = await _call_vision(
                client, settings.OPENAI_MODEL_VISION, _SYS_STRUCT,
                prompt, file_pages[:1], max_tokens=8192,
            )
            h = result.get("hormigon_parcial_m3", 0)
            a = result.get("acero_parcial_kg", 0)
            total_h += h
            total_acero += a
            all_results.append({"archivo": name, **result})
        except Exception as e:
            logger.error("PASO 1B failed for %s: %s", name, e)
            all_results.append({"archivo": name, "error": str(e)})

    return {
        "budget_id": str(budget_id),
        "paso": "1B",
        "metodo": "plano_por_plano",
        "planos": all_results,
        "resumen_parcial": {
            "hormigon_suma_parcial_m3": total_h,
            "acero_suma_parcial_kg": total_acero,
            "planos_ok": sum(1 for r in all_results if "error" not in r),
            "planos_total": len(file_names),
            "nota": "Estos son parciales por plano — usar /synthesize para el cómputo real multiplicado por pisos.",
        },
    }


# ─── PASO 1C: Sections & Cuts ────────────────────────────────────────────────

_SECTIONS_PROMPT = """Analizá estos cortes/fachadas de un edificio residencial.
Necesito extraer datos dimensionales para el presupuesto de obra.

De los cortes/fachadas necesito:
1. ALTURAS: Altura total del edificio, altura piso a piso, altura libre por planta
2. ESPESORES: Losas (entrepiso), contrapisos, carpetas, aislaciones en terraza
3. ESCALERA: Cantidad de tramos, dimensiones, descansos
4. TERMINACIONES EXTERIORES: Tipo de fachada, revestimientos, molduras
5. SUBSUELO: Profundidad, muros de contención, espesor
6. TERRAZA: Capas (pendiente, aislación, membrana), pretiles, desagües
7. FUNDACIONES: Profundidad vista en corte, tipo visible

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin texto extra):
{
  "cortes_analizados": ["Corte A-A", "Corte B-B", "Fachada"],
  "alturas": {
    "total_edificio_m": 30.0,
    "piso_a_piso_tipo_m": 2.80,
    "altura_libre_tipo_m": 2.55,
    "altura_subsuelo_m": 2.50,
    "altura_pb_m": 3.00,
    "profundidad_fundacion_m": -3.50
  },
  "espesores": {
    "losa_entrepiso_cm": 20,
    "contrapiso_cm": 10,
    "carpeta_cm": 3,
    "revoque_cielorraso_cm": 2
  },
  "escalera": {
    "tramos_por_piso": 2,
    "ancho_m": 1.20,
    "largo_tramo_m": 3.00,
    "descanso_m": 1.20
  },
  "fachada": {
    "tipo": "revoque + pintura",
    "molduras": true,
    "revestimiento_pb": "piedra / porcelanato"
  },
  "terraza": {
    "capas": ["hormigon_pendiente", "aislacion_termica", "membrana_asfaltica", "baldosa"],
    "espesor_total_cm": 20,
    "pretil_altura_m": 1.10
  },
  "subsuelo": {
    "profundidad_m": -3.00,
    "muro_contencion_espesor_cm": 25,
    "tipo_muro": "hormigon_armado"
  },
  "notas": ""
}"""


@router.post("/{budget_id}/analyze-sections")
async def analyze_sections(
    budget_id: UUID,
    files: list[UploadFile] = File(...),
    building_context: str = Body("", embed=True),
    user: dict = Depends(require_editor),
):
    """PASO 1C: Analyze section/cut/facade plans."""
    settings = get_settings()
    client = settings.openai_client
    if client is None:
        raise HTTPException(503, "IA no disponible.")

    _validate_budget(budget_id, user)
    all_b64, file_names, _ = await _extract_pages_b64(files)

    if not all_b64:
        raise HTTPException(400, "No se pudieron extraer páginas.")

    logger.info("PASO 1C: %d section pages from %d files", len(all_b64), len(files))

    prompt = _SECTIONS_PROMPT
    if building_context:
        prompt = f"Contexto del edificio: {building_context}\n\n" + prompt
    prompt += f"\n\nArchivos: {', '.join(file_names)}\nTotal páginas: {len(all_b64)}"

    try:
        data = await _call_vision(client, settings.OPENAI_MODEL_VISION, _SYS_SECTIONS, prompt, all_b64, max_tokens=8192)
    except json.JSONDecodeError:
        raise HTTPException(422, "La IA no devolvió JSON válido para análisis de cortes.")
    except Exception as e:
        logger.error("PASO 1C error: %s", e)
        raise HTTPException(502, "Error al comunicarse con la IA.")

    return {"budget_id": str(budget_id), "paso": "1C", "archivos": file_names, **data}


# ─── PASO 1D: Synthesis ──────────────────────────────────────────────────────

_SYNTH_PROMPT_TEMPLATE = """Tengo 3 análisis parciales de un edificio. Los datos fueron extraídos de planos por IA y tienen errores que necesito que corrijas con criterio ingenieril.

DATOS DE ARQUITECTURA:
{arch_json}

DATOS DE ESTRUCTURA (analizados plano por plano — NO están multiplicados por pisos):
{struct_json}

DATOS DE CORTES/FACHADAS:
{section_json}

ERRORES CONOCIDOS A CORREGIR:
1. La estructura muestra elementos por plano individual — necesitás multiplicar los elementos de "Piso Tipo" × la cantidad real de pisos tipo
2. Las losas tienen volúmenes inconsistentes — recalculá usando: superficie del piso (de arquitectura) × espesor losa (de cortes)
3. Pueden faltar muros de subsuelo (contención HA), escalera completa, tanque de agua

INSTRUCCIONES:
1. Cruzá los datos de arquitectura (superficies por piso) con estructura (elementos) y cortes (alturas, espesores)
2. Calculá el cómputo métrico REAL multiplicando correctamente por cantidad de pisos
3. Usá las superficies de arquitectura para calcular losas correctamente
4. Agregá los ítems que falten (escalera HA, tanque, muros contención subsuelo)
5. Para acero usá ratios CIRSOC: zapatas 65, columnas 120, vigas 130, losas 70, escalera 110 kg/m³

Respondé con JSON válido. El cómputo métrico debe ser COMPLETO para presupuesto:
{{
  "edificio": {{
    "pisos": 0,
    "superficie_total_m2": 0,
    "altura_total_m": 0,
    "departamentos": 0
  }},
  "estructura": {{
    "fundaciones": {{"descripcion": "", "volumen_total_m3": 0, "acero_kg": 0}},
    "columnas": {{"descripcion": "", "cantidad_por_piso": 0, "pisos": 0, "volumen_total_m3": 0, "acero_kg": 0}},
    "vigas": {{"descripcion": "", "cantidad_por_piso": 0, "pisos": 0, "volumen_total_m3": 0, "acero_kg": 0}},
    "losas": {{"descripcion": "", "superficie_por_piso_m2": 0, "pisos": 0, "espesor_m": 0.20, "volumen_total_m3": 0, "acero_kg": 0}},
    "escalera": {{"descripcion": "", "volumen_total_m3": 0, "acero_kg": 0}},
    "muros_subsuelo": {{"descripcion": "", "volumen_total_m3": 0, "acero_kg": 0}},
    "vigas_fundacion": {{"descripcion": "", "volumen_total_m3": 0, "acero_kg": 0}},
    "resumen_estructura": {{"hormigon_total_m3": 0, "acero_total_kg": 0}}
  }},
  "mamposteria": {{"muros_exteriores_lh12_m2": 0, "muros_interiores_lh8_m2": 0, "total_m2": 0}},
  "revoques": {{"grueso_interior_m2": 0, "fino_interior_m2": 0, "exterior_m2": 0}},
  "pisos_revestimientos": {{"contrapiso_m2": 0, "carpeta_m2": 0, "ceramico_m2": 0, "porcelanato_m2": 0}},
  "aberturas": {{"puertas_interiores": 0, "puertas_exteriores": 0, "ventanas": 0}},
  "instalaciones": {{"sanitaria_bocas": 0, "electrica_bocas": 0, "gas_gl": 0}},
  "pintura": {{"interior_m2": 0, "exterior_m2": 0}},
  "notas_ingeniero": ""
}}"""


@router.post("/{budget_id}/synthesize")
async def synthesize(
    budget_id: UUID,
    arch_data: dict = Body(...),
    struct_data: dict = Body(...),
    section_data: dict = Body(...),
    user: dict = Depends(require_editor),
):
    """PASO 1D: Cross-reference all analyses and compute real cómputo métrico.

    Receives the JSON outputs from PASO 1A, 1B, 1C and asks GPT-4o to
    cross-reference, correct errors, and compute the full quantities.
    """
    settings = get_settings()
    client = settings.openai_client
    if client is None:
        raise HTTPException(503, "IA no disponible.")

    _validate_budget(budget_id, user)

    prompt = _SYNTH_PROMPT_TEMPLATE.format(
        arch_json=json.dumps(arch_data, indent=2, ensure_ascii=False),
        struct_json=json.dumps(struct_data, indent=2, ensure_ascii=False),
        section_json=json.dumps(section_data, indent=2, ensure_ascii=False),
    )

    logger.info("PASO 1D: Synthesizing cómputo métrico for budget %s", budget_id)

    try:
        data = await _call_text(client, settings.OPENAI_MODEL_VISION, _SYS_SYNTH, prompt, max_tokens=16384)
    except json.JSONDecodeError:
        raise HTTPException(422, "La IA no devolvió JSON válido para la síntesis.")
    except Exception as e:
        logger.error("PASO 1D error: %s", e)
        raise HTTPException(502, "Error al comunicarse con la IA.")

    return {"budget_id": str(budget_id), "paso": "1D", **data}
