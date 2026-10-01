"""Cargar una obra desde la app: subir el Excel, revisar, corregir y cargar.

1. POST /obras/analizar: lee la hoja 01_C&P, cruza cada ítem con una receta del
   Maestro (plantillas cargadas en la app) y busca el precio de cada recurso en
   los catálogos de la app, con la misma regla que "Actualizar precios" (Fase 4).
   Devuelve lo que hay que corregir: precios que faltan, códigos repetidos y
   tareas sin receta. No escribe nada.
2. Las correcciones de precios se hacen en los catálogos (endpoints de /catalogs):
   así quedan guardadas en el Maestro de la app para las próximas obras.
3. POST /obras/cargar: arma el presupuesto (rubros, pisos, ítems y recursos) y lo
   recalcula entero con la cascada de la app (redondeo de compra e indirectos).
   Si algo falla a mitad de camino, se borra el presupuesto: no queda a medias.
"""

from __future__ import annotations

import json
import logging
import warnings
from datetime import date
from io import BytesIO

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import get_current_user
from app.budget_prices import fetch_all, find_entry, initial_indirects, load_org_config, pick_price, today
from app.calculations import calc_resource_subtotal
from app.catalog_prices import normalize_codigo
from app.db import get_data_db
from app.obra_import import SHEET, build_plan, item_notes, parse_obra, task_key
from app.recipes import ORIGEN_RECURSO, resolve_waste

logger = logging.getLogger(__name__)
router = APIRouter()

CHUNK = 200
MAX_BYTES = 15 * 1024 * 1024


# ── Lectura ──────────────────────────────────────────────────────────────────


async def _read_workbook(file: UploadFile):  # type: ignore[no-untyped-def]
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Subí el Excel de la obra (.xlsx)")
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "El archivo es muy grande (máximo 15 MB)")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    except Exception as exc:
        raise HTTPException(400, "No se pudo abrir el Excel") from exc
    if SHEET not in wb.sheetnames:
        raise HTTPException(400, f"El Excel no tiene la hoja {SHEET} (cómputo y presupuesto)")
    return wb


def _asignaciones(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "asignaciones no es un JSON válido") from exc
    if not isinstance(data, dict):
        raise HTTPException(400, "asignaciones tiene que ser un objeto")
    return data


def _templates(db, org_id: str) -> dict[str, dict]:
    rows = fetch_all(
        lambda: db.table("item_templates").select("*").eq("org_id", org_id).order("id")
    )
    return {r["codigo"]: r for r in rows if r.get("codigo")}


class PriceBook:
    """Catalog entries and history of the org, priced at one date (rule of Fase 4)."""

    def __init__(self, db, org_id: str, fecha: date):  # type: ignore[no-untyped-def]
        self.fecha = fecha
        entries = fetch_all(
            lambda: db.table("catalog_entries").select("*").eq("org_id", org_id).order("id")
        )
        catalogs = db.table("price_catalogs").select("id,name").eq("org_id", org_id).execute().data or []
        names = {c["id"]: c.get("name") for c in catalogs}
        self.by_id = {str(e["id"]): {**e, "catalogo": names.get(e.get("catalog_id"))} for e in entries}
        self.by_codigo: dict[str, list[dict]] = {}
        for e in self.by_id.values():
            if normalize_codigo(e.get("codigo")):
                self.by_codigo.setdefault(normalize_codigo(e.get("codigo")), []).append(e)
        self.history: dict[str, list[dict]] = {}
        ids = list(self.by_id)
        for start in range(0, len(ids), CHUNK):
            chunk = ids[start:start + CHUNK]
            rows = fetch_all(
                lambda chunk=chunk: db.table("catalog_price_history").select("*")
                .eq("org_id", org_id).in_("entry_id", chunk).order("id")
            )
            for h in rows:
                self.history.setdefault(str(h["entry_id"]), []).append(h)

    def price(self, resource: dict) -> tuple[dict | None, float | None, str | None, str | None]:
        """(entry, precio, fecha, problema). problema: None, 'sin_precio', 'duplicado', 'no_esta'."""
        entry, problem = find_entry({"codigo": resource.get("codigo"), "tipo": resource.get("tipo")},
                                    self.by_id, self.by_codigo)
        if entry is None:
            return None, None, None, "duplicado" if problem == "duplicado" else "no_esta"
        found = pick_price(entry, self.history.get(str(entry["id"]), []), self.fecha)
        if found is None or found[0] <= 0:
            return entry, None, None, "sin_precio"
        return entry, found[0], found[1], None

    def entries_for(self, codigo: str) -> list[dict]:
        return self.by_codigo.get(normalize_codigo(codigo), [])


MOTIVOS = {
    "sin_precio": "No tiene precio",
    "duplicado": "Está repetido en el catálogo",
    "no_esta": "No está en el catálogo",
}


# ── Análisis ─────────────────────────────────────────────────────────────────


