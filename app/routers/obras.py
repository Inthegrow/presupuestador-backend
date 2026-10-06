"""Cargar una obra desde la app: subir el Excel, revisar, corregir y cargar.

1. POST /obras/analizar: lee la hoja 01_C&P, cruza cada ítem con una receta del
   Maestro (plantillas cargadas en la app) y busca el precio de cada recurso en
   los catálogos de la app, con la misma regla que "Actualizar precios" (Fase 4).
   Devuelve cada trabajo (misma descripción + unidad) con un semáforo: verde
   (listo), amarillo (confirmar algo) o rojo (no se puede cargar así), y los
   precios que faltan. La receta de cada trabajo sale, en este orden, de lo que
   se eligió en la pantalla, de lo que se eligió en otra obra (memoria) o de la
   regla por descripción (MAPEO). Las sugerencias por parecido nunca son la receta:
   se ofrecen para elegir ("Quizás sea"). No escribe nada.
2. Las correcciones de precios se hacen en los catálogos (endpoints de /catalogs):
   así quedan guardadas en el Maestro de la app para las próximas obras.
3. POST /obras/cargar: arma el presupuesto (rubros, pisos, ítems y recursos) y lo
   recalcula entero con la cascada de la app (redondeo de compra e indirectos).
   Si algo falla a mitad de camino, se borra el presupuesto: no queda a medias.
   Las recetas elegidas quedan en la memoria (obra_recetas_memoria) para la próxima obra.
   Los trabajos amarillos que entran sin confirmar dicen "Para confirmar." en sus notas.
"""

from __future__ import annotations

