from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
from app.budget_prices import initial_indirects, today
from app.calculations import (
    calc_budget_summary,
    calc_item_totals,
    pct_or_default,
    recalc_all_items,
)
from app.db import get_data_db
from app.formulas import FormulaError
from app.recipes import ORIGEN_RECURSO, has_formula, requantify_row
from app.schemas import (
    BudgetCopyRequest,
    BudgetCreate,
    BudgetItemCreate,
    BudgetItemUpdate,
    BudgetUpdate,
    BulkResourceCreate,
    CreateFullBudget,
    ItemParamsUpdate,
    ResourceCreate,
    ResourceUpdate,
    SectionCreate,
)
from app.tree import build_tree

logger = logging.getLogger(__name__)

# Fields that are user-editable (not calculated). Used for audit trail.
AUDITABLE_FIELDS = {"cantidad", "mat_unitario", "mo_unitario", "description", "unidad", "code", "notas_calculo"}

router = APIRouter()

# Fase 2 (recetas) columns. Copied only when the source row has them.
_ITEM_RECIPE_FIELDS = ("template_id", "parametros")
_RESOURCE_COPY_FIELDS = (
    "trabajadores", "dias", "cargas_sociales_pct", "catalog_entry_id",
    "formula", "rendimiento", "desperdicio_origen", "lo_compra_cliente",
    "redondear", "unidad_compra", "cantidad_redondeo", "precio_fecha", "template_id",
)


def _get_items(budget_id: str, org_id: str) -> list[dict]:
    db = get_data_db()
    result = (
        db.table("budget_items")
        .select("*")
        .eq("budget_id", budget_id)
        .eq("org_id", org_id)
        .order("sort_order")
        .execute()
    )
    return result.data or []


# ── CRUD presupuestos ────────────────────────────────────────────────────────


@router.post("")
async def create_budget(budget: BudgetCreate, user: dict = Depends(get_current_user)):
    db = get_data_db()
    result = db.table("budgets").insert({
        "org_id": user["org_id"],
        "name": budget.name,
        "description": budget.description,
        "status": "draft",
        # Fase 4: the budget starts with the general indirect % and today's prices
        "indirectos": initial_indirects(db, user["org_id"]),
        "precios_al": today().isoformat(),
    }).execute()
    return result.data[0]


@router.post("/create-full")
async def create_full_budget(payload: CreateFullBudget, user: dict = Depends(get_current_user)):
    """Create a complete budget with sections, items, and indirect config in one request."""
    db = get_data_db()
    org_id = user["org_id"]

    # 1. Create the budget record (indirect % start with the general ones)
    indirectos = initial_indirects(db, org_id)
    if payload.indirectos:
        indirectos.update(payload.indirectos.model_dump())
    budget_data: dict = {
        "org_id": org_id,
        "name": payload.name,
        "description": payload.description,
        "status": "draft",
        "indirectos": indirectos,
        "precios_al": today().isoformat(),
    }
    budget_result = db.table("budgets").insert(budget_data).execute()
    if not budget_result.data:
        raise HTTPException(500, "Error al crear presupuesto")
    budget = budget_result.data[0]
    budget_id = budget["id"]

    # 2. Create sections and their child items
    sort_order = 0
    sections_created = 0
    items_created = 0

    for seccion in (payload.secciones or []):
        # Create section item (parent_id=None, notas="Seccion")
        section_row = {
            "budget_id": budget_id,
            "org_id": org_id,
            "parent_id": None,
            "code": seccion.codigo,
            "description": seccion.nombre,
            "notas": "Seccion",
            "sort_order": sort_order,
            "mat_unitario": 0,
            "mo_unitario": 0,
        }
        section_result = db.table("budget_items").insert(section_row).execute()
        section_id = section_result.data[0]["id"]
        sections_created += 1
        sort_order += 1

        # Create child items under this section
        for item in seccion.items:
            item_row = {
                "budget_id": budget_id,
                "org_id": org_id,
                "parent_id": section_id,
                "code": item.codigo,
                "description": item.descripcion,
                "unidad": item.unidad,
                "cantidad": item.cantidad,
                "mat_unitario": 0,
                "mo_unitario": 0,
                "notas": None,
                "sort_order": sort_order,
            }
            calculated = calc_item_totals(item_row)
            db.table("budget_items").insert(calculated).execute()
            items_created += 1
            sort_order += 1

    # 3. Build summary
    all_items = _get_items(budget_id, org_id)
    summary = calc_budget_summary(all_items)

    return {
        "budget": budget,
        "sections_created": sections_created,
        "items_created": items_created,
        "summary": summary,
    }


