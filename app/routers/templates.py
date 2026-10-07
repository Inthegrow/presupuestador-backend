"""
Item template library — reusable compositions for standard construction items.

Fase 2 (recetas): each resource can have a formula (Q = item quantity), the
template has parameters with default values, waste is inherited
(organización → plantilla → presupuesto → recurso). See app/recipes.py.
"""
from __future__ import annotations

import json
import logging
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user, require_editor
from app.budget_prices import fetch_all, today
from app.calculations import (
    calc_item_from_resources,
    calc_resource_subtotal,
)
from app.catalog_prices import normalize_codigo, parse_fecha
from app.db import get_data_db
from app.formulas import FormulaError
from app.obra_import import (
    _scale,
    _scale_rendimiento,
    espesor_m_from,
    match_recipe,
    suggest_recipes,
    unit_key,
)
from app.recipes import expand_resource, merge_params, param_defaults, validate_template
from app.routers.analysis import _restore, _run_cascade, _snapshot
from app.routers.obras import MOTIVOS, PriceBook, _human, _memoria, _proposal, _templates
from app.schemas import TemplateApply, TemplateCreate, TemplatePreview, TemplateUpdate

logger = logging.getLogger(__name__)

router = APIRouter()

NO_SE_APLICO = "No se pudo aplicar la fórmula. El trabajo quedó como estaba; probá de nuevo."
A_MEDIAS = "No se pudo aplicar la fórmula y el presupuesto puede haber quedado a medias. Avisá antes de seguir."


def _json_list(value: object) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def _check_template(recursos: list[dict], parametros: list[dict]) -> None:
    errors = validate_template(recursos, parametros)
    if errors:
        raise HTTPException(422, errors)


def _budget_items(db, budget_id: str, org_id: str) -> list[dict]:
    """Every item of the budget (all pages), in a stable order."""
    return fetch_all(
        lambda: db.table("budget_items").select("*")
        .eq("budget_id", budget_id).eq("org_id", org_id).order("id")
    )


def _precios_al(budget: dict) -> date:
    """Date the budget is priced at: its "precios al", or today when it has none."""
    try:
        return parse_fecha(budget.get("precios_al")) or today()
    except ValueError:
        return today()


# ── Unit conversion when applying (same normalization as Cargar obra) ───────

_UNIDAD_LEGIBLE = {"m2": "m²", "m3": "m³"}


def _unidad_legible(unidad: object) -> str:
    """'m2' / 'M2' / 'm²' → 'm²'; any other unit as it is written."""
    return _UNIDAD_LEGIBLE.get(unit_key(unidad), str(unidad or "").strip())


def factor_propuesto(descripcion: str, unidad_trabajo: object, template: dict) -> float | None:
    """Units of the recipe per unit of the item to propose, or None.

    m³ recipe on a m² item: the thickness in the name ("e=8cm" → 0.08). Otherwise, the
    rule of Cargar obra (match_recipe) when it uses this recipe and was written for the
    item's unit: its fixed factor, or its "factor_defecto" (0.10 for a contrapiso).
    """
    uf, ut = unit_key(template.get("unidad")), unit_key(unidad_trabajo)
    if uf == "m3" and ut == "m2":
        espesor = espesor_m_from(descripcion)
        if espesor:
            return espesor
    rule = match_recipe(descripcion or "")
    codigo = str(template.get("codigo") or "")
    if not rule or not codigo:
        return None
    # The recipes of the rule and of its alternative (the rule before a correction, see MAPEO)
    pares = list(rule["plantillas"]) + list((rule.get("alternativa") or {}).get("plantillas") or [])
    for code, factor in pares:
        if str(code) != codigo:
            continue
        # A fixed factor converts from the unit the rule was written for ("obra")
        if factor is not None and rule.get("obra") and unit_key(rule["obra"]) == ut:
            return float(factor)
        return rule.get("factor_defecto")
    return None


def _num(value: object) -> float | None:
    try:
        return float(str(value).replace(",", ".")) if isinstance(value, str) else float(value)
    except (TypeError, ValueError):
        return None