import json
import logging
import re
import time
import warnings
from datetime import date, datetime, timezone
from io import BytesIO
from uuid import UUID

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.auth import get_current_user, require_editor
from app.budget_prices import (
    INDIRECT_DEFAULTS,
    budget_config,
    fetch_all,
    find_entry,
    initial_indirects,
    is_price,
    load_catalog_index,
    load_org_config,
    pick_price,
    today,
)
from app.calculations import calc_resource_subtotal, pct_or_default
from app.catalog_prices import normalize_codigo, parse_fecha
from app.db import get_data_db
from app.obra_import import (
    SHEET,
    build_plan,
    excel_prices,
    item_notes,
    match_recipe,
    parse_obra,
    plain,
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
        raise HTTPException(400, "No se pudieron leer las fórmulas elegidas (JSON inválido)") from exc
    if not isinstance(data, dict):
        raise HTTPException(400, "Las fórmulas elegidas tienen que venir como un objeto")
    out: dict[str, dict] = {}
    for clave, value in data.items():
        if isinstance(value, list):
            value = {"plantillas": value}
        pares = value.get("plantillas") if isinstance(value, dict) else None
        if not isinstance(pares, list):
            raise HTTPException(400, f"Fórmula elegida inválida para '{clave}'")
        norm = []
        for par in pares:
            if isinstance(par, str):
                par = [par]
            if not isinstance(par, (list, tuple)) or not par or not str(par[0] or "").strip():
                raise HTTPException(400, f"Fórmula elegida inválida para '{clave}'")
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
    """Catalog entries and history of the org, priced at one date (rule of Fase 4).

    With an oficial catalog, only its entries price (load_catalog_index); the others
    are references ("En Las Heras estaba a $X") for the codes that are missing.
    """

    def __init__(self, db, org_id: str, fecha: date):  # type: ignore[no-untyped-def]
        self.fecha = fecha
        idx = load_catalog_index(db, org_id)
        self.by_id: dict[str, dict] = idx["by_id"]
        self.by_codigo: dict[str, list[dict]] = idx["by_codigo"]
        self.history: dict[str, list[dict]] = idx["history"]
        self.consulta_by_codigo: dict[str, list[dict]] = idx["consulta_by_codigo"]
        self.catalogos: dict[str, dict] = idx["catalogos"]
        self.hay_oficial: bool = idx["hay_oficial"]

    def price(self, resource: dict) -> tuple[dict | None, float | None, str | None, str | None]:
        """(entry, precio, fecha, problema). problema: None, 'sin_precio', 'duplicado', 'no_esta'."""
        entry, problem = find_entry({"codigo": resource.get("codigo"), "tipo": resource.get("tipo")},
                                    self.by_id, self.by_codigo, fecha=self.fecha, history=self.history)
        if entry is None:
            return None, None, None, "duplicado" if problem == "duplicado" else "no_esta"
        found = pick_price(entry, self.history.get(str(entry["id"]), []), self.fecha)
        if found is None or not is_price(found):
            # A dated 0 is a price ("Va en $0"); an undated 0 is a price nobody loaded
            return entry, None, None, "sin_precio"
        return entry, found[0], found[1], None

    def entries_for(self, codigo: str) -> list[dict]:
        return self.by_codigo.get(normalize_codigo(codigo), [])

    def references_for(self, codigo: str) -> list[dict]:
        """Reference (non oficial) entries of a code with a price: newest first, undated last, at most 5."""
        found = [e for e in self.consulta_by_codigo.get(normalize_codigo(codigo), [])
                 if (_price_value(e.get("precio_sin_iva")) or 0) > 0]

        def newest(e: dict) -> tuple:
            try:
                fecha = parse_fecha(e.get("fecha_precio"))
            except ValueError:
                fecha = None
            return (fecha is not None, fecha or date.min, str(e.get("_catalogo_creado") or ""))

        found.sort(key=newest, reverse=True)
        return [_entry_view(e) for e in found[:MAX_REFERENCIAS]]

    def destination(self, tipo: str | None) -> dict | None:
        """Oficial catalog where a missing code should be created: the one with most entries
        of that tipo (newest on a tie). None without an oficial catalog."""
        oficiales = [c for c in self.catalogos.values() if c["oficial"]]
        if not oficiales:
            return None
        count: dict[str, int] = {}
        for e in self.by_id.values():
            if e.get("tipo") == tipo:
                count[str(e.get("catalog_id"))] = count.get(str(e.get("catalog_id")), 0) + 1
        best = max(oficiales, key=lambda c: (count.get(str(c["id"]), 0), str(c.get("created_at") or "")))
        return {"id": best["id"], "name": best.get("name")}


MAX_REFERENCIAS = 5
_ENTRY_FIELDS = ("id", "catalog_id", "catalogo", "codigo", "descripcion", "unidad", "tipo",
                 "precio_sin_iva", "fecha_precio")


def _entry_view(entry: dict) -> dict:
    return {k: entry.get(k) for k in _ENTRY_FIELDS}


def _price_value(value: object) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


MOTIVOS = {
    "sin_precio": "No tiene precio",
    "duplicado": "Está repetido en el catálogo",
    "no_esta": "No está en el catálogo",
}
MOTIVO_NO_ESTA_OFICIAL = "No está en el catálogo oficial"


# ── Análisis ─────────────────────────────────────────────────────────────────

PORQUE = {
    "memoria": "Ya la usaste así en otra obra",
    "regla": "Coincide la descripción",
    "manual": "La elegiste vos",
}
NOTA_A_MANO = "Fórmula elegida a mano al cargar la obra."  # rule_for's note for a hand-picked recipe
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


def _proposal(fila: dict, templates: dict[str, dict], memoria: dict[str, dict]) -> dict | None:
    """Recipe of a task before the screen's choice: memoria > regla (MAPEO).

    A suggestion by similar words is never the recipe (a weak match like "membrana
    líquida" → "pintura en paredes" would bring its prices): it is only offered.
    "origenes" says, per pair, where its conversion came from (see rule_for).
    """
    key = task_key(fila["descripcion"], fila.get("unidad"))
    if key in memoria:
        pares = memoria[key]["plantillas"]
        return {"origen": "memoria", "pares": pares, "porque": PORQUE["memoria"],
                "origenes": ["memoria" if p[1] is not None else None for p in pares]}
    if match_recipe(fila["descripcion"]):
        rule = rule_for(fila, templates) or {}
        return {"origen": "regla", "pares": [list(p) for p in rule.get("plantillas", [])],
                "porque": PORQUE["regla"], "origenes": list(rule.get("origen_factor") or [])}
    return None


def _same_factor(a: float | None, b: float | None) -> bool:
    return a is not None and b is not None and abs(float(a) - float(b)) < 1e-9


def _decide(fila: dict, templates: dict[str, dict], memoria: dict[str, dict], elegida: dict | None) -> dict:
    """Origin, recipe pairs for build_plan (None = the automatic rule) and whether it is confirmed.

    "origenes": per pair, where its conversion came from: "nombre", "supuesto", "regla",
    "memoria", "mano" (Sol wrote it) or None (missing). None as a whole = the rule's own.
    """
    base = _proposal(fila, templates, memoria)
    if elegida is None:
        if base is None:
            return {"origen": None, "pares": None, "porque": None, "confirmada": False, "origenes": None}
        regla = base["origen"] == "regla"
        return {"origen": base["origen"], "pares": None if regla else base["pares"], "porque": base["porque"],
                "confirmada": base["origen"] == "memoria", "origenes": None if regla else base["origenes"]}

    pares = [list(p) for p in elegida["plantillas"]]
    same = base is not None and _codes(base["pares"]) == _codes(pares)
    origenes: list[str | None] = []
    if same:
        # Confirming the proposal: the conversions already known are kept unless Sol wrote one
        for i, (par, known) in enumerate(zip(pares, base["pares"])):
            conocido = base["origenes"][i] if i < len(base["origenes"]) else None
            if par[1] is None:
                par[1] = known[1]
                origenes.append(conocido if known[1] is not None else None)
            else:
                origenes.append(conocido if _same_factor(par[1], known[1]) else "mano")
    else:
        origenes = ["mano" if p[1] is not None else None for p in pares]
    origen = base["origen"] if same else ("manual" if pares else None)
    if not pares and base is None:
        origen = None
    return {"origen": origen, "pares": pares, "porque": base["porque"] if same else PORQUE["manual"],
            "confirmada": elegida.get("confirmada") or not same or origen == "memoria", "origenes": origenes}


def _numero(value: float) -> str:
    """Argentine number: 0.1 → '0,1', 1234.5 → '1.234,5' (up to 4 decimals, no trailing zeros)."""
    text = f"{value:,.4f}".rstrip("0").rstrip(".") if round(value, 4) or not value else f"{value:g}"
    return text.replace(",", "X").replace(".", ",").replace("X", ".")


# Where a known conversion came from (rule_for / _decide) → pregunta.origen_valor
ORIGEN_VALOR = {"nombre": "nombre", "supuesto": "regla", "regla": "regla", "memoria": "memoria", "mano": "mano"}


def _pregunta(fila: dict, partes: list[dict], origenes: list | None = None) -> dict | None:
    """The conversion to ask when a recipe comes in another unit than the obra's.

    When the value is already known (rule, memory or Sol's answer), ``dato`` says it
    as a fact ('Cada m² lleva 0,1 m³ de "Contrapiso de cascote"'): nothing to ask.
    A thickness says where it came from: ' (por los 8 cm del nombre)' or ' (supuse 10 cm)'.
    ``origenes`` (aligned with ``partes``) gives "origen_valor": nombre, regla, memoria,
    mano, or None while the value is missing.
    """
    obra = unit_key(fila.get("unidad"))
    distintas = [p for p in partes if p["nombre"] is not None and unit_key(p["unidad"]) and obra
                 and unit_key(p["unidad"]) != obra]
    if not distintas:
        return None
    parte = next((p for p in distintas if p["factor"] is None), distintas[0])
    i = partes.index(parte)
    origen = (origenes[i] if origenes and i < len(origenes) else None) if parte["factor"] is not None else None
    dato = None
    if parte["factor"] is not None:
        dato = (f"Cada {_pretty_unit(fila.get('unidad'))} lleva {_numero(parte['factor'])} "
                f'{_pretty_unit(parte["unidad"])} de "{_human(parte["nombre"])}"')
        cm = _numero(round(parte["factor"] * 100, 2))
        if origen == "nombre":
            dato += f" (por los {cm} cm del nombre)"
        elif origen == "supuesto":
            dato += f" (supuse {cm} cm)"
    return {
        "tipo": "cantidad_por_unidad",
        "texto": f'¿Cuántos {_pretty_unit(parte["unidad"])} de "{_human(parte["nombre"])}" '
                 f"lleva cada {_pretty_unit(fila.get('unidad'))} de este trabajo?",
        "receta": parte["codigo"], "unidad_receta": parte["unidad"], "unidad_obra": fila.get("unidad"),
        "valor": parte["factor"], "dato": dato, "origen_valor": ORIGEN_VALOR.get(origen) if origen else None,
    }


def _avisos(rule: dict | None) -> list[str]:
    nota = (rule or {}).get("nota")
    if not nota or nota == NOTA_A_MANO:
        return []
    return [_CODE_IN_NOTE.sub("", nota).strip()]


def _asks(aviso: str) -> bool:
    """A rule note that asks Sol to confirm something ("¿portante o hueco?", "revisar ...")."""
    return "?" in aviso or "revisar" in aviso.lower()


def _price_problems(items: list[dict], book: PriceBook, excel: dict[str, dict] | None = None) -> dict[str, dict]:
    """One row per code without a usable price, with what can fix it.

    entradas: the (oficial) entries of the code, where the price is saved or deleted.
    referencias: the same code in the reference catalogs (only with an oficial catalog).
    propuesta: the price the obra's Excel already has for it (excel_prices), except
    for a repeated code. catalogo_destino: where to create it (oficial catalogs only).
    """
    excel = excel or {}
    precios: dict[str, dict] = {}
    for item in items:
        for r in item["recursos"]:
            if r.get("lo_compra_cliente"):
                continue
            _, _, _, problema = book.price(r)
            if not problema:
                continue
            key = normalize_codigo(r["codigo"]) or "(sin código)"
            tipo = "material" if r["tipo"] == "mo_material" else r["tipo"]
            motivo = MOTIVO_NO_ESTA_OFICIAL if problema == "no_esta" and book.hay_oficial else MOTIVOS[problema]
            row = precios.setdefault(key, {
                "codigo": r["codigo"], "descripcion": r.get("descripcion"), "unidad": r.get("unidad"),
                "tipo": tipo, "problema": problema, "motivo": motivo, "recursos": 0, "items": [],
                "entradas": [_entry_view(e) for e in book.entries_for(r["codigo"])],
                "referencias": book.references_for(r["codigo"]),
                "propuesta": None if problema == "duplicado" else excel.get(normalize_codigo(r["codigo"])),
                "catalogo_destino": book.destination(tipo),
            })
            row["recursos"] += 1
            if item["codigo"] not in row["items"]:
                row["items"].append(item["codigo"])
    return precios


def _code_order(codigo: object) -> list:
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in str(codigo).split(".")]