def analyze(parsed: dict, templates: dict[str, dict], book: PriceBook, asignaciones: dict) -> dict:
    """Everything the screen shows: summary, price problems and recipe of each task."""
    plan = build_plan(parsed, templates, asignaciones)
    items = [i for i in plan["items"] if i["nivel"] == "item"]

    precios: dict[str, dict] = {}
    for item in items:
        for r in item["recursos"]:
            if r.get("lo_compra_cliente"):
                continue
            _, _, _, problema = book.price(r)
            if not problema:
                continue
            key = normalize_codigo(r["codigo"]) or "(sin código)"
            row = precios.setdefault(key, {
                "codigo": r["codigo"], "descripcion": r.get("descripcion"), "unidad": r.get("unidad"),
                "tipo": "material" if r["tipo"] == "mo_material" else r["tipo"],
                "problema": problema, "motivo": MOTIVOS[problema], "recursos": 0, "items": [],
                "entradas": [
                    {k: e.get(k) for k in ("id", "catalog_id", "catalogo", "codigo", "descripcion",
                                           "unidad", "tipo", "precio_sin_iva", "fecha_precio")}
                    for e in book.entries_for(r["codigo"])
                ],
            })
            row["recursos"] += 1
            if item["codigo"] not in row["items"]:
                row["items"].append(item["codigo"])

    tareas: dict[str, dict] = {}
    for item in items:
        key = task_key(item["descripcion"], item["unidad"])
        t = tareas.setdefault(key, {
            "clave": key, "descripcion": item["descripcion"], "unidad": item["unidad"],
            "veces": 0, "codigos": [], "total_excel": 0.0,
            "plantillas": [
                {"codigo": c, "factor": f} for c, f in zip(item.get("plantillas") or [], item.get("factores") or [])
            ],
            "nota": item.get("nota_cruce") or item.get("candidato"),
            "elegida_a_mano": key in asignaciones,
        })
        t["veces"] += 1
        t["codigos"].append(item["codigo"])
        t["total_excel"] += item["excel"]["neto"]

    total = sum(i["excel"]["neto"] for i in items)
    con = sum(1 for i in items if i.get("plantilla"))
    return {
        "titulo": parsed["titulo"],
        "fecha_precios": book.fecha.isoformat(),
        "resumen": {
            "rubros": sum(1 for f in parsed["filas"] if f["nivel"] == "rubro"),
            "subrubros": sum(1 for f in parsed["filas"] if f["nivel"] == "subrubro"),
            "items": len(items), "con_receta": con, "sin_receta": len(items) - con,
            "total_excel": round(total, 2),
            "total_excel_sin_receta": round(sum(i["excel"]["neto"] for i in plan["sin_receta"]), 2),
        },
        "precios": [precios[k] for k in sorted(precios)],
        "tareas": sorted(tareas.values(), key=lambda t: (bool(t["plantillas"]), -t["total_excel"])),
        "plantillas": sorted(
            ({"codigo": c, "nombre": t.get("nombre"), "unidad": t.get("unidad")} for c, t in templates.items()),
            key=lambda t: [int(p) if p.isdigit() else p for p in str(t["codigo"]).split(".")],
        ),
        "plantillas_faltantes": plan["plantillas_faltantes"],
        "correcciones_excel": parsed["problemas"],
        "listo": not precios and not plan["plantillas_faltantes"],
        "_plan": plan,
    }


def _public(result: dict) -> dict:
    return {k: v for k, v in result.items() if not k.startswith("_")}


@router.post("/analizar")
async def analizar_obra(
    file: UploadFile = File(...),
    asignaciones: str | None = Form(None),
    user: dict = Depends(get_current_user),
):
    """Revisa el Excel de la obra. No escribe nada."""
    wb = await _read_workbook(file)
    db = get_data_db()
    org_id = user["org_id"]
    templates = _templates(db, org_id)
    if not templates:
        raise HTTPException(409, "No hay recetas cargadas en la app (plantillas del Maestro)")
    result = analyze(parse_obra(wb), templates, PriceBook(db, org_id, today()), _asignaciones(asignaciones))
    return {"archivo": file.filename, **_public(result)}


# ── Carga ────────────────────────────────────────────────────────────────────