def scale_resource(resource: dict, factor: float) -> dict:
    """Template resource in item units: Q → (Q*factor), like Cargar obra (expand_item).

    The scaled formula / rendimiento is what item_resources keeps, so a later
    recalculation (quantity change, parameters, cascade) gives the same result.
    Old resources without a formula scale their per-unit quantity (they are never
    re-evaluated).
    """
    if factor == 1:
        return resource
    scaled = dict(resource)
    scaled["formula"] = _scale(resource.get("formula"), factor)
    scaled["rendimiento"] = _scale_rendimiento(resource.get("rendimiento"), factor)
    if resource.get("formula") in (None, "") and _num(resource.get("cantidad_por_unidad")) is not None:
        scaled["cantidad_por_unidad"] = _num(resource["cantidad_por_unidad"]) * factor
    if resource.get("rendimiento") in (None, "") and _num(resource.get("trabajadores_por_unidad")) is not None:
        scaled["trabajadores_por_unidad"] = _num(resource["trabajadores_por_unidad"]) * factor
    return scaled


MOTIVO_NO_ESTA_OFICIAL = "No está en la lista oficial"


def _motivo(problema: str, hay_oficial: bool) -> str:
    if problema == "no_esta" and hay_oficial:
        return MOTIVO_NO_ESTA_OFICIAL
    return MOTIVOS.get(problema) or MOTIVO_NO_ESTA_OFICIAL


def org_waste_pct(db, org_id: str) -> float | None:
    """Organization default waste % (indirect_config.desperdicio_pct)."""
    try:
        result = (
            db.table("indirect_config")
            .select("*")
            .eq("org_id", org_id)
            .limit(1)
            .execute()
        )
    except Exception:
        return None
    rows = result.data or []
    return rows[0].get("desperdicio_pct") if rows else None


@router.get("")
async def list_templates(categoria: str = None, user: dict = Depends(get_current_user)):
    """List all templates, optionally filtered by category."""
    db = get_data_db()
    org_id = user["org_id"]
    query = db.table("item_templates").select("*").eq("org_id", org_id)
    if categoria:
        query = query.eq("categoria", categoria)
    result = query.order("categoria").execute()
    return result.data or []


@router.get("/categories")
async def list_categories(user: dict = Depends(get_current_user)):
    """List distinct categories used in templates."""
    db = get_data_db()
    org_id = user["org_id"]
    result = db.table("item_templates").select("categoria").eq("org_id", org_id).execute()
    cats = sorted(set(r["categoria"] for r in (result.data or []) if r.get("categoria")))
    return cats


MAX_PARECIDAS = 3


def _formula_view(tmpl: dict) -> dict:
    return {k: tmpl.get(k) for k in ("id", "codigo", "nombre", "unidad", "categoria")}


def sugerir_formula(
    descripcion: str, unidad: str, templates: dict[str, dict], memoria: dict[str, dict]
) -> dict:
    """The recipe Cargar obra would propose for a task (memoria > regla) and up to 3 similar ones.

    Only a decision with one recipe is a proposal; when the rule combines several, they go
    first among the similar ones ("Cargar obra usa A + B para este trabajo").
    """
    descripcion = (descripcion or "").strip()
    if not descripcion:
        return {"propuesta": None, "parecidas": []}
    base = _proposal({"descripcion": descripcion, "unidad": unidad, "cantidad": 1, "codigo": ""},
                     templates, memoria)
    pares = [p for p in (base or {}).get("pares") or [] if str(p[0]) in templates]
    propuesta, parecidas = None, []
    if base and len(pares) == 1 and len(base["pares"]) == 1:
        codigo, factor = str(pares[0][0]), pares[0][1]
        propuesta = {**_formula_view(templates[codigo]), "origen": base["origen"],
                     "porque": base["porque"], "factor": factor}
    elif base and len(base["pares"]) > 1 and pares:
        nombres = " + ".join(_human((templates.get(str(p[0])) or {}).get("nombre") or p[0])
                             for p in base["pares"])
        porque = f"Cargar obra usa {nombres} para este trabajo"
        parecidas = [{**_formula_view(templates[str(p[0])]), "porque": porque, "puntaje": 1.0}
                     for p in pares]
    combinadas = len(parecidas)
    vistos = {p["codigo"] for p in parecidas} | ({propuesta["codigo"]} if propuesta else set())
    top = MAX_PARECIDAS + len(vistos)
    for codigo, puntaje, porque in suggest_recipes(descripcion, templates, top=top):
        if codigo not in vistos:
            parecidas.append({**_formula_view(templates[codigo]), "porque": porque,
                              "puntaje": puntaje})
    return {"propuesta": propuesta, "parecidas": parecidas[:max(MAX_PARECIDAS, combinadas)]}