def analyze(parsed: dict, templates: dict[str, dict], book: PriceBook, asignaciones: dict,
            memoria: dict[str, dict] | None = None, excel: dict[str, dict] | None = None) -> dict:
    """Everything the screen shows: one card per task with its recipe, question and state.

    ``excel`` = excel_prices(wb): the prices the obra's Excel already has, proposed
    for the codes the catalog cannot price.

    "motivo_rojo" of a red task: "receta_inexistente", "pregunta", "sin_receta" (no recipe
    in an Excel that carries no prices at all) or "precio". "excel_con_precios" is False when no item of the
    Excel has a cost (an obra that came only with quantities).
    """
    memoria = memoria or {}
    filas = [f for f in parsed["filas"] if f["nivel"] == "item"]
    grupos: dict[str, list[dict]] = {}
    for f in filas:
        grupos.setdefault(task_key(f["descripcion"], f.get("unidad")), []).append(f)

    # Does the obra's Excel carry prices at all? Without them, a task with no recipe has nothing to load.
    con_precios = any(f["excel"]["neto"] > 0 or f["excel"]["mat_unit"] + f["excel"]["mo_unit"] > 0
                      for f in filas)

    decisiones: dict[str, dict] = {}
    sugeridas: dict[str, list] = {}
    efectivas: dict[str, dict] = {}
    for key, fs in grupos.items():
        first = fs[0]
        sugeridas[key] = [] if (key in memoria or match_recipe(first["descripcion"])) \
            else suggest_recipes(first["descripcion"], templates)
        d = _decide(first, templates, memoria, asignaciones.get(key))
        decisiones[key] = d
        if d["pares"] is not None:
            efectivas[key] = {"plantillas": d["pares"]}

    plan = build_plan(parsed, templates, efectivas)
    items = [i for i in plan["items"] if i["nivel"] == "item"]
    precios = _price_problems(items, book, excel)
    faltan_por_item: dict[str, set[str]] = {}
    for p in precios.values():
        for codigo in p["items"]:
            faltan_por_item.setdefault(codigo, set()).add(p["codigo"])

    by_key: dict[str, list[dict]] = {}
    for item in items:
        item["clave"] = task_key(item["descripcion"], item.get("unidad"))  # its task, for the load
        by_key.setdefault(item["clave"], []).append(item)

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
        origenes = d["origenes"] if d["pares"] is not None else (rule or {}).get("origen_factor")
        pregunta = _pregunta(first, partes, origenes) if receta else None
        falta_conversion = bool(rule and rule["falta_factor"]) and not inexistente
        avisos = _avisos(rule)
        faltantes = sorted({c for i in its for c in faltan_por_item.get(i["codigo"], ())},
                           key=lambda c: normalize_codigo(c) or "")
        total_excel = round(sum(i["excel"]["neto"] for i in its), 2)

        # Without a recipe the Excel price is used. In an Excel with no prices at all there is
        # nothing to load (red). A $0 row in a priced Excel is Sol's own decision: yellow, as before.
        motivo = ("receta_inexistente" if inexistente else "pregunta" if falta_conversion
                  else "sin_receta" if receta is None and not con_precios
                  else "precio" if faltantes else None)
        if motivo:
            estado = "rojo"
        elif not d["confirmada"] and (receta is None or any(_asks(a) for a in avisos)):
            estado = "amarillo"
        else:
            estado = "verde"

        sugerencias = []
        if receta is None:
            pool = sugeridas[key] or suggest_recipes(first["descripcion"], templates)
            sugerencias = [
                {"codigo": c, "nombre": templates[c].get("nombre"), "unidad": templates[c].get("unidad"),
                 "porque": porque}
                for c, _, porque in pool
            ][:3]

        tareas.append({
            "clave": key, "descripcion": first["descripcion"], "unidad": first.get("unidad"),
            "veces": len(its),
            "cantidad_total": round(sum(float(i["cantidad"] or 0) for i in its), 4),
            "total_excel": total_excel,
            "codigos": [i["codigo"] for i in its],
            "estado": estado, "motivo_rojo": motivo, "receta": receta, "sugerencias": sugerencias,
            "pregunta": pregunta, "avisos": avisos, "precios_faltantes": faltantes,
        })
    tareas.sort(key=lambda t: (ESTADOS.index(t["estado"]), -t["total_excel"]))

    cuenta = {e: sum(1 for t in tareas if t["estado"] == e) for e in ESTADOS}
    return {
        "catalogo_oficial": book.hay_oficial,
        "excel_con_precios": con_precios,
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


# Words too common in obra titles and file names to tell two obras apart
_TITULO_GENERICAS = {"EDIFICIO", "OBRA", "COMPUTO", "PRESUPUESTO", "CASA", "TORRE"}


def _titulo_palabras(text: object) -> set[str]:
    return {w for w in re.findall(r"[A-Z]+", plain(text)) if len(w) >= 4 and w not in _TITULO_GENERICAS}


def titulo_dudoso(titulo: object, archivo: object) -> bool:
    """True when the Excel's title (cell A1) and the file name share no word: maybe another obra.

    Words of 4 letters or more, without accents, leaving out the generic ones (EDIFICIO,
    OBRA, COMPUTO, PRESUPUESTO, CASA, TORRE). Ginkgo: title "EDIFICIO LAS HERAS", file
    "EDIFICIO GINKGO_Computo y Presupuesto_V2.xlsx" → True. When the file name or the
    title has no such word ("obra.xlsx"), there is nothing to compare: False.
    """
    nombre = re.sub(r"\.[A-Za-z0-9]+$", "", str(archivo or "").replace("\\", "/").rsplit("/", 1)[-1])
    del_titulo, del_archivo = _titulo_palabras(titulo), _titulo_palabras(nombre)
    if not del_titulo or not del_archivo:
        return False
    return not (del_titulo & del_archivo)


def _public(result: dict) -> dict:
    return {k: v for k, v in result.items() if not k.startswith("_")}


@router.post("/analizar")
async def analizar_obra(
    file: UploadFile = File(...),
    asignaciones: str | None = Form(None),
    user: dict = Depends(require_editor),
):
    """Revisa el Excel de la obra. No escribe nada."""
    wb = await _read_workbook(file)
    db = get_data_db()
    org_id = user["org_id"]
    templates = _templates(db, org_id)
    if not templates:
        raise HTTPException(409, "No hay fórmulas cargadas en la app: primero hay que importar el Maestro")
    result = analyze(parse_obra(wb), templates, PriceBook(db, org_id, today()), _asignaciones(asignaciones),
                     _memoria(db, org_id), excel_prices(wb))
    return {"archivo": file.filename, "titulo_dudoso": titulo_dudoso(result["titulo"], file.filename),
            **_public(result)}


# ── Carga ────────────────────────────────────────────────────────────────────


def _insert(db, table: str, rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for start in range(0, len(rows), CHUNK):
        res = db.table(table).insert(rows[start:start + CHUNK]).execute()
        if len(res.data or []) != len(rows[start:start + CHUNK]):
            raise RuntimeError(f"No se pudieron guardar todas las filas en {table}")
        out += res.data
    return out


PARA_CONFIRMAR = "Para confirmar."


def _item_row(item: dict, budget_id: str, org_id: str, templates: dict[str, dict],
              amarillas: set[str] | frozenset[str] = frozenset()) -> dict:
    """``amarillas``: task keys loaded without confirming; their notes end in "Para confirmar."."""
    ex = item.get("excel") or {}
    es_item = item["nivel"] == "item"
    sin = es_item and not item.get("plantilla")
    qty = item["cantidad"]
    mat = float(ex.get("mat_unit", 0)) if sin else 0.0
    mo = float(ex.get("mo_unit", 0)) if sin else 0.0
    directo = round(mat * (qty or 0), 2) + round(mo * (qty or 0), 2)
    notas = item_notes(item)
    if es_item and item.get("clave") in amarillas:
        notas = f"{notas} {PARA_CONFIRMAR}" if notas else PARA_CONFIRMAR
    return {
        "budget_id": budget_id, "org_id": org_id, "code": item["codigo"],
        "description": item["descripcion"], "unidad": item["unidad"], "cantidad": qty,
        "mat_unitario": mat, "mo_unitario": mo,
        "mat_total": round(mat * (qty or 0), 2), "mo_total": round(mo * (qty or 0), 2),
        "directo_total": directo, "indirecto_total": 0, "beneficio_total": 0, "neto_total": directo,
        "notas": notas, "sort_order": item["orden"],
        "template_id": templates[item["plantilla"]]["id"] if item.get("plantilla") else None,
        "parametros": item.get("parametros") or {},
        # What the obra's Excel said (columns N and Z of 01_C&P), for "Ver diferencias con el Excel"
        "excel_directo": float(ex.get("directo") or 0) if es_item else None,
        "excel_neto": float(ex.get("neto") or 0) if es_item else None,
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
        entry, precio, fecha, problema = book.price(row)
        con_precio = entry is not None and problema is None  # a dated $0 is a price too
        row.update({
            "item_id": item_id, "org_id": org_id, "precio_unitario": precio or 0,
            "catalog_entry_id": entry["id"] if con_precio else None,
            "precio_fecha": fecha if con_precio else None,
        })
        calc_resource_subtotal(row)
        rows.append(row)
    return rows


def _plural(n: int, one: str, many: str) -> str:
    return (one if n == 1 else many).format(n=n)


def _sin_confirmar(tareas: list[dict]) -> dict:
    """Yellow tasks loaded as they were: with the proposed recipe or with the Excel price."""
    amarillas = sorted((t for t in tareas if t["estado"] == "amarillo"), key=lambda t: -t["total_excel"])
    con_receta = sum(1 for t in amarillas if t["receta"] is not None)
    return {"total": len(amarillas), "con_receta": con_receta, "sin_receta": len(amarillas) - con_receta,
            "claves": [t["clave"] for t in amarillas]}


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
    user: dict = Depends(require_editor),
):
    """Carga la obra como presupuesto nuevo y lo recalcula entero."""
    from app.routers.analysis import _run_cascade  # same recalculation as "Recalcular obra"

    inicio = time.perf_counter()
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
    t0 = time.perf_counter()
    result = analyze(parse_obra(wb), templates, book, elegidas, memoria, excel_prices(wb))
    tiempos = {"analisis_s": time.perf_counter() - t0}

    rojos = [t for t in result["tareas"] if t["estado"] == "rojo"]
    duros = [t["clave"] for t in rojos if t["motivo_rojo"] != "precio"]
    plan = result["_plan"]
    if duros or plan["sin_factor"] or plan["plantillas_faltantes"]:
        sin_receta = bool(duros) and all(t["motivo_rojo"] == "sin_receta" for t in rojos if t["clave"] in duros)
        if sin_receta:
            mensaje = _plural(len(duros),
                              "Hay {n} trabajo sin fórmula y sin precio en el Excel: elegí una fórmula antes de cargar",
                              "Hay {n} trabajos sin fórmula y sin precio en el Excel: elegí una fórmula antes de cargar")
        else:
            mensaje = _plural(len(duros) or len(rojos), "Hay {n} trabajo en rojo: resolvelo antes de cargar",
                              "Hay {n} trabajos en rojo: resolvelos antes de cargar")
        raise HTTPException(409, {"mensaje": mensaje, "rojos": duros or [t["clave"] for t in rojos]})
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
        "description": "Cantidades del Excel de la obra; precios con las fórmulas del Maestro",
        "indirectos": initial_indirects(db, org_id), "precios_al": book.fecha.isoformat(),
    }).execute().data[0]
    budget_id = budget["id"]

    sin_confirmar = _sin_confirmar(result["tareas"])
    amarillas = set(sin_confirmar["claves"])
    try:
        t0 = time.perf_counter()
        ids: dict[int, str] = {}
        # Rubros, then pisos, then ítems: each level needs its parent's id
        for nivel in ("rubro", "subrubro", "item"):
            level = [i for i in plan["items"] if i["nivel"] == nivel]
            rows = []
            for i in level:
                row = _item_row(i, budget_id, org_id, templates, amarillas)
                row["parent_id"] = ids.get(i["parent"]) if i["parent"] is not None else None
                rows.append(row)
            for saved in _insert(db, "budget_items", rows):
                ids[saved["sort_order"]] = saved["id"]
        tiempos["items_s"] = time.perf_counter() - t0

        t0 = time.perf_counter()
        org_waste = load_org_config(db, org_id).get("desperdicio_pct")
        resources = []
        for i in plan["items"]:
            if i.get("recursos"):
                resources += _resource_rows(i, ids[i["orden"]], org_id, templates, book, org_waste)
        _insert(db, "item_resources", resources)
        tiempos["recursos_s"] = time.perf_counter() - t0

        t0 = time.perf_counter()
        items = db.table("budget_items").select("*").eq("budget_id", budget_id).execute().data or []
        cascade = _run_cascade(db, org_id, budget, items, strict=True)
        tiempos["cascada_s"] = time.perf_counter() - t0
    except Exception as exc:
        logger.exception("Carga de obra fallida; se borra el presupuesto %s", budget_id)
        db.table("budgets").delete().eq("id", budget_id).eq("org_id", org_id).execute()
        raise HTTPException(500, f"No se pudo cargar la obra (no quedó nada a medias): {exc}") from exc

    guardada = _save_memory(db, org_id, result, elegidas, memoria)
    loaded = [i for i in plan["items"] if i["nivel"] == "item"]
    tiempos["total_s"] = time.perf_counter() - inicio
    tiempos = {k: round(v, 1) for k, v in tiempos.items()}
    logger.info("Carga de obra %s: %s", budget_id, tiempos)
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
        "sin_confirmar": sin_confirmar,
        "tiempos": tiempos,
    }