def _insert(db, table: str, rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for start in range(0, len(rows), CHUNK):
        res = db.table(table).insert(rows[start:start + CHUNK]).execute()
        if len(res.data or []) != len(rows[start:start + CHUNK]):
            raise RuntimeError(f"No se pudieron guardar todas las filas en {table}")
        out += res.data
    return out


def _item_row(item: dict, budget_id: str, org_id: str, templates: dict[str, dict]) -> dict:
    ex = item.get("excel") or {}
    sin = item["nivel"] == "item" and not item.get("plantilla")
    qty = item["cantidad"]
    mat = float(ex.get("mat_unit", 0)) if sin else 0.0
    mo = float(ex.get("mo_unit", 0)) if sin else 0.0
    directo = round(mat * (qty or 0), 2) + round(mo * (qty or 0), 2)
    return {
        "budget_id": budget_id, "org_id": org_id, "code": item["codigo"],
        "description": item["descripcion"], "unidad": item["unidad"], "cantidad": qty,
        "mat_unitario": mat, "mo_unitario": mo,
        "mat_total": round(mat * (qty or 0), 2), "mo_total": round(mo * (qty or 0), 2),
        "directo_total": directo, "indirecto_total": 0, "beneficio_total": 0, "neto_total": directo,
        "notas": item_notes(item), "sort_order": item["orden"],
        "template_id": templates[item["plantilla"]]["id"] if item.get("plantilla") else None,
        "parametros": item.get("parametros") or {},
    }


def _resource_rows(item: dict, item_id: str, org_id: str, templates: dict[str, dict],
                   book: PriceBook, org_waste: object) -> list[dict]:
    rows = []
    for r in item["recursos"]:
        row = {k: v for k, v in r.items() if k != "plantilla"}
        if row["tipo"] != "mano_obra" and row.get("desperdicio_pct") is None:
            pct, origen = resolve_waste(None, None, templates[r["plantilla"]].get("desperdicio_pct"), org_waste)
            row["desperdicio_pct"], row["desperdicio_origen"] = pct, origen
        elif row["tipo"] != "mano_obra":
            row["desperdicio_origen"] = ORIGEN_RECURSO
        entry, precio, fecha, _ = book.price(row)
        row.update({
            "item_id": item_id, "org_id": org_id, "precio_unitario": precio or 0,
            "catalog_entry_id": entry["id"] if entry and precio else None,
            "precio_fecha": fecha if precio else None,
        })
        calc_resource_subtotal(row)
        rows.append(row)
    return rows


@router.post("/cargar")
async def cargar_obra(
    file: UploadFile = File(...),
    nombre: str = Form(...),
    asignaciones: str | None = Form(None),
    permitir_sin_precio: bool = Form(False),
    user: dict = Depends(get_current_user),
):
    """Carga la obra como presupuesto nuevo y lo recalcula entero."""
    from app.routers.analysis import _run_cascade  # same recalculation as "Recalcular obra"

    nombre = " ".join((nombre or "").split())
    if not nombre:
        raise HTTPException(400, "Poné un nombre para el presupuesto")
    wb = await _read_workbook(file)
    db = get_data_db()
    org_id = user["org_id"]
    templates = _templates(db, org_id)
    book = PriceBook(db, org_id, today())
    result = analyze(parse_obra(wb), templates, book, _asignaciones(asignaciones))

    if result["plantillas_faltantes"]:
        raise HTTPException(409, {"mensaje": "Faltan recetas en la app", "faltan": result["plantillas_faltantes"]})
    if result["precios"] and not permitir_sin_precio:
        raise HTTPException(409, {
            "mensaje": f"Hay {len(result['precios'])} códigos sin precio válido: corregilos antes de cargar",
            "precios": result["precios"],
        })
    exists = db.table("budgets").select("id").eq("org_id", org_id).eq("name", nombre).execute().data
    if exists:
        raise HTTPException(409, {"mensaje": f'Ya existe un presupuesto "{nombre}"'})

    budget = db.table("budgets").insert({
        "org_id": org_id, "name": nombre, "status": "draft", "source_file": file.filename,
        "description": "Cantidades del Excel de la obra; precios con las recetas del Maestro",
        "indirectos": initial_indirects(db, org_id), "precios_al": book.fecha.isoformat(),
    }).execute().data[0]
    budget_id = budget["id"]

    try:
        plan = result["_plan"]
        ids: dict[int, str] = {}
        # Rubros, then pisos, then ítems: each level needs its parent's id
        for nivel in ("rubro", "subrubro", "item"):
            level = [i for i in plan["items"] if i["nivel"] == nivel]
            rows = []
            for i in level:
                row = _item_row(i, budget_id, org_id, templates)
                row["parent_id"] = ids.get(i["parent"]) if i["parent"] is not None else None
                rows.append(row)
            for saved in _insert(db, "budget_items", rows):
                ids[saved["sort_order"]] = saved["id"]

        org_waste = load_org_config(db, org_id).get("desperdicio_pct")
        resources = []
        for i in plan["items"]:
            if i.get("recursos"):
                resources += _resource_rows(i, ids[i["orden"]], org_id, templates, book, org_waste)
        _insert(db, "item_resources", resources)

        items = db.table("budget_items").select("*").eq("budget_id", budget_id).execute().data or []
        cascade = _run_cascade(db, org_id, budget, items, strict=True)
    except Exception as exc:
        logger.exception("Carga de obra fallida; se borra el presupuesto %s", budget_id)
        db.table("budgets").delete().eq("id", budget_id).eq("org_id", org_id).execute()
        raise HTTPException(500, f"No se pudo cargar la obra (no quedó nada a medias): {exc}") from exc

    loaded = [i for i in plan["items"] if i["nivel"] == "item"]
    return {
        "budget_id": budget_id,
        "nombre": nombre,
        "items": len(loaded),
        "con_receta": sum(1 for i in loaded if i.get("plantilla")),
        "recursos": len(resources),
        "precios_en_cero": len(result["precios"]),
        "total_excel": result["resumen"]["total_excel"],
        "resumen": cascade.get("summary"),
    }
