"""
Item template library — reusable compositions for standard construction items.

Fase 2 (recetas): each resource can have a formula (Q = item quantity), the
template has parameters with default values, waste is inherited
(organización → plantilla → presupuesto → recurso). See app/recipes.py.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
from app.calculations import calc_item_from_resources, calc_resource_subtotal
from app.db import get_data_db
from app.formulas import FormulaError
from app.recipes import expand_resource, merge_params, param_defaults, validate_template
from app.schemas import TemplateApply, TemplateCreate, TemplatePreview, TemplateUpdate

router = APIRouter()


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
        raise HTTPException(404, "Template no encontrado")
    return result.data[0]


@router.post("")
async def create_template(body: TemplateCreate, user: dict = Depends(get_current_user)):
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
        raise HTTPException(500, "Error al crear template")
    return result.data[0]


@router.patch("/{template_id}")
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    user: dict = Depends(get_current_user),
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
        raise HTTPException(404, "Template no encontrado")
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
        raise HTTPException(404, "Template no encontrado")
    return result.data[0]


@router.delete("/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(get_current_user)):
    db = get_data_db()
    org_id = user["org_id"]
    db.table("item_templates").delete().eq("id", template_id).eq("org_id", org_id).execute()
    return {"ok": True}


@router.post("/preview")
async def preview_template(body: TemplatePreview, user: dict = Depends(get_current_user)):
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


@router.post("/{template_id}/apply/{budget_id}/items/{item_id}")
async def apply_template(
    template_id: str,
    budget_id: str,
    item_id: str,
    body: TemplateApply = Body(default=TemplateApply()),
    user: dict = Depends(get_current_user),
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
        raise HTTPException(404, "Template no encontrado")
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
        raise HTTPException(404, "Item no encontrado")
    item = item_result.data[0]
    qty = float(item.get("cantidad") or 1)

    recursos = _json_list(template.get("recursos"))
    parametros = _json_list(template.get("parametros"))
    params = merge_params(param_defaults(parametros), body.parametros)
    org_pct = org_waste_pct(db, org_id)

    # Build every row first: a bad formula must not leave the item half-applied
    rows = []
    try:
        for r in recursos:
            row = expand_resource(
                r, qty, params,
                presupuesto_pct=budget.data[0].get("desperdicio_pct"),
                plantilla_pct=template.get("desperdicio_pct"),
                organizacion_pct=org_pct,
            )
            rows.append(row)
    except FormulaError as exc:
        raise HTTPException(422, [f"Fórmula de la plantilla: {exc}"]) from exc

    created = []
    for row in rows:
        catalog_entry = None
        precio = 0.0
        if row["codigo"]:
            ce = (
                db.table("catalog_entries")
                .select("id,precio_sin_iva")
                .eq("org_id", org_id)
                .eq("codigo", row["codigo"])
                .limit(1)
                .execute()
            )
            if ce.data:
                catalog_entry = ce.data[0]
                precio = float(catalog_entry.get("precio_sin_iva") or 0)

        row.update({
            "item_id": item_id,
            "org_id": org_id,
            "precio_unitario": precio,
            "catalog_entry_id": catalog_entry["id"] if catalog_entry else None,
        })
        calc_resource_subtotal(row)
        res = db.table("item_resources").insert(row).execute()
        if res.data:
            created.append(res.data[0])

    # Recalculate item from its new resources
    all_resources = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", item_id)
        .execute()
    )
    updated_item = calc_item_from_resources(dict(item), all_resources.data or [])
    db.table("budget_items").update({
        "template_id": template_id,
        "parametros": params,
        "mat_unitario": updated_item["mat_unitario"],
        "mo_unitario": updated_item["mo_unitario"],
        "mat_total": updated_item["mat_total"],
        "mo_total": updated_item["mo_total"],
        "directo_total": updated_item["directo_total"],
    }).eq("id", item_id).execute()

    return {"resources_created": len(created), "item_updated": True, "parametros": params}
