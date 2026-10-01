"""Cargar una obra desde la app: subir el Excel, revisar, corregir y cargar.

1. POST /obras/analizar: lee la hoja 01_C&P, cruza cada ítem con una receta del
   Maestro (plantillas cargadas en la app) y busca el precio de cada recurso en
   los catálogos de la app, con la misma regla que "Actualizar precios" (Fase 4).
   Devuelve cada trabajo (misma descripción + unidad) con un semáforo: verde
   (listo), amarillo (confirmar algo) o rojo (no se puede cargar así), y los
   precios que faltan. La receta de cada trabajo sale, en este orden, de lo que
   se eligió en la pantalla, de lo que se eligió en otra obra (memoria), de la
   regla por descripción (MAPEO) o de una sugerencia por parecido. No escribe nada.
2. Las correcciones de precios se hacen en los catálogos (endpoints de /catalogs):
   así quedan guardadas en el Maestro de la app para las próximas obras.
3. POST /obras/cargar: arma el presupuesto (rubros, pisos, ítems y recursos) y lo
   recalcula entero con la cascada de la app (redondeo de compra e indirectos).
   Si algo falla a mitad de camino, se borra el presupuesto: no queda a medias.
   Las recetas elegidas quedan en la memoria (obra_recetas_memoria) para la próxima obra.
"""

from __future__ import annotations

import json
import logging
import re
import warnings
from datetime import date, datetime, timezone
from io import BytesIO

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import get_current_user
from app.budget_prices import fetch_all, find_entry, initial_indirects, load_org_config, pick_price, today
from app.calculations import calc_resource_subtotal
from app.catalog_prices import normalize_codigo
from app.db import get_data_db
from app.obra_import import (
    SHEET,
    build_plan,
    item_notes,
    match_recipe,
    parse_obra,
    rule_for,
    suggest_recipes,
    task_key,
    unit_key,
)
from app.recipes import ORIGEN_RECURSO, resolve_waste

logger = logging.getLogger(__name__)
router = APIRouter()

CHUNK = 200
MAX_BYTES = 15 * 1024 * 1024
MEMORY = "obra_recetas_memoria"
SUGGEST_MIN = 0.6  # a suggestion this good is proposed as the recipe (to confirm)


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


def _factor(value: object) -> float | None:
    try:
        factor = float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return factor if factor and factor > 0 else None


def _asignaciones(raw: str | None) -> dict[str, dict]:
    """What was decided on the screen: {clave: {"plantillas": [[codigo, factor|None]], "confirmada"}}."""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "No se pudieron leer las recetas elegidas (JSON inválido)") from exc
    if not isinstance(data, dict):
        raise HTTPException(400, "Las recetas elegidas tienen que venir como un objeto")
    out: dict[str, dict] = {}
    for clave, value in data.items():
        if isinstance(value, list):
            value = {"plantillas": value}
        pares = value.get("plantillas") if isinstance(value, dict) else None
        if not isinstance(pares, list):
            raise HTTPException(400, f"Receta elegida inválida para '{clave}'")
        norm = []
        for par in pares:
            if isinstance(par, str):
                par = [par]
            if not isinstance(par, (list, tuple)) or not par or not str(par[0] or "").strip():
                raise HTTPException(400, f"Receta elegida inválida para '{clave}'")
            norm.append([str(par[0]).strip(), _factor(par[1] if len(par) > 1 else None)])
        out[str(clave)] = {"plantillas": norm, "confirmada": bool(value.get("confirmada"))}
    return out


def _memoria(db, org_id: str) -> dict[str, dict]:  # type: ignore[no-untyped-def]
    """Recipes chosen in other obras, by task_key. Without migration 009 there is no memory."""
    try:
        rows = fetch_all(lambda: db.table(MEMORY).select("*").eq("org_id", org_id).order("id"))
    except Exception:
        logger.warning("No se pudo leer %s (¿falta correr migrations/009?)", MEMORY, exc_info=True)
        return {}
    out = {}
    for r in rows:
        pares = r.get("plantillas")
        if isinstance(pares, str):
            try:
                pares = json.loads(pares)
            except ValueError:
                continue
        if r.get("clave") and isinstance(pares, list):
            out[r["clave"]] = {**r, "plantillas": [[str(p[0]), _factor(p[1] if len(p) > 1 else None)]
                                                   for p in pares if isinstance(p, list) and p]}
    return out


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

