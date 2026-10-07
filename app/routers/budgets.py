from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user, require_admin, require_editor
from app.budget_prices import budget_config, fetch_all, initial_indirects, precios_faltantes, today
from app.calculations import (
    PRICE_FIELDS,
    calc_budget_summary,
    calc_item_from_resources,
    calc_item_totals,
    is_section,
    pct_or_default,
    price_item,
)
from app.db import get_data_db
from app.formulas import FormulaError
from app.obra_import import plain
from app.recipes import ORIGEN_RECURSO, has_formula, merge_params, param_defaults, requantify_row
from app.routers.analysis import _get_budget, _run_cascade, apply_catalog
from app.routers.obras import _human
from app.routers.templates import (
    A_MEDIAS,
    _budget_items,
    _json_list,
    build_rows,
    check_factor,
    conversion_factor,
    save_applied,
)
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
    TrabajoCreate,
)
from app.tree import build_tree

logger = logging.getLogger(__name__)

# Fields that are user-editable (not calculated). Used for audit trail.
AUDITABLE_FIELDS = {"cantidad", "mat_unitario", "mo_unitario", "description", "unidad", "code", "notas_calculo"}
# A PATCH with one of these recalculates the item's direct cost and its price
COST_FIELDS = ("cantidad", "mat_unitario", "mo_unitario")

router = APIRouter()

# Fase 2 (recetas) columns. Copied only when the source row has them.
_ITEM_RECIPE_FIELDS = ("template_id", "parametros")
_RESOURCE_COPY_FIELDS = (
    "trabajadores", "dias", "cargas_sociales_pct", "catalog_entry_id",
    "formula", "rendimiento", "desperdicio_origen", "lo_compra_cliente",
    "redondear", "unidad_compra", "cantidad_redondeo", "precio_fecha", "template_id",
)


def _budget_config(db, budget_id: str, org_id: str) -> dict:
    """Cascade config of one budget (read once per request; org values when it is not found)."""
    rows = db.table("budgets").select("*").eq("id", budget_id).eq("org_id", org_id).execute().data or []
    return budget_config(db, org_id, rows[0] if isinstance(rows, list) and rows else None)


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
async def create_budget(budget: BudgetCreate, user: dict = Depends(require_editor)):
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
async def create_full_budget(payload: CreateFullBudget, user: dict = Depends(require_editor)):
    """Create a complete budget with sections, items, and indirect config in one request."""
    db = get_data_db()
    org_id = user["org_id"]

    # 1. Create the budget record (indirect % start with the general ones)
    # Only this budget: the general values (indirect_config) do not change.
    indirectos = initial_indirects(db, org_id)
    if payload.indirectos:
        indirectos.update(payload.indirectos.model_dump(exclude_none=True))
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
        raise HTTPException(500, "No se pudo crear el presupuesto. Probá de nuevo.")
    budget = budget_result.data[0]
    budget_id = budget["id"]

    # 2. Create sections and their child items
    config = budget_config(db, org_id, budget)
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
            calculated = price_item(calc_item_totals(item_row), config)
            db.table("budget_items").insert(calculated).execute()
            items_created += 1
            sort_order += 1

    # 3. Build summary
    all_items = _get_items(budget_id, org_id)
    summary = calc_budget_summary(all_items, pct_or_default(config, "iva_pct", 21))

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
    user: dict = Depends(require_editor),
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
async def delete_budget(budget_id: UUID, user: dict = Depends(require_admin)):
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
    user: dict = Depends(require_editor),
):
    db = get_data_db()
    config = _budget_config(db, str(budget_id), user["org_id"])
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
            "notas": item.notas,
            "sort_order": i,
        }
        # A work entered by hand gets the full price, like any other (indirects come from the cascade)
        to_insert.append(price_item(calc_item_totals(raw), config))
    result = db.table("budget_items").insert(to_insert).execute()
    return {"inserted": len(result.data)}