# ── Diferencias con el Excel ─────────────────────────────────────────────────

SIN_EXCEL = ('Este presupuesto no tiene guardados los totales del Excel. Cargá la obra de nuevo desde '
             '"Cargar obra" para poder compararla.')
SIN_PRECIOS_EXCEL = "Este Excel no traía precios: no hay con qué comparar."
PARECIDO_PCT = 5.0  # |diferencia| up to this % of the Excel counts as "parecido"


def _money(value: float) -> float:
    return round(value, 2)


def _diff(app: float, excel: float) -> tuple[float, float | None]:
    """(app − excel, % over the Excel with 1 decimal; None when the Excel says 0)."""
    diferencia = _money(app - excel)
    return diferencia, (round(diferencia / excel * 100, 1) if excel else None)


def _margin(neto: float, directo: float) -> float | None:
    """Markup over the direct cost, in % with 1 decimal (neto / directo − 1); None without a direct cost."""
    return round((neto / directo - 1) * 100, 1) if directo else None


def _comparison(app_neto: float, excel_neto: float, app_directo: float, excel_directo: float) -> dict:
    diferencia, pct = _diff(app_neto, excel_neto)
    diferencia_directo, pct_directo = _diff(app_directo, excel_directo)
    return {"app_neto": _money(app_neto), "excel_neto": _money(excel_neto), "diferencia": diferencia,
            "diferencia_pct": pct, "app_directo": _money(app_directo), "excel_directo": _money(excel_directo),
            "diferencia_directo": diferencia_directo, "diferencia_directo_pct": pct_directo,
            "margen_app_pct": _margin(app_neto, app_directo), "margen_excel_pct": _margin(excel_neto, excel_directo)}