PORQUE = {
    "memoria": "Ya la usaste así en otra obra",
    "regla": "Coincide la descripción",
    "manual": "La elegiste vos",
}
NOTA_A_MANO = "Receta elegida a mano al cargar la obra."  # rule_for's note for a hand-picked recipe
_CODE_IN_NOTE = re.compile(r"\s*\((\d+(?:\.\d+)*)\)")
_PRETTY_UNIT = {"m2": "m²", "m3": "m³", "u": "unidad"}
ESTADOS = ("rojo", "amarillo", "verde")


def _pretty_unit(unidad: object) -> str:
    return _PRETTY_UNIT.get(unit_key(unidad), str(unidad or ""))


def _human(nombre: object) -> str:
    """'BASES AISLADAS' → 'Bases aisladas' (the Maestro names are mostly in capitals)."""
    text = str(nombre or "")
    if sum(c.isupper() for c in text) > sum(c.islower() for c in text):
        return text[:1].upper() + text[1:].lower()
    return text


def _codes(pares: list) -> list[str]:
    return [str(p[0]) for p in pares or []]


def _proposal(fila: dict, templates: dict[str, dict], memoria: dict[str, dict],
              sugerencias: list[tuple[str, float, str]]) -> dict | None:
    """Recipe of a task before the screen's choice: memoria > regla (MAPEO) > sugerencia."""
    key = task_key(fila["descripcion"], fila.get("unidad"))
    if key in memoria:
        return {"origen": "memoria", "pares": memoria[key]["plantillas"], "porque": PORQUE["memoria"]}
    if match_recipe(fila["descripcion"]):
        rule = rule_for(fila, templates) or {}
        return {"origen": "regla", "pares": [list(p) for p in rule.get("plantillas", [])],
                "porque": PORQUE["regla"]}
    if sugerencias:
        codigo, score, porque = sugerencias[0]
        receta = unit_key(templates[codigo].get("unidad"))
        obra = unit_key(fila.get("unidad"))
        # A suggestion in another unit would need a conversion nobody gave: it stays a suggestion
        if score >= SUGGEST_MIN and (not receta or not obra or receta == obra):
            return {"origen": "sugerida", "pares": [[codigo, 1.0]], "porque": porque}
    return None


def _decide(fila: dict, templates: dict[str, dict], memoria: dict[str, dict],
            elegida: dict | None, sugerencias: list) -> dict:
    """Origin, recipe pairs for build_plan (None = the automatic rule) and whether it is confirmed."""
    base = _proposal(fila, templates, memoria, sugerencias)
    if elegida is None:
        if base is None:
            return {"origen": None, "pares": None, "porque": None, "confirmada": False}
        pares = None if base["origen"] == "regla" else base["pares"]
        return {"origen": base["origen"], "pares": pares, "porque": base["porque"],
                "confirmada": base["origen"] == "memoria"}

    pares = [list(p) for p in elegida["plantillas"]]
    same = base is not None and _codes(base["pares"]) == _codes(pares)
    if same:
        # Confirming the proposal: the conversions already known are kept unless Sol wrote one
        for par, known in zip(pares, base["pares"]):
            if par[1] is None:
                par[1] = known[1]
    origen = base["origen"] if same else ("manual" if pares else None)
    if not pares and base is None:
        origen = None
    return {"origen": origen, "pares": pares, "porque": base["porque"] if same else PORQUE["manual"],
            "confirmada": elegida.get("confirmada") or not same or origen == "memoria"}


def _pregunta(fila: dict, partes: list[dict]) -> dict | None:
    """The conversion to ask when a recipe comes in another unit than the obra's."""
    obra = unit_key(fila.get("unidad"))
    distintas = [p for p in partes if p["nombre"] is not None and unit_key(p["unidad"]) and obra
                 and unit_key(p["unidad"]) != obra]
    if not distintas:
        return None
    parte = next((p for p in distintas if p["factor"] is None), distintas[0])
    return {
        "tipo": "cantidad_por_unidad",
        "texto": f'¿Cuántos {_pretty_unit(parte["unidad"])} de "{_human(parte["nombre"])}" '
                 f"lleva cada {_pretty_unit(fila.get('unidad'))} de este trabajo?",
        "receta": parte["codigo"], "unidad_receta": parte["unidad"], "unidad_obra": fila.get("unidad"),
        "valor": parte["factor"],
    }


def _avisos(rule: dict | None) -> list[str]:
    nota = (rule or {}).get("nota")
    if not nota or nota == NOTA_A_MANO:
        return []
    return [_CODE_IN_NOTE.sub("", nota).strip()]