@router.patch("/{budget_id}/items/{item_id}")
async def update_item(
    budget_id: UUID,
    item_id: UUID,
    payload: BudgetItemUpdate,
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "parent_id" in update_data:
        v = update_data["parent_id"]
        update_data["parent_id"] = str(v) if v else None
    # Totals are never taken from the client: they follow from the direct cost
    for field in PRICE_FIELDS:
        if field not in COST_FIELDS:
            update_data.pop(field, None)

    # Only a cost field changes the numbers (a note or a name never does)
    config = None
    if any(field in update_data for field in COST_FIELDS):
        config = _budget_config(db, bid, org_id)
        recalculated = calc_item_totals({**existing.data, **update_data})
        price_item(recalculated, config)
        for field in PRICE_FIELDS:
            if field in recalculated:
                update_data[field] = recalculated[field]

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
            _requantify_item(db, {**existing.data, **update_data}, org_id, config)
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

    return {"message": "Trabajo actualizado", "item": updated.data}


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
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")
    result = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", str(item_id))
        .eq("org_id", org_id)
        .execute()
    )
    return result.data or []


@router.get("/{budget_id}/items/{item_id}/precios-faltantes")
async def get_item_missing_prices(
    budget_id: UUID,
    item_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Codes of the item's saved resources without a price (Codex, PR #37): what the
    screen shows when the item is opened, with the same rule as applying a recipe."""
    db = get_data_db()
    org_id = user["org_id"]
    item = (
        db.table("budget_items")
        .select("id")
        .eq("id", str(item_id))
        .eq("budget_id", str(budget_id))
        .eq("org_id", org_id)
        .execute()
    )
    if not item.data:
        raise HTTPException(404, "Trabajo no encontrado")
    resources = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", str(item_id))
        .eq("org_id", org_id)
        .order("id")
        .execute()
    )
    return {"precios_faltantes": precios_faltantes(resources.data or [])}


# ── Agregar un trabajo con su fórmula (PLAN_AGREGAR_TRABAJO 2) ─────────────

SECCION = "Seccion"
RUBRO_AJENO = "Ese rubro no es de este presupuesto"
RUBRO_SIN_CATEGORIA = "Varios"
NO_SE_AGREGO = "No se pudo agregar el trabajo. No quedó nada cargado; probá de nuevo."


def _oracion(text: object) -> str:
    """'CONTRAPISO DE CASCOTE' → 'Contrapiso de cascote'; 'platea' → 'Platea'."""
    t = _human(text).strip()
    return t[:1].upper() + t[1:]


def _leading_number(code: object) -> str:
    m = re.match(r"\s*(\d+)", str(code or ""))
    return m.group(1) if m else ""


def _next_rubro_code(items: list[dict]) -> str:
    """One more than the highest number of the top level (like the editor's new section)."""
    numbers = [_leading_number(i.get("code")) for i in items if not i.get("parent_id")]
    return str(max((int(n) for n in numbers if n), default=0) + 1)


def _next_item_code(rubro: dict, items: list[dict]) -> str | None:
    """'{rubro}.{n}': one more than the highest n already used (like the editor's "+ Item")."""
    base = _leading_number(rubro.get("code"))
    if not base:
        return None
    pattern = re.compile(rf"^{base}\.(\d+)")
    used = [m.group(1) for i in items if (m := pattern.match(str(i.get("code") or "").strip()))]
    return f"{base}.{max((int(n) for n in used), default=0) + 1}"


def _rubro_for(items: list[dict], parent_id: str | None, categoria: str) -> dict | None:
    """The rubro chosen in the tree (it must be a section of this budget), else the one named
    like the recipe's categoria (without capitals or accents), else None (to be created)."""
    secciones = sorted((i for i in items if is_section(i)),
                       key=lambda i: (i.get("sort_order") is None, i.get("sort_order") or 0))
    if parent_id:
        rubro = next((i for i in secciones if str(i["id"]) == parent_id.strip()), None)
        if rubro is None:
            raise HTTPException(422, RUBRO_AJENO)
        return rubro
    nombre = plain(categoria)
    return next((i for i in secciones if plain(i.get("description")) == nombre), None)


def _remove_new(db, org_id: str, budget_id: str, item_id: str | None, rubro_id: str | None) -> bool:
    """Delete the item (and the rubro) created by a failed request. False when it could not."""
    try:
        if item_id:
            db.table("item_resources").delete().eq("item_id", item_id).eq("org_id", org_id).execute()
            db.table("budget_items").delete().eq("id", item_id).eq("budget_id", budget_id).eq(
                "org_id", org_id).execute()
        if rubro_id:
            db.table("budget_items").delete().eq("id", rubro_id).eq("budget_id", budget_id).eq(
                "org_id", org_id).execute()
        return True
    except Exception:
        logger.exception("Could not remove the new item %s / rubro %s", item_id, rubro_id)
        return False


@router.post("/{budget_id}/trabajos")
async def create_trabajo(
    budget_id: UUID,
    payload: TrabajoCreate,
    user: dict = Depends(require_editor),
):
    """Add an item with its recipe applied, in the rubro of the recipe (or the one chosen).

    Same rules as applying a recipe (templates.apply_template): unit conversion (409
    FALTA_CONVERSION before anything is created), prices and the full recalculation. If
    applying fails, the new item (and the rubro created for it) is deleted.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    budgets = db.table("budgets").select("*").eq("id", bid).eq("org_id", org_id).execute().data
    if not budgets:
        raise HTTPException(404, "Presupuesto no encontrado")
    budget = budgets[0]
    templates = (
        db.table("item_templates").select("*").eq("id", payload.template_id).eq("org_id", org_id).execute().data
    )
    if not templates:
        raise HTTPException(404, "Fórmula no encontrada")
    template = templates[0]
    check_factor(payload.factor)

    descripcion = (payload.descripcion or "").strip() or _oracion(template.get("nombre"))
    unidad = (payload.unidad or "").strip() or template.get("unidad")
    items = _budget_items(db, bid, org_id)
    categoria = _oracion(template.get("categoria")) or RUBRO_SIN_CATEGORIA
    rubro = _rubro_for(items, payload.parent_id, categoria)

    # Everything that can say no goes before creating anything: conversion and formulas
    factor = conversion_factor(template, descripcion, unidad, payload.factor)
    params = merge_params(param_defaults(_json_list(template.get("parametros"))), {})
    rows, faltantes = build_rows(db, org_id, budget, template, None, payload.cantidad, params, factor)

    rubro_creado = rubro is None
    next_sort = max((i.get("sort_order") or 0 for i in items), default=-1) + 1
    trabajo = None
    try:
        if rubro_creado:
            rubro = (db.table("budget_items").insert({
                "budget_id": bid,
                "org_id": org_id,
                "parent_id": None,
                "code": _next_rubro_code(items),
                "description": categoria,
                "notas": SECCION,
                "sort_order": next_sort,
                "mat_unitario": 0,
                "mo_unitario": 0,
            }).execute().data or [None])[0]
            if not rubro:
                raise RuntimeError("No se creó el rubro")
            next_sort += 1
        trabajo = (db.table("budget_items").insert(calc_item_totals({
            "budget_id": bid,
            "org_id": org_id,
            "parent_id": str(rubro["id"]),
            "code": _next_item_code(rubro, items),
            "description": descripcion,
            "unidad": unidad,
            "cantidad": payload.cantidad,
            "mat_unitario": 0,
            "mo_unitario": 0,
            "notas": None,
            "sort_order": next_sort,
        })).execute().data or [None])[0]
        if not trabajo:
            raise RuntimeError("No se creó el trabajo")
        for row in rows:
            row["item_id"] = str(trabajo["id"])
        save_applied(db, org_id, budget, payload.template_id, trabajo, rows, params)
    except Exception as exc:
        logger.exception("Adding an item with template %s to budget %s failed", payload.template_id, bid)
        a_medias = isinstance(exc, HTTPException) and isinstance(exc.detail, dict) \
            and exc.detail.get("codigo") == "A_MEDIAS"
        borrado = _remove_new(db, org_id, bid, trabajo and str(trabajo["id"]),
                              str(rubro["id"]) if rubro_creado and rubro else None)
        if a_medias or not borrado:
            raise HTTPException(500, {"codigo": "A_MEDIAS", "mensaje": A_MEDIAS}) from exc
        raise HTTPException(500, {"codigo": "NO_SE_APLICO", "mensaje": NO_SE_AGREGO}) from exc

    item = db.table("budget_items").select("*").eq("id", str(trabajo["id"])).eq("org_id", org_id).execute().data
    return {
        "item": item[0] if item else trabajo,
        "rubro": {"id": rubro["id"], "nombre": rubro.get("description"), "creado": rubro_creado},
        "precios_faltantes": list(faltantes.values()),
    }


RESOURCES_CHUNK = 200  # item ids per item_resources request


@router.get("/{budget_id}/precios-faltantes")
async def get_budget_missing_prices(budget_id: UUID, user: dict = Depends(get_current_user)):
    """How many codes without a price each item has, and how many resources it has (the dot
    of the editor's table), with the rule of GET .../items/{item_id}/precios-faltantes.
    Resources are read in bulk. The resource count is real: a formula can leave no resources
    (an empty formula, or all of them deleted later), and that item is not "listo"."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)
    if not db.table("budgets").select("id").eq("id", bid).eq("org_id", org_id).execute().data:
        raise HTTPException(404, "Presupuesto no encontrado")

    ids = [str(i["id"]) for i in _budget_items(db, bid, org_id) if not is_section(i)]
    por_item: dict[str, list[dict]] = {i: [] for i in ids}
    for start in range(0, len(ids), RESOURCES_CHUNK):
        chunk = ids[start:start + RESOURCES_CHUNK]
        for r in fetch_all(
            lambda chunk=chunk: db.table("item_resources").select("*")
            .eq("org_id", org_id).in_("item_id", chunk).order("id")
        ):
            por_item.setdefault(str(r["item_id"]), []).append(r)
    return {
        "por_item": {i: len(precios_faltantes(rs)) for i, rs in por_item.items()},
        "recursos_por_item": {i: len(rs) for i, rs in por_item.items()},
    }


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


def _recalc_item_from_resources(db, item_id: str, org_id: str, config: dict) -> dict | None:
    """Recalculate an item from all its resources and price it (price_item with ``config``).

    Same rule as the full recalculation (_run_cascade): every resource tipo, what the
    client buys at $0, then the cascade. Returns the written values (None: no item).
    """
    resources = (
        db.table("item_resources")
        .select("*")
        .eq("item_id", item_id)
        .eq("org_id", org_id)
        .execute()
        .data or []
    )
    item = (
        db.table("budget_items")
        .select("*")
        .eq("id", item_id)
        .eq("org_id", org_id)
        .execute()
        .data or []
    )
    if not item:
        return None

    priced = price_item(calc_item_from_resources(dict(item[0]), resources), config)
    patch = {k: priced[k] for k in PRICE_FIELDS if k in priced}
    db.table("budget_items").update(patch).eq("id", item_id).eq("org_id", org_id).execute()
    return patch


def _requantify_item(db, item: dict, org_id: str, config: dict) -> int:
    """Re-evaluate formula / rendimiento resources of an item with its Q and parametros,
    then recalculate and price the item (``config``: cascade of its budget).

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
    _recalc_item_from_resources(db, item["id"], org_id, config)
    return len(recalculated)


@router.patch("/{budget_id}/items/{item_id}/parametros")
async def update_item_params(
    budget_id: UUID,
    item_id: UUID,
    payload: ItemParamsUpdate,
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")

    item = existing.data
    current = item.get("parametros") or {}
    unknown = sorted(set(payload.parametros) - set(current))
    if unknown:
        raise HTTPException(422, [f"El trabajo no tiene el parámetro '{unknown[0]}'"])
    parametros = {**current, **payload.parametros}

    try:
        updated = _requantify_item(db, {**item, "parametros": parametros}, org_id,
                                   _budget_config(db, str(budget_id), org_id))
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
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")

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
        raise HTTPException(500, "No se pudo agregar el recurso. Probá de nuevo.")

    _recalc_item_from_resources(db, iid, org_id, _budget_config(db, str(budget_id), org_id))
    return result.data[0]


@router.patch("/{budget_id}/items/{item_id}/resources/{resource_id}")
async def update_resource(
    budget_id: UUID,
    item_id: UUID,
    resource_id: UUID,
    payload: ResourceUpdate,
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")

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
        raise HTTPException(500, "No se pudo actualizar el recurso. Probá de nuevo.")

    _recalc_item_from_resources(db, iid, org_id, _budget_config(db, str(budget_id), org_id))
    return result.data[0]


@router.delete("/{budget_id}/items/{item_id}/resources/{resource_id}", status_code=204)
async def delete_resource(
    budget_id: UUID,
    item_id: UUID,
    resource_id: UUID,
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")

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
    _recalc_item_from_resources(db, iid, org_id, _budget_config(db, str(budget_id), org_id))


@router.post("/{budget_id}/items/{item_id}/resources/bulk")
async def bulk_create_resources(
    budget_id: UUID,
    item_id: UUID,
    payload: BulkResourceCreate,
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "Trabajo no encontrado")

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
        raise HTTPException(500, "No se pudieron agregar los recursos. Probá de nuevo.")

    _recalc_item_from_resources(db, iid, org_id, _budget_config(db, str(budget_id), org_id))
    return result.data


# ── Sections ────────────────────────────────────────────────────────────────


@router.post("/{budget_id}/sections")
async def create_section(
    budget_id: UUID,
    payload: SectionCreate,
    user: dict = Depends(require_editor),
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
        raise HTTPException(500, "No se pudo crear el rubro. Probá de nuevo.")
    return result.data[0]


# ── Assign catalog ─────────────────────────────────────────────────────────


@router.post("/{budget_id}/assign-catalog/{catalog_id}")
async def assign_catalog_to_budget(
    budget_id: UUID,
    catalog_id: UUID,
    user: dict = Depends(require_editor),
):
    """Assign a price catalog to a budget: match resource codes, update prices and
    recalculate it like "Actualizar precios" (every resource tipo, what the client buys
    at $0, the cascade of the budget)."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)
    cid = str(catalog_id)

    budget = _get_budget(db, bid, org_id)

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
        raise HTTPException(404, "Catálogo no encontrado")

    result = apply_catalog(db, org_id, budget, cid)
    return {
        "updated_count": result["matched"],
        "summary": result["summary"],
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
    analysis = calc_budget_summary(items, budget_config(db, org_id, budget.data)["iva_pct"])

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
    user: dict = Depends(require_editor),
):
    """Full recalculation: the same as ``POST /{id}/cascade-recalculate`` (kept for compatibility).

    Returns the cascade result: items_total, items_updated, summary, ...
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    budget = _get_budget(db, bid, org_id)
    items = _get_items(bid, org_id)
    if not items:
        raise HTTPException(404, "El presupuesto no tiene trabajos")
    return _run_cascade(db, org_id, budget, items)


# ── Copy ───────────────────────────────────────────────────────────────────


@router.post("/{budget_id}/copy")
async def copy_budget(
    budget_id: UUID,
    payload: BudgetCopyRequest = Body(default=BudgetCopyRequest()),
    user: dict = Depends(require_editor),
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
            # The copy keeps the same price: the whole cascade, as saved
            "impuestos_total": item.get("impuestos_total"),
            "iva_total": item.get("iva_total"),
            "total_final": item.get("total_final"),
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