def _level_comparison(app_nivel: float, excel_neto: float) -> dict:
    """The app up to where the Excel goes, against the Excel's final price (excel_neto)."""
    diferencia, pct = _diff(app_nivel, excel_neto)
    return {"app_nivel": _money(app_nivel), "diferencia_nivel": diferencia, "diferencia_nivel_pct": pct}


MODOS = {
    "neto": ("diferencia_pct", "app_neto"),
    "directo": ("diferencia_directo_pct", "app_directo"),
    "nivel": ("diferencia_nivel_pct", "app_nivel"),
}

# Levels of the cascade, in order: what each one adds to the direct cost (budget_items columns)
NIVELES = ("directo", "indirectos", "beneficio", "neto")
HASTA = {"indirectos": "los indirectos", "beneficio": "el beneficio", "neto": "los impuestos"}
SIN_MARGEN = 1.0005  # an Excel that adds up to 0.05 % over the direct cost adds nothing


def _app_level(item: dict, nivel: str) -> float:
    """What the app says for an item up to ``nivel`` (old items may have null indirect/benefit: 0)."""
    if nivel == "neto":
        return _amount(item.get("neto_total"))
    total = _amount(item.get("directo_total"))
    if nivel in ("indirectos", "beneficio"):
        total += _amount(item.get("indirecto_total"))
    if nivel == "beneficio":
        total += _amount(item.get("beneficio_total"))
    return total