@router.get("/sugerir")
async def sugerir(descripcion: str = "", unidad: str = "", user: dict = Depends(get_current_user)):
    """The "Quizás sea:" of the formula window: Cargar obra's proposal plus similar recipes."""
    if not (descripcion or "").strip():
        return {"propuesta": None, "parecidas": []}
    db = get_data_db()
    org_id = user["org_id"]
    return sugerir_formula(descripcion, unidad, _templates(db, org_id), _memoria(db, org_id))


@router.get("/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    db = get_data_db()
    org_id = user["org_id"]
    result = (
        db.table("item_templates")
        .select("*")
        .eq("id", template_id)
        .eq("org_id", org_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Fórmula no encontrada")
    return result.data[0]


@router.post("")
async def create_template(body: TemplateCreate, user: dict = Depends(require_editor)):
    db = get_data_db()
    org_id = user["org_id"]
    parametros = [p.model_dump() for p in body.parametros]
    _check_template(body.recursos, parametros)
    data = {
        "org_id": org_id,
        "nombre": body.nombre,
        "descripcion": body.descripcion,
        "unidad": body.unidad,
        "categoria": body.categoria,
        "recursos": body.recursos,
        "parametros": parametros,
        "desperdicio_pct": body.desperdicio_pct,
    }
    result = db.table("item_templates").insert(data).execute()
    if not result.data:
        raise HTTPException(500, "No se pudo crear la fórmula. Probá de nuevo.")
    return result.data[0]


@router.patch("/{template_id}")
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    user: dict = Depends(require_editor),
):
    db = get_data_db()
    org_id = user["org_id"]
    # exclude_unset: an explicit null in desperdicio_pct means "inherit again"
    updates = body.model_dump(exclude_unset=True)
    for key in ("nombre", "recursos", "parametros"):
        if key in updates and updates[key] is None:
            del updates[key]
    if not updates:
        raise HTTPException(400, "No hay campos para actualizar")

    current = (
        db.table("item_templates")
        .select("*")
        .eq("id", template_id)
        .eq("org_id", org_id)
        .execute()
    )
    if not current.data:
        raise HTTPException(404, "Fórmula no encontrada")
    if "recursos" in updates or "parametros" in updates:
        recursos = updates.get("recursos", _json_list(current.data[0].get("recursos")))
        parametros = updates.get("parametros", _json_list(current.data[0].get("parametros")))
        _check_template(recursos, parametros)
    # Edited by hand: importing the Maestro again must not overwrite it.
    # Only when the column exists (migration 007).
    if "editado" in current.data[0]:
        updates["editado"] = True

    result = (
        db.table("item_templates")
        .update(updates)
        .eq("id", template_id)
        .eq("org_id", org_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Fórmula no encontrada")
    return result.data[0]


@router.delete("/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(require_editor)):
    db = get_data_db()
    org_id = user["org_id"]
    db.table("item_templates").delete().eq("id", template_id).eq("org_id", org_id).execute()
    return {"ok": True}


@router.post("/preview")
async def preview_template(body: TemplatePreview, user: dict = Depends(require_editor)):
    """Calculate a template's quantities for a test quantity (nothing is saved).

    Used by the formula editor. Errors are returned in the body, not as HTTP errors.
    """
    parametros = [p.model_dump() for p in body.parametros]
    errors = validate_template(body.recursos, parametros)
    if errors:
        return {"ok": False, "errores": errors, "recursos": []}

    db = get_data_db()
    org_pct = org_waste_pct(db, user["org_id"])
    params = merge_params(param_defaults(parametros), body.valores)
    rows = []
    try:
        for r in body.recursos:
            row = expand_resource(
                r, body.cantidad, params,
                plantilla_pct=body.desperdicio_pct, organizacion_pct=org_pct,
            )
            row["precio_unitario"] = 0
            calc_resource_subtotal(row)
            rows.append(row)
    except FormulaError as exc:
        return {"ok": False, "errores": [str(exc)], "recursos": []}
    return {
        "ok": True,
        "errores": [],
        "parametros": params,
        "desperdicio_organizacion": org_pct,
        "recursos": rows,
    }


def mensaje_reemplazo(n: int) -> str:
    """Warning before a formula replaces what the item already has."""
    if n == 1:
        return ("Este trabajo ya tiene 1 recurso cargado (material, mano de obra o subcontrato). "
                "La fórmula lo reemplaza.")
    return (f"Este trabajo ya tiene {n} recursos cargados (materiales, mano de obra o subcontratos). "
            "La fórmula los reemplaza.")


def check_factor(factor: float | None) -> None:
    if factor is not None and factor <= 0:
        raise HTTPException(422, ["El factor tiene que ser mayor que cero"])


def conversion_factor(template: dict, descripcion: str, unidad: object, factor: float | None) -> float:
    """Units of the recipe per unit of the item: 1 when they match, else the given factor.

    Without a factor for different units: 409 FALTA_CONVERSION (with the proposed value),
    so the screen asks and sends it again with ``factor``.
    """
    uf, ut = unit_key(template.get("unidad")), unit_key(unidad)
    if not (uf and ut and uf != ut):
        return 1.0
    if factor is None:
        unidad_formula, unidad_trabajo = _unidad_legible(template.get("unidad")), _unidad_legible(unidad)
        raise HTTPException(409, {
            "codigo": "FALTA_CONVERSION",
            "mensaje": (f"La fórmula está en {unidad_formula} y el trabajo en {unidad_trabajo}. "
                        f"¿Cuántos {unidad_formula} hay en 1 {unidad_trabajo}?"),
            "unidad_formula": unidad_formula,
            "unidad_trabajo": unidad_trabajo,
            "factor_propuesto": factor_propuesto(descripcion, unidad, template),
        })
    return float(factor)


def build_rows(
    db, org_id: str, budget: dict, template: dict, item_id: str | None,
    qty: float, params: dict, factor: float,
) -> tuple[list[dict], dict[str, dict]]:
    """The item's resources from the recipe, priced, and the codes without a price.

    Nothing is written. A bad formula raises 422 (before anything is saved).
    """
    org_pct = org_waste_pct(db, org_id)

    # Build every row first: a bad formula must not leave the item half-applied
    rows = []
    try:
        for r in _json_list(template.get("recursos")):
            row = expand_resource(
                scale_resource(r, factor), qty, params,
                presupuesto_pct=budget.get("desperdicio_pct"),
                plantilla_pct=template.get("desperdicio_pct"),
                organizacion_pct=org_pct,
            )
            rows.append(row)
    except FormulaError as exc:
        raise HTTPException(422, [f"Fórmula de la plantilla: {exc}"]) from exc

    # Same price rule as Cargar obra and "Actualizar precios": oficial catalog first,
    # price in force at the budget's "precios al" date (today when it has none)
    book = PriceBook(db, org_id, _precios_al(budget)) if any(r["codigo"] for r in rows) else None
    faltantes: dict[str, dict] = {}
    for row in rows:
        entry, precio, fecha, problema = book.price(row) if book and row["codigo"] else (None, None, None, None)
        con_precio = entry is not None and problema is None  # a dated $0 is a price too
        if row["codigo"] and not con_precio and not row.get("lo_compra_cliente"):
            faltantes.setdefault(normalize_codigo(row["codigo"]) or row["codigo"], {
                "codigo": row["codigo"],
                "descripcion": row.get("descripcion"),
                "motivo": _motivo(problema, book.hay_oficial),
            })
        row.update({
            "item_id": item_id,
            "org_id": org_id,
            "precio_unitario": precio or 0,
            "catalog_entry_id": entry["id"] if con_precio else None,
            # Fase 4: date of the price used
            "precio_fecha": fecha if con_precio else None,
        })
        calc_resource_subtotal(row)
    return rows, faltantes


def save_applied(
    db, org_id: str, budget: dict, template_id: str, item: dict, rows: list[dict], params: dict,
) -> list[dict]:
    """Replace the item's resources with ``rows`` and recalculate the budget: all or nothing.

    Returns the created resources. On a failure everything goes back to how it was and it
    raises 500 NO_SE_APLICO (A_MEDIAS when even that failed).
    """
    budget_id, item_id = str(budget["id"]), str(item["id"])
    # The recipe replaces what the item had (applying twice must not add it twice).
    # Codex (PR #37): all or nothing. The whole budget is read first; if any write fails
    # (resources, the item, the cascade), everything goes back to how it was.
    try:
        items = _budget_items(db, budget_id, org_id)
        before = _snapshot(db, org_id, budget, items)
    except Exception as exc:
        logger.exception("Could not read budget %s before applying template %s", budget_id, template_id)
        raise HTTPException(500, {"codigo": "NO_SE_APLICO", "mensaje": NO_SE_APLICO}) from exc
    anteriores = [r for r in before["resources"] if str(r.get("item_id")) == item_id]

    try:
        db.table("item_resources").delete().eq("item_id", item_id).eq("org_id", org_id).execute()
        created = (db.table("item_resources").insert(rows).execute().data or []) if rows else []
        if len(created) != len(rows):
            raise RuntimeError(f"Se guardaron {len(created)} de {len(rows)} recursos")

        # Recalculate the item from its new resources (non-cost fields + a provisional total)
        all_resources = (
            db.table("item_resources").select("*").eq("item_id", item_id).eq("org_id", org_id).execute()
        )
        updated_item = calc_item_from_resources(dict(item), all_resources.data or [])
        written = db.table("budget_items").update({
            "template_id": template_id,
            "parametros": params,
            "mat_unitario": updated_item["mat_unitario"],
            "mo_unitario": updated_item["mo_unitario"],
        }).eq("id", item_id).eq("org_id", org_id).execute()
        if not written.data:
            raise RuntimeError(f"No se actualizó el ítem {item_id}")
        # Then the same full recalculation as "Recálculo completo" (inherited waste, purchase
        # rounding over the whole budget, cascade indirects), so the item shows its final price
        # right away and a later full recalculation does not move it
        _run_cascade(db, org_id, budget, _budget_items(db, budget_id, org_id), strict=True)
    except Exception as exc:
        logger.exception("Applying template %s to item %s failed", template_id, item_id)
        try:
            # The item's old resources were deleted: put them back with their ids,
            # then every item and resource of the budget as it was
            db.table("item_resources").delete().eq("item_id", item_id).eq("org_id", org_id).execute()
            if anteriores:
                back = db.table("item_resources").insert(anteriores).execute().data or []
                if len(back) != len(anteriores):
                    raise RuntimeError(f"Se restauraron {len(back)} de {len(anteriores)} recursos")
            _restore(db, org_id, before)
        except Exception:
            logger.exception("Could not restore budget %s after a failed apply", budget_id)
            raise HTTPException(500, {"codigo": "A_MEDIAS", "mensaje": A_MEDIAS}) from exc
        raise HTTPException(500, {"codigo": "NO_SE_APLICO", "mensaje": NO_SE_APLICO}) from exc
    return created


@router.post("/{template_id}/apply/{budget_id}/items/{item_id}")
async def apply_template(
    template_id: str,
    budget_id: str,
    item_id: str,
    body: TemplateApply = Body(default=TemplateApply()),
    user: dict = Depends(require_editor),
):
    """Apply a template's resources to an existing budget item.

    Quantities come from each resource's formula (Q = item quantity) with the
    template parameters, replaced by ``body.parametros`` when given. Waste is
    inherited: recurso > presupuesto > plantilla > organización.
    The item keeps template_id and parametros so it can be recalculated later.
    """
    db = get_data_db()
    org_id = user["org_id"]

    tmpl = (
        db.table("item_templates")
        .select("*")
        .eq("id", template_id)
        .eq("org_id", org_id)
        .execute()
    )
    if not tmpl.data:
        raise HTTPException(404, "Fórmula no encontrada")
    template = tmpl.data[0]

    budget = (
        db.table("budgets")
        .select("*")
        .eq("id", budget_id)
        .eq("org_id", org_id)
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    item_result = (
        db.table("budget_items")
        .select("*")
        .eq("id", item_id)
        .eq("budget_id", budget_id)
        .eq("org_id", org_id)
        .execute()
    )
    if not item_result.data:
        raise HTTPException(404, "Trabajo no encontrado")
    item = item_result.data[0]
    qty = float(item.get("cantidad") or 1)

    # Units: the recipe's and the item's must match, or the conversion must be given
    check_factor(body.factor)
    # Codex (PR #37): resources already in the item (loaded by hand, or another recipe)
    # are not replaced without asking. Asked before the conversion, so the screen confirms
    # first and then sends reemplazar=true (and the factor, when it is asked for).
    if not body.reemplazar:
        tiene = (
            db.table("item_resources").select("id").eq("item_id", item_id).eq("org_id", org_id).execute().data
            or []
        )
        if tiene:
            raise HTTPException(409, {
                "codigo": "CONFIRMAR_REEMPLAZO",
                "mensaje": mensaje_reemplazo(len(tiene)),
                "recursos": len(tiene),
            })

    factor = conversion_factor(template, item.get("description") or "", item.get("unidad"), body.factor)
    params = merge_params(param_defaults(_json_list(template.get("parametros"))), body.parametros)
    rows, faltantes = build_rows(db, org_id, budget.data[0], template, item_id, qty, params, factor)
    created = save_applied(db, org_id, budget.data[0], template_id, item, rows, params)

    return {
        "resources_created": len(created),
        "item_updated": True,
        "parametros": params,
        "factor": factor,
        "precios_faltantes": list(faltantes.values()),
    }