@router.get("")
async def list_budgets(user: dict = Depends(get_current_user)):
    db = get_data_db()
    result = (
        db.table("budgets")
        .select("*")
        .eq("org_id", user["org_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.get("/{budget_id}")
async def get_budget(budget_id: UUID, user: dict = Depends(get_current_user)):
    db = get_data_db()
    result = (
        db.table("budgets")
        .select("*")
        .eq("id", str(budget_id))
        .eq("org_id", user["org_id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Presupuesto no encontrado")
    return result.data


@router.patch("/{budget_id}")
async def update_budget(
    budget_id: UUID,
    payload: BudgetUpdate,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(400, "No hay campos para actualizar")
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        db.table("budgets")
        .update(update_data)
        .eq("id", str(budget_id))
        .eq("org_id", user["org_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Presupuesto no encontrado")
    return result.data[0]


@router.delete("/{budget_id}")
async def delete_budget(budget_id: UUID, user: dict = Depends(get_current_user)):
    db = get_data_db()
    result = (
        db.table("budgets")
        .delete()
        .eq("id", str(budget_id))
        .eq("org_id", user["org_id"])
        .execute()
    )
    return {"deleted": bool(result.data)}


# ── Items ────────────────────────────────────────────────────────────────────


@router.post("/{budget_id}/items")
async def create_items(
    budget_id: UUID,
    items: list[BudgetItemCreate],
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    to_insert = []
    for i, item in enumerate(items):
        raw = {
            "budget_id": str(budget_id),
            "org_id": user["org_id"],
            "parent_id": str(item.parent_id) if item.parent_id else None,
            "code": item.code,
            "description": item.description,
            "unidad": item.unidad,
            "cantidad": item.cantidad,
            "mat_unitario": item.mat_unitario or 0,
            "mo_unitario": item.mo_unitario or 0,
            "indirecto_total": item.indirecto_total or 0,
            "beneficio_total": item.beneficio_total or 0,
            "notas": item.notas,
            "sort_order": i,
        }
        calculated = calc_item_totals(raw)
        to_insert.append(calculated)
    result = db.table("budget_items").insert(to_insert).execute()
    return {"inserted": len(result.data)}


@router.patch("/{budget_id}/items/{item_id}")
async def update_item(
    budget_id: UUID,
    item_id: UUID,
    payload: BudgetItemUpdate,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)
    iid = str(item_id)

    existing = (
        db.table("budget_items")
        .select("*")
        .eq("id", iid)
        .eq("budget_id", bid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Item no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "parent_id" in update_data:
        v = update_data["parent_id"]
        update_data["parent_id"] = str(v) if v else None

    # Merge existing data with updates, then recalculate totals
    merged = {**existing.data, **update_data}
    recalculated = calc_item_totals(merged)

    # Extract only the cost fields that were recalculated
    cost_fields = ("mat_total", "mo_total", "directo_total", "neto_total")
    for field in cost_fields:
        update_data[field] = recalculated[field]
    # Also ensure indirecto_total and beneficio_total are rounded
    if "indirecto_total" in update_data:
        update_data["indirecto_total"] = recalculated["indirecto_total"]
    if "beneficio_total" in update_data:
        update_data["beneficio_total"] = recalculated["beneficio_total"]

    changes = {}
    for field, new_val in update_data.items():
        old_val = existing.data.get(field)
        if old_val != new_val:
            changes[field] = {"before": old_val, "after": new_val}

    if not changes:
        return {"message": "Sin cambios", "item": existing.data}

    db.table("budget_items").update(update_data).eq("id", iid).execute()

    # Recetas: resources with formula / rendimiento follow the new quantity
    if "cantidad" in changes:
        try:
            _requantify_item(db, {**existing.data, **update_data}, org_id)
        except FormulaError as exc:
            logger.warning("Formula error recalculating item %s: %s", iid, exc)

    updated = (
        db.table("budget_items")
        .select("*")
        .eq("id", iid)
        .single()
        .execute()
    )

    # Insert per-field audit records into item_audits table.
    # NOTE: The item_audits table must be created via migrations/002_item_audits.sql.
    # If the table does not exist yet, the insert will fail silently.
    try:
        audit_records = []
        for field_name, change in changes.items():
            if field_name in AUDITABLE_FIELDS:
                audit_records.append({
                    "item_id": iid,
                    "budget_id": bid,
                    "org_id": org_id,
                    "user_id": user["user_id"],
                    "field": field_name,
                    "old_value": str(change["before"]) if change["before"] is not None else None,
                    "new_value": str(change["after"]) if change["after"] is not None else None,
                    "source": "manual_edit",
                })
        if audit_records:
            db.table("item_audits").insert(audit_records).execute()
    except Exception:
        # Table may not exist yet — log but don't block the update
        logger.warning("item_audits insert failed (table may not exist yet)", exc_info=True)

    # Also write to legacy audit_logs if it exists
    try:
        db.table("audit_logs").insert({
            "org_id": org_id,
            "user_id": user["user_id"],
            "budget_id": bid,
            "item_id": iid,
            "action": "update",
            "changes": changes,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception:
        logger.warning("audit_logs insert failed", exc_info=True)

    return {"message": "Item actualizado", "item": updated.data}


@router.get("/{budget_id}/items/{item_id}/audits")
async def get_item_audits(
    budget_id: UUID,
    item_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Return audit history for an item, ordered by most recent first."""
    db = get_data_db()
    org_id = user["org_id"]
    try:
        result = (
            db.table("item_audits")
            .select("*")
            .eq("item_id", str(item_id))
            .eq("budget_id", str(budget_id))
            .eq("org_id", org_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
    except Exception:
        # Table may not exist yet
        logger.warning("item_audits query failed (table may not exist yet)", exc_info=True)
        return []


@router.get("/{budget_id}/items")
async def list_items(budget_id: UUID, user: dict = Depends(get_current_user)):
    """Return flat list of items (for data tables)."""
    items = _get_items(str(budget_id), user["org_id"])
    return items


@router.delete("/{budget_id}/items/{item_id}")
async def delete_item(
    budget_id: UUID,
    item_id: UUID,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    org_id = user["org_id"]
    # Delete resources first (CASCADE should handle it, but be explicit)
    db.table("item_resources").delete().eq("item_id", str(item_id)).eq("org_id", org_id).execute()
    result = (
        db.table("budget_items")
        .delete()
        .eq("id", str(item_id))
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .execute()
    )
    return {"deleted": bool(result.data)}


@router.get("/{budget_id}/items/{item_id}/resources")
async def get_item_resources(
    budget_id: UUID,
    item_id: UUID,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    org_id = user["org_id"]
    # Verify item belongs to budget and org
    item = (
        db.table("budget_items")
        .select("id")
        .eq("id", str(item_id))
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not item.data:
        raise HTTPException(404, "Item no encontrado")
    result = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", str(item_id))
        .eq("org_id", org_id)
        .execute()
    )
    return result.data or []


# ── Resource helpers ────────────────────────────────────────────────────────


def _calc_resource_subtotal(resource: dict) -> tuple[float, float]:
    """Return (cantidad_efectiva, subtotal) for a resource dict."""
    tipo = resource.get("tipo", "")
    precio_unitario = float(resource.get("precio_unitario") or 0)

    if tipo == "mano_obra":
        trabajadores = float(resource.get("trabajadores") or 0)
        dias = float(resource.get("dias") or 0)
        cargas_sociales_pct = pct_or_default(resource, "cargas_sociales_pct", 25)
        cantidad_efectiva = round(trabajadores * dias * (1 + cargas_sociales_pct / 100), 2)
    else:
        cantidad = float(resource.get("cantidad") or 0)
        desperdicio_pct = float(resource.get("desperdicio_pct") or 0)
        cantidad_efectiva = cantidad * (1 + desperdicio_pct / 100)

    subtotal = round(cantidad_efectiva * precio_unitario, 2)
    if resource.get("lo_compra_cliente"):
        subtotal = 0.0
    return cantidad_efectiva, subtotal


def _recipe_flags(data: dict) -> dict:
    """Recipe flags sent by the client (only the ones that were set)."""
    return {
        k: data[k]
        for k in ("lo_compra_cliente", "redondear", "unidad_compra")
        if data.get(k) is not None
    }


def _recalc_item_from_resources(db, item_id: str, org_id: str) -> None:
    """Fetch all resources for an item and recalculate its unit prices."""
    resources_result = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", item_id)
        .eq("org_id", org_id)
        .execute()
    )
    resources = [r for r in (resources_result.data or []) if not r.get("lo_compra_cliente")]

    mat_sum = sum(r.get("subtotal") or 0 for r in resources if r.get("tipo") == "material")
    mo_sum = sum(r.get("subtotal") or 0 for r in resources if r.get("tipo") == "mano_obra")
    eq_sum = sum(r.get("subtotal") or 0 for r in resources if r.get("tipo") == "equipo")
    mat_ind_sum = sum(r.get("subtotal") or 0 for r in resources if r.get("tipo") == "mo_material")
    sub_sum = sum(r.get("subtotal") or 0 for r in resources if r.get("tipo") == "subcontrato")

    item_result = (
        db.table("budget_items")
        .select("cantidad, indirecto_total, beneficio_total")
        .eq("id", item_id)
        .single()
        .execute()
    )
    if not item_result.data:
        return

    item = item_result.data
    qty = item.get("cantidad") or 1

    mat_unitario = round(mat_sum / qty, 2)
    mo_unitario = round((mo_sum + eq_sum + mat_ind_sum + sub_sum) / qty, 2)
    mat_total = round(mat_unitario * qty, 2)
    mo_total = round(mo_unitario * qty, 2)
    directo_total = mat_total + mo_total
    neto_total = directo_total + (item.get("indirecto_total") or 0) + (item.get("beneficio_total") or 0)

    db.table("budget_items").update({
        "mat_unitario": mat_unitario,
        "mo_unitario": mo_unitario,
        "mat_total": mat_total,
        "mo_total": mo_total,
        "directo_total": round(directo_total, 2),
        "neto_total": round(neto_total, 2),
    }).eq("id", item_id).execute()


def _requantify_item(db, item: dict, org_id: str) -> int:
    """Re-evaluate formula / rendimiento resources of an item with its Q and parametros.

    Returns how many resources changed. Raises FormulaError on a bad formula
    (nothing is written in that case).
    """
    resources = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", item["id"])
        .eq("org_id", org_id)
        .execute()
        .data or []
    )
    to_update = [r for r in resources if has_formula(r)]
    if not to_update:
        return 0

    qty = float(item.get("cantidad") or 0)
    params = item.get("parametros") or {}
    recalculated = [requantify_row(dict(r), qty, params) for r in to_update]
    for res in recalculated:
        cantidad_efectiva, subtotal = _calc_resource_subtotal(res)
        db.table("item_resources").update({
            "cantidad": res.get("cantidad") or 0,
            "dias": res.get("dias") or 0,
            "cantidad_efectiva": cantidad_efectiva,
            "subtotal": subtotal,
        }).eq("id", res["id"]).execute()
    _recalc_item_from_resources(db, item["id"], org_id)
    return len(recalculated)


@router.patch("/{budget_id}/items/{item_id}/parametros")
async def update_item_params(
    budget_id: UUID,
    item_id: UUID,
    payload: ItemParamsUpdate,
    user: dict = Depends(get_current_user),
):
    """Change the recipe parameters of one item (ej. espesor = 0.15) and recalculate it."""
    db = get_data_db()
    org_id = user["org_id"]
    iid = str(item_id)

    existing = (
        db.table("budget_items")
        .select("*")
        .eq("id", iid)
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Item no encontrado")

    item = existing.data
    current = item.get("parametros") or {}
    unknown = sorted(set(payload.parametros) - set(current))
    if unknown:
        raise HTTPException(422, [f"El ítem no tiene el parámetro '{unknown[0]}'"])
    parametros = {**current, **payload.parametros}

    try:
        updated = _requantify_item(db, {**item, "parametros": parametros}, org_id)
    except FormulaError as exc:
        raise HTTPException(422, [str(exc)]) from exc
    db.table("budget_items").update({"parametros": parametros}).eq("id", iid).execute()
    return {"parametros": parametros, "resources_updated": updated}


# ── Resource CRUD ───────────────────────────────────────────────────────────


@router.post("/{budget_id}/items/{item_id}/resources")
async def create_resource(
    budget_id: UUID,
    item_id: UUID,
    payload: ResourceCreate,
    user: dict = Depends(get_current_user),
):
    """Add a single resource to an item and recalculate the item's unit prices."""
    db = get_data_db()
    org_id = user["org_id"]
    iid = str(item_id)

    # Verify item belongs to budget and org
    item = (
        db.table("budget_items")
        .select("id")
        .eq("id", iid)
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not item.data:
        raise HTTPException(404, "Item no encontrado")

    resource_data = payload.model_dump()
    cantidad_efectiva, subtotal = _calc_resource_subtotal(resource_data)

    row = {
        "item_id": iid,
        "org_id": org_id,
        "tipo": payload.tipo,
        "codigo": payload.codigo,
        "descripcion": payload.descripcion,
        "unidad": payload.unidad,
        "cantidad": payload.cantidad or 0,
        "desperdicio_pct": payload.desperdicio_pct or 0,
        "cantidad_efectiva": cantidad_efectiva,
        "precio_unitario": payload.precio_unitario or 0,
        "subtotal": subtotal,
        "trabajadores": payload.trabajadores or 0,
        "dias": payload.dias or 0,
        "cargas_sociales_pct": payload.cargas_sociales_pct or 25,
        "catalog_entry_id": payload.catalog_entry_id,
        **_recipe_flags(resource_data),
    }

    result = db.table("item_resources").insert(row).execute()
    if not result.data:
        raise HTTPException(500, "Error al crear recurso")

    _recalc_item_from_resources(db, iid, org_id)
    return result.data[0]


@router.patch("/{budget_id}/items/{item_id}/resources/{resource_id}")
async def update_resource(
    budget_id: UUID,
    item_id: UUID,
    resource_id: UUID,
    payload: ResourceUpdate,
    user: dict = Depends(get_current_user),
):
    """Update a resource and recalculate the item's unit prices."""
    db = get_data_db()
    org_id = user["org_id"]
    iid = str(item_id)
    rid = str(resource_id)

    # Verify item belongs to budget and org
    item = (
        db.table("budget_items")
        .select("id")
        .eq("id", iid)
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not item.data:
        raise HTTPException(404, "Item no encontrado")

    existing = (
        db.table("item_resources")
        .select("*")
        .eq("id", rid)
        .eq("item_id", iid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Recurso no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    new_pct = update_data.get("desperdicio_pct")
    if (
        new_pct is not None
        and "desperdicio_origen" in existing.data
        and float(new_pct) != float(existing.data.get("desperdicio_pct") or 0)
    ):
        # Changed by hand: it no longer follows the budget / org value
        update_data["desperdicio_origen"] = ORIGEN_RECURSO
    merged = {**existing.data, **update_data}
    cantidad_efectiva, subtotal = _calc_resource_subtotal(merged)

    update_data["cantidad_efectiva"] = cantidad_efectiva
    update_data["subtotal"] = subtotal

    result = (
        db.table("item_resources")
        .update(update_data)
        .eq("id", rid)
        .execute()
    )
    if not result.data:
        raise HTTPException(500, "Error al actualizar recurso")

    _recalc_item_from_resources(db, iid, org_id)
    return result.data[0]


@router.delete("/{budget_id}/items/{item_id}/resources/{resource_id}", status_code=204)
async def delete_resource(
    budget_id: UUID,
    item_id: UUID,
    resource_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Delete a resource and recalculate the item's unit prices."""
    db = get_data_db()
    org_id = user["org_id"]
    iid = str(item_id)
    rid = str(resource_id)

    # Verify item belongs to budget and org
    item = (
        db.table("budget_items")
        .select("id")
        .eq("id", iid)
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not item.data:
        raise HTTPException(404, "Item no encontrado")

    existing = (
        db.table("item_resources")
        .select("id")
        .eq("id", rid)
        .eq("item_id", iid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Recurso no encontrado")

    db.table("item_resources").delete().eq("id", rid).execute()
    _recalc_item_from_resources(db, iid, org_id)


@router.post("/{budget_id}/items/{item_id}/resources/bulk")
async def bulk_create_resources(
    budget_id: UUID,
    item_id: UUID,
    payload: BulkResourceCreate,
    user: dict = Depends(get_current_user),
):
    """Create multiple resources at once and recalculate the item's unit prices once."""
    db = get_data_db()
    org_id = user["org_id"]
    iid = str(item_id)

    # Verify item belongs to budget and org
    item = (
        db.table("budget_items")
        .select("id")
        .eq("id", iid)
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not item.data:
        raise HTTPException(404, "Item no encontrado")

    rows = []
    for resource in payload.resources:
        resource_data = resource.model_dump()
        cantidad_efectiva, subtotal = _calc_resource_subtotal(resource_data)
        rows.append({
            "item_id": iid,
            "org_id": org_id,
            "tipo": resource.tipo,
            "codigo": resource.codigo,
            "descripcion": resource.descripcion,
            "unidad": resource.unidad,
            "cantidad": resource.cantidad or 0,
            "desperdicio_pct": resource.desperdicio_pct or 0,
            "cantidad_efectiva": cantidad_efectiva,
            "precio_unitario": resource.precio_unitario or 0,
            "subtotal": subtotal,
            "trabajadores": resource.trabajadores or 0,
            "dias": resource.dias or 0,
            "cargas_sociales_pct": resource.cargas_sociales_pct or 25,
            "catalog_entry_id": resource.catalog_entry_id,
            **_recipe_flags(resource_data),
        })

    if not rows:
        return []

    result = db.table("item_resources").insert(rows).execute()
    if not result.data:
        raise HTTPException(500, "Error al crear recursos")

    _recalc_item_from_resources(db, iid, org_id)
    return result.data


# ── Sections ────────────────────────────────────────────────────────────────


@router.post("/{budget_id}/sections")
async def create_section(
    budget_id: UUID,
    payload: SectionCreate,
    user: dict = Depends(get_current_user),
):
    """Add a section to an existing budget."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    # Verify budget belongs to org
    budget = (
        db.table("budgets")
        .select("id")
        .eq("id", bid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    # Determine next sort_order
    existing_items = _get_items(bid, org_id)
    next_sort = max((i.get("sort_order") or 0 for i in existing_items), default=-1) + 1

    section_row = {
        "budget_id": bid,
        "org_id": org_id,
        "parent_id": None,
        "code": payload.codigo,
        "description": payload.nombre,
        "notas": "Seccion",
        "sort_order": next_sort,
        "mat_unitario": 0,
        "mo_unitario": 0,
    }
    result = db.table("budget_items").insert(section_row).execute()
    if not result.data:
        raise HTTPException(500, "Error al crear seccion")
    return result.data[0]


# ── Assign catalog ─────────────────────────────────────────────────────────


@router.post("/{budget_id}/assign-catalog/{catalog_id}")
async def assign_catalog_to_budget(
    budget_id: UUID,
    catalog_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Assign a price catalog to a budget: match resource codes and update prices."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)
    cid = str(catalog_id)

    # Verify budget
    budget = (
        db.table("budgets")
        .select("id")
        .eq("id", bid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    # Verify catalog
    catalog = (
        db.table("price_catalogs")
        .select("id")
        .eq("id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catalogo no encontrado")

    # Load catalog entries indexed by codigo
    entries_result = (
        db.table("catalog_entries")
        .select("codigo, precio_sin_iva, tipo")
        .eq("catalog_id", cid)
        .eq("org_id", org_id)
        .execute()
    )
    price_map: dict[str, dict] = {}
    for entry in (entries_result.data or []):
        codigo = (entry.get("codigo") or "").strip()
        precio = entry.get("precio_sin_iva")
        if codigo and precio is not None:
            price_map[codigo] = {"precio": float(precio), "tipo": entry.get("tipo")}

    if not price_map:
        raise HTTPException(404, "Catalogo sin entradas con precios")

    # Get all budget items
    items = _get_items(bid, org_id)
    if not items:
        raise HTTPException(404, "Presupuesto sin items")

    item_ids = [item["id"] for item in items]

    # Get all resources, match codes, update prices
    updated_count = 0
    for item_id in item_ids:
        resources = (
            db.table("item_resources")
            .select("*")
            .eq("item_id", item_id)
            .eq("org_id", org_id)
            .execute()
        )
        for resource in (resources.data or []):
            codigo = (resource.get("codigo") or "").strip()
            if codigo not in price_map:
                continue

            new_precio = price_map[codigo]["precio"]
            cantidad_eff = resource.get("cantidad_efectiva") or resource.get("cantidad") or 0
            new_subtotal = round(new_precio * float(cantidad_eff), 2)

            db.table("item_resources").update({
                "precio_unitario": new_precio,
                "subtotal": new_subtotal,
            }).eq("id", resource["id"]).execute()
            updated_count += 1

    # Recalculate item totals from resources
    for item_id in item_ids:
        resources = (
            db.table("item_resources")
            .select("tipo, subtotal")
            .eq("item_id", item_id)
            .eq("org_id", org_id)
            .execute()
        )
        mat_total = 0.0
        mo_total = 0.0
        for r in (resources.data or []):
            subtotal = r.get("subtotal") or 0
            if r.get("tipo") == "material":
                mat_total += subtotal
            elif r.get("tipo") == "mano_obra":
                mo_total += subtotal

        directo_total = mat_total + mo_total
        item_data = (
            db.table("budget_items")
            .select("indirecto_total, beneficio_total, cantidad")
            .eq("id", item_id)
            .single()
            .execute()
        )
        if not item_data.data:
            continue

        cantidad = item_data.data.get("cantidad") or 0
        indirecto = item_data.data.get("indirecto_total") or 0
        beneficio = item_data.data.get("beneficio_total") or 0
        neto_total = directo_total + indirecto + beneficio

        mat_unitario = round(mat_total / cantidad, 2) if cantidad else 0
        mo_unitario = round(mo_total / cantidad, 2) if cantidad else 0

        db.table("budget_items").update({
            "mat_unitario": mat_unitario,
            "mo_unitario": mo_unitario,
            "mat_total": round(mat_total, 2),
            "mo_total": round(mo_total, 2),
            "directo_total": round(directo_total, 2),
            "neto_total": round(neto_total, 2),
        }).eq("id", item_id).execute()

    # Build updated summary
    all_items = _get_items(bid, org_id)
    summary = calc_budget_summary(all_items)

    return {
        "updated_count": updated_count,
        "summary": summary,
    }


# ── Tree ─────────────────────────────────────────────────────────────────────


@router.get("/{budget_id}/tree")
async def get_tree(budget_id: UUID, user: dict = Depends(get_current_user)):
    items = _get_items(str(budget_id), user["org_id"])
    return {"budget_id": str(budget_id), "tree": build_tree(items)}


@router.get("/{budget_id}/full")
async def get_budget_full(budget_id: UUID, user: dict = Depends(get_current_user)):
    db = get_data_db()
    bid = str(budget_id)
    org_id = user["org_id"]

    budget = (
        db.table("budgets")
        .select("*")
        .eq("id", bid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    items = _get_items(bid, org_id)
    tree = build_tree(items)
    analysis = calc_budget_summary(items)

    versions = (
        db.table("budget_versions")
        .select("id")
        .eq("budget_id", bid)
        .eq("org_id", org_id)
        .execute()
    )

    return {
        "budget": budget.data,
        "tree": tree,
        "analysis": analysis,
        "versions_count": len(versions.data or []),
    }


# ── Recalculate ─────────────────────────────────────────────────────────────


@router.post("/{budget_id}/recalculate")
async def recalculate_budget(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Recalculate all item totals in a budget.

    Useful after bulk imports or price changes.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    items = _get_items(bid, org_id)
    if not items:
        raise HTTPException(404, "Presupuesto sin items")

    recalculated = recalc_all_items(items)

    cost_fields = (
        "mat_total", "mo_total", "directo_total",
        "indirecto_total", "beneficio_total", "neto_total",
    )
    updated_count = 0
    for original, recalc in zip(items, recalculated):
        patch = {f: recalc[f] for f in cost_fields if original.get(f) != recalc[f]}
        if patch:
            db.table("budget_items").update(patch).eq("id", original["id"]).execute()
            updated_count += 1

    summary = calc_budget_summary(recalculated)

    return {
        "items_total": len(items),
        "items_updated": updated_count,
        "summary": summary,
    }


# ── Copy ───────────────────────────────────────────────────────────────────


@router.post("/{budget_id}/copy")
async def copy_budget(
    budget_id: UUID,
    payload: BudgetCopyRequest = Body(default=BudgetCopyRequest()),
    user: dict = Depends(get_current_user),
):
    """Create a complete copy of a budget including all items and resources."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    # Fetch original budget
    original = (
        db.table("budgets")
        .select("*")
        .eq("id", bid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not original.data:
        raise HTTPException(404, "Presupuesto no encontrado")

    # Create new budget
    original_name = original.data.get("name") or "Presupuesto"
    new_name = payload.name or f"{original_name} (copia)"

    new_budget = db.table("budgets").insert({
        "org_id": org_id,
        "name": new_name,
        "description": original.data.get("description"),
        "source_file": original.data.get("source_file"),
        "status": "draft",
        # Fase 2/4 columns: copied only when present (DB may be pre-migration)
        **{
            k: original.data[k]
            for k in ("desperdicio_pct", "indirectos", "precios_al")
            if k in original.data
        },
    }).execute()
    new_budget_id = new_budget.data[0]["id"]

    # Copy items, mapping old parent_id -> new parent_id
    items = _get_items(bid, org_id)
    old_to_new_id: dict[str, str] = {}

    for item in items:
        old_id = item["id"]
        old_parent_id = item.get("parent_id")

        new_item = {
            "budget_id": new_budget_id,
            "org_id": org_id,
            "parent_id": old_to_new_id.get(old_parent_id) if old_parent_id else None,
            "code": item.get("code"),
            "description": item.get("description"),
            "unidad": item.get("unidad"),
            "cantidad": item.get("cantidad"),
            "mat_unitario": item.get("mat_unitario") or 0,
            "mo_unitario": item.get("mo_unitario") or 0,
            "mat_total": item.get("mat_total") or 0,
            "mo_total": item.get("mo_total") or 0,
            "directo_total": item.get("directo_total") or 0,
            "indirecto_total": item.get("indirecto_total") or 0,
            "beneficio_total": item.get("beneficio_total") or 0,
            "neto_total": item.get("neto_total") or 0,
            "notas": item.get("notas"),
            "sort_order": item.get("sort_order") or 0,
            **{k: item[k] for k in _ITEM_RECIPE_FIELDS if k in item},
        }
        result = db.table("budget_items").insert(new_item).execute()
        new_id = result.data[0]["id"]
        old_to_new_id[old_id] = new_id

    # Copy item_resources for each item
    resources_copied = 0
    for old_item_id, new_item_id in old_to_new_id.items():
        resources = (
            db.table("item_resources")
            .select("*")
            .eq("item_id", old_item_id)
            .eq("org_id", org_id)
            .execute()
        )
        if not resources.data:
            continue

        for res in resources.data:
            new_res = {
                "item_id": new_item_id,
                "org_id": org_id,
                "tipo": res.get("tipo"),
                "codigo": res.get("codigo"),
                "descripcion": res.get("descripcion"),
                "unidad": res.get("unidad"),
                "cantidad": res.get("cantidad"),
                "desperdicio_pct": res.get("desperdicio_pct"),
                "cantidad_efectiva": res.get("cantidad_efectiva"),
                "precio_unitario": res.get("precio_unitario"),
                "subtotal": res.get("subtotal"),
                **{k: res[k] for k in _RESOURCE_COPY_FIELDS if k in res},
            }
            db.table("item_resources").insert(new_res).execute()
            resources_copied += 1

    return {
        "budget_id": new_budget_id,
        "name": new_name,
        "items_copied": len(items),
        "resources_copied": resources_copied,
    }