def _asks(aviso: str) -> bool:
    """A rule note that asks Sol to confirm something ("¿portante o hueco?", "revisar ...")."""
    return "?" in aviso or "revisar" in aviso.lower()


def _price_problems(items: list[dict], book: PriceBook) -> dict[str, dict]:
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
    return precios


def _code_order(codigo: object) -> list:
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in str(codigo).split(".")]


def analyze(parsed: dict, templates: dict[str, dict], book: PriceBook, asignaciones: dict,
            memoria: dict[str, dict] | None = None) -> dict:
    """Everything the screen shows: one card per task with its recipe, question and state."""
    memoria = memoria or {}
    filas = [f for f in parsed["filas"] if f["nivel"] == "item"]
    grupos: dict[str, list[dict]] = {}
    for f in filas:
        grupos.setdefault(task_key(f["descripcion"], f.get("unidad")), []).append(f)

    decisiones: dict[str, dict] = {}
    sugeridas: dict[str, list] = {}
    efectivas: dict[str, dict] = {}
    for key, fs in grupos.items():
        first = fs[0]
        sugeridas[key] = [] if (key in memoria or match_recipe(first["descripcion"])) \
            else suggest_recipes(first["descripcion"], templates)
        d = _decide(first, templates, memoria, asignaciones.get(key), sugeridas[key])
        decisiones[key] = d
        if d["pares"] is not None:
            efectivas[key] = {"plantillas": d["pares"]}

    plan = build_plan(parsed, templates, efectivas)
    items = [i for i in plan["items"] if i["nivel"] == "item"]
    precios = _price_problems(items, book)
    faltan_por_item: dict[str, set[str]] = {}
    for p in precios.values():
        for codigo in p["items"]:
            faltan_por_item.setdefault(codigo, set()).add(p["codigo"])

    by_key: dict[str, list[dict]] = {}
    for item in items:
        by_key.setdefault(task_key(item["descripcion"], item.get("unidad")), []).append(item)

    tareas = []
    for key, its in by_key.items():
        first, d = its[0], decisiones[key]
        rule = rule_for(first, templates, efectivas)
        receta = None
        partes: list[dict] = []
        if rule is not None:
            partes = [{"codigo": c, "nombre": (templates.get(c) or {}).get("nombre"),
                       "unidad": (templates.get(c) or {}).get("unidad"), "factor": f}
                      for c, f in rule["plantillas"]]
            receta = {
                "codigo": partes[0]["codigo"],
                "nombre": " + ".join(str(p["nombre"] or p["codigo"]) for p in partes),
                "unidad": partes[0]["unidad"], "partes": partes,
                "origen": d["origen"] or "manual", "porque": d["porque"] or PORQUE["manual"],
            }
        inexistente = any(p["nombre"] is None and p["codigo"] not in templates for p in partes)
        pregunta = _pregunta(first, partes) if receta else None
        falta_conversion = bool(rule and rule["falta_factor"]) and not inexistente
        avisos = _avisos(rule)
        faltantes = sorted({c for i in its for c in faltan_por_item.get(i["codigo"], ())},
                           key=lambda c: normalize_codigo(c) or "")

        motivo = ("receta_inexistente" if inexistente else "pregunta" if falta_conversion
                  else "precio" if faltantes else None)
        if motivo:
            estado = "rojo"
        elif not d["confirmada"] and (
            receta is None or receta["origen"] == "sugerida" or any(_asks(a) for a in avisos)
        ):
            estado = "amarillo"
        else:
            estado = "verde"

        sugerencias = []
        if receta is None or receta["origen"] == "sugerida":
            actual = receta["codigo"] if receta else None
            pool = sugeridas[key] or suggest_recipes(first["descripcion"], templates)
            sugerencias = [
                {"codigo": c, "nombre": templates[c].get("nombre"), "unidad": templates[c].get("unidad"),
                 "porque": porque}
                for c, _, porque in pool if c != actual
            ][:3]

        tareas.append({
            "clave": key, "descripcion": first["descripcion"], "unidad": first.get("unidad"),
            "veces": len(its),
            "cantidad_total": round(sum(float(i["cantidad"] or 0) for i in its), 4),
            "total_excel": round(sum(i["excel"]["neto"] for i in its), 2),
            "codigos": [i["codigo"] for i in its],
            "estado": estado, "motivo_rojo": motivo, "receta": receta, "sugerencias": sugerencias,
            "pregunta": pregunta, "avisos": avisos, "precios_faltantes": faltantes,
        })
    tareas.sort(key=lambda t: (ESTADOS.index(t["estado"]), -t["total_excel"]))

    cuenta = {e: sum(1 for t in tareas if t["estado"] == e) for e in ESTADOS}
    return {
        "titulo": parsed["titulo"],
        "fecha_precios": book.fecha.isoformat(),
        "resumen": {
            "rubros": sum(1 for f in parsed["filas"] if f["nivel"] == "rubro"),
            "pisos": sum(1 for f in parsed["filas"] if f["nivel"] == "subrubro"),
            "trabajos": len(items), "grupos": len(tareas),
            "verdes": cuenta["verde"], "amarillos": cuenta["amarillo"], "rojos": cuenta["rojo"],
            "total_excel": round(sum(i["excel"]["neto"] for i in items), 2),
        },
        "tareas": tareas,
        "precios": [precios[k] for k in sorted(precios)],
        "recetas": sorted(
            ({"codigo": c, "nombre": t.get("nombre"), "unidad": t.get("unidad"), "categoria": t.get("categoria")}
             for c, t in templates.items()),
            key=lambda t: _code_order(t["codigo"]),
        ),
        "correcciones_excel": parsed["problemas"],
        "listo": cuenta["rojo"] == 0 and not plan["plantillas_faltantes"],
        "_plan": plan,
        "_decisiones": decisiones,
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
        raise HTTPException(409, "No hay recetas cargadas en la app: primero hay que importar el Maestro")
    result = analyze(parse_obra(wb), templates, PriceBook(db, org_id, today()), _asignaciones(asignaciones),
                     _memoria(db, org_id))
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
        # Each resource remembers its own recipe: in a combined item (ej. EPS + contrapiso)
        # the inherited waste is resolved with that recipe, now and when the cascade
        # recalculates (presupuesto > receta del recurso > organización).
        row["template_id"] = templates[r["plantilla"]]["id"]
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


def _plural(n: int, one: str, many: str) -> str:
    return (one if n == 1 else many).format(n=n)


def _save_memory(db, org_id: str, result: dict, elegidas: dict, memoria: dict[str, dict]) -> int:  # type: ignore[no-untyped-def]
    """Remember the recipes chosen on the screen (upsert by org_id + clave). Never fails the load."""
    tareas = {t["clave"]: t for t in result["tareas"]}
    now = datetime.now(timezone.utc).isoformat()
    nuevas, cambios = [], []
    for clave in elegidas:
        t = tareas.get(clave)
        if t is None:
            continue
        partes = (t["receta"] or {}).get("partes") or []
        row = {"descripcion": t["descripcion"], "unidad": t["unidad"],
               "plantillas": [[p["codigo"], p["factor"]] for p in partes], "updated_at": now}
        if clave in memoria and memoria[clave].get("id"):
            cambios.append((memoria[clave]["id"], {**row, "veces": int(memoria[clave].get("veces") or 0) + 1}))
        else:
            nuevas.append({"org_id": org_id, "clave": clave, "veces": 1, **row})
    try:
        for row_id, patch in cambios:
            db.table(MEMORY).update(patch).eq("id", row_id).eq("org_id", org_id).execute()
        if nuevas:
            _insert(db, MEMORY, nuevas)
    except Exception:
        logger.warning("No se pudo guardar la memoria de recetas (¿falta migrations/009?)", exc_info=True)
        return 0
    return len(cambios) + len(nuevas)


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
    elegidas = _asignaciones(asignaciones)
    memoria = _memoria(db, org_id)
    result = analyze(parse_obra(wb), templates, book, elegidas, memoria)

    rojos = [t for t in result["tareas"] if t["estado"] == "rojo"]
    duros = [t["clave"] for t in rojos if t["motivo_rojo"] != "precio"]
    plan = result["_plan"]
    if duros or plan["sin_factor"] or plan["plantillas_faltantes"]:
        raise HTTPException(409, {
            "mensaje": _plural(len(duros) or len(rojos), "Hay {n} trabajo en rojo: resolvelo antes de cargar",
                               "Hay {n} trabajos en rojo: resolvelos antes de cargar"),
            "rojos": duros or [t["clave"] for t in rojos],
        })
    if rojos and not permitir_sin_precio:
        raise HTTPException(409, {
            "mensaje": _plural(len(result["precios"]),
                               "Falta {n} precio: corregilo antes de cargar, o cargá igual con ese precio en $0",
                               "Faltan {n} precios: corregilos antes de cargar, o cargá igual con esos precios en $0"),
            "rojos": [t["clave"] for t in rojos],
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

    guardada = _save_memory(db, org_id, result, elegidas, memoria)
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
        "memoria_guardada": guardada,
    }