def _app_factors(config: dict) -> dict[str, float]:
    """Price over direct cost at each level, with the same % (and defaults) as calc_cascade_indirects."""
    def pct(key: str) -> float:
        return pct_or_default(config, key, INDIRECT_DEFAULTS[key]) / 100

    f_ind = 1 + sum(pct(k) for k in ("imprevistos_pct", "estructura_pct", "jefatura_pct", "logistica_pct",
                                      "herramientas_pct"))
    f_ben = f_ind * (1 + pct("beneficio_pct"))
    f_neto = f_ben * (1 + pct("ingresos_brutos_pct") + pct("imp_cheque_pct"))
    return {"directo": 1.0, "indirectos": f_ind, "beneficio": f_ben, "neto": f_neto}


def _pct_text(value: float) -> str:
    """34.0 -> '34', 33.75 -> '33,8' (Argentine decimal comma)."""
    rounded = round(value, 1)
    return f"{rounded:.0f}" if rounded == int(rounded) else f"{rounded:.1f}".replace(".", ",")


def _excel_level(excel_neto: float, excel_directo: float, factores: dict[str, float]) -> dict:
    """How far the Excel goes over the direct cost: the app level whose factor is closest to the Excel's."""
    if not excel_directo:  # no direct cost in the Excel: only its final price can be compared
        return {"nivel": "neto", "factor_excel": None, "factor_app": round(factores["neto"], 4),
                "texto": "Tu Excel no trae el costo directo: comparo el precio final."}
    r = excel_neto / excel_directo
    if r <= SIN_MARGEN:
        nivel = "directo"
        texto = "Tu Excel no le suma nada al costo directo: comparo costo directo."
    else:
        nivel = min(NIVELES[1:], key=lambda n: abs(factores[n] - r))  # ties: the lower level
        texto = (f"Tu Excel le suma {_pct_text((r - 1) * 100)}% al costo directo: llega hasta {HASTA[nivel]}. "
                 "Comparo la app hasta ahí.")
    return {"nivel": nivel, "factor_excel": round(r, 4), "factor_app": round(factores[nivel], 4), "texto": texto}


def _how_different(t: dict, modo: str = "neto") -> str:
    """'mas_caros', 'mas_baratos' or 'parecidos' (the app against the Excel), by final price or direct cost."""
    pct_key, app_key = MODOS[modo]
    pct = t[pct_key]
    if pct is None:  # the Excel says 0
        return "mas_caros" if t[app_key] > 0 else "mas_baratos" if t[app_key] < 0 else "parecidos"
    return "mas_caros" if pct > PARECIDO_PCT else "mas_baratos" if pct < -PARECIDO_PCT else "parecidos"


def _amount(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


@router.get("/{budget_id}/diferencias")
async def diferencias_con_excel(
    budget_id: UUID, user: dict = Depends(get_current_user), modo: str = Query("neto"),
):
    """Compara, trabajo por trabajo, lo que calcula la app contra lo que decía el Excel. No escribe nada.

    Además de costo directo y precio final, compara "al nivel del Excel": la app hasta donde llega el
    Excel (directo, indirectos, beneficio o impuestos). ``modo`` (neto, directo o nivel) elige el orden.
    """
    if modo not in MODOS:
        raise HTTPException(422, f"modo debe ser uno de: {', '.join(MODOS)}")
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)
    budgets = db.table("budgets").select("*").eq("id", bid).eq("org_id", org_id).limit(1).execute().data or []
    if not budgets:
        raise HTTPException(404, "Presupuesto no encontrado")
    budget = budgets[0]

    rows = fetch_all(
        lambda: db.table("budget_items").select("*").eq("budget_id", bid).eq("org_id", org_id).order("id")
    )
    by_id = {str(r["id"]): r for r in rows}
    items = sorted(
        (r for r in rows if r.get("notas") != "Seccion" and r.get("excel_neto") is not None),
        key=lambda r: (r.get("sort_order") is None, r.get("sort_order") or 0),
    )
    if not items:
        raise HTTPException(409, SIN_EXCEL)
    # An Excel that came only with quantities: comparing against zeros says nothing
    if not any(_amount(i.get("excel_neto")) or _amount(i.get("excel_directo")) for i in items):
        raise HTTPException(409, SIN_PRECIOS_EXCEL)

    grupos: dict[str, list[dict]] = {}
    for item in items:
        grupos.setdefault(task_key(item.get("description") or "", item.get("unidad")), []).append(item)

    nivel_excel = _excel_level(sum(_amount(i.get("excel_neto")) for i in items),
                               sum(_amount(i.get("excel_directo")) for i in items),
                               _app_factors(budget_config(db, org_id, budget)))
    nivel = nivel_excel["nivel"]

    template_ids = sorted({str(g[0]["template_id"]) for g in grupos.values() if g[0].get("template_id")})
    recetas: dict[str, dict] = {}
    if template_ids:
        for t in db.table("item_templates").select("*").eq("org_id", org_id).in_("id", template_ids).execute().data or []:
            recetas[str(t["id"])] = {"codigo": t.get("codigo"), "nombre": t.get("nombre")}

    trabajos = []
    for clave, its in grupos.items():
        first = its[0]
        cantidad = round(sum(_amount(i.get("cantidad")) for i in its), 4)
        receta = recetas.get(str(first.get("template_id"))) if first.get("template_id") else None
        comp = _comparison(*(sum(_amount(i.get(k)) for i in its)
                             for k in ("neto_total", "excel_neto", "directo_total", "excel_directo")))
        comp.update(_level_comparison(sum(_app_level(i, nivel) for i in its), comp["excel_neto"]))
        detalle = []
        for i in its:
            parent = by_id.get(str(i.get("parent_id"))) if i.get("parent_id") else None
            app_neto, excel_neto = _amount(i.get("neto_total")), _amount(i.get("excel_neto"))
            app_directo, excel_directo = _amount(i.get("directo_total")), _amount(i.get("excel_directo"))
            detalle.append({
                "id": i["id"], "code": i.get("code"), "piso": parent.get("description") if parent else None,
                "cantidad": _amount(i.get("cantidad")), "app_neto": _money(app_neto), "excel_neto": _money(excel_neto),
                "diferencia": _diff(app_neto, excel_neto)[0],
                "app_directo": _money(app_directo), "excel_directo": _money(excel_directo),
                "diferencia_directo": _diff(app_directo, excel_directo)[0],
                "app_nivel": _money(_app_level(i, nivel)),
                "diferencia_nivel": _diff(_app_level(i, nivel), excel_neto)[0],
            })
        trabajos.append({
            "clave": clave, "descripcion": first.get("description"), "unidad": first.get("unidad"),
            "veces": len(its), "cantidad_total": cantidad,
            "receta": receta, "sin_receta": receta is None,
            **comp,
            "app_unitario": _money(comp["app_neto"] / cantidad) if cantidad else None,
            "excel_unitario": _money(comp["excel_neto"] / cantidad) if cantidad else None,
            "app_unitario_directo": _money(comp["app_directo"] / cantidad) if cantidad else None,
            "excel_unitario_directo": _money(comp["excel_directo"] / cantidad) if cantidad else None,
            "app_unitario_nivel": _money(comp["app_nivel"] / cantidad) if cantidad else None,
            "items": detalle,
        })
    diferencia_key = MODOS[modo][0].removesuffix("_pct")  # diferencia, diferencia_directo, diferencia_nivel
    trabajos.sort(key=lambda t: -abs(t[diferencia_key]))

    clases = [_how_different(t) for t in trabajos]
    clases_directo = [_how_different(t, "directo") for t in trabajos]
    clases_nivel = [_how_different(t, "nivel") for t in trabajos]
    total = _comparison(*(sum(_amount(i.get(k)) for i in items)
                          for k in ("neto_total", "excel_neto", "directo_total", "excel_directo")))
    total.update(_level_comparison(sum(_app_level(i, nivel) for i in items), total["excel_neto"]))
    return {
        "budget_id": bid,
        "nombre": budget.get("name"),
        "precios_al": budget.get("precios_al"),
        "source_file": budget.get("source_file"),
        "nivel_excel": nivel_excel,
        "total": total,
        "resumen": {
            "trabajos": len(trabajos),
            "mas_caros": clases.count("mas_caros"),
            "mas_baratos": clases.count("mas_baratos"),
            "parecidos": clases.count("parecidos"),
            "sin_receta": sum(1 for t in trabajos if t["sin_receta"]),
            "directo": {
                "mas_caros": clases_directo.count("mas_caros"),
                "mas_baratos": clases_directo.count("mas_baratos"),
                "parecidos": clases_directo.count("parecidos"),
            },
            "nivel": {
                "mas_caros": clases_nivel.count("mas_caros"),
                "mas_baratos": clases_nivel.count("mas_baratos"),
                "parecidos": clases_nivel.count("parecidos"),
            },
            "app_neto": total["app_neto"],  # precio final de la app (con todo), whatever the level
        },
        "trabajos": trabajos,
    }
