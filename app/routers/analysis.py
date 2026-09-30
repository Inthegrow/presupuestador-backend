"""Analysis, indirect costs, and version management."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
from app.budget_prices import (
    INDIRECT_DEFAULTS,
    INDIRECT_KEYS,
    budget_overrides,
    effective_indirects,
    general_indirects,
    load_org_config,
    load_price_lookup,
    save_org_config,
    today,
)
from app.calculations import (
    calc_budget_summary,
    calc_cascade_indirects,
    calc_item_from_resources,
    calc_item_totals,
    calc_resource_subtotal,
)
from app.db import get_data_db
from app.formulas import FormulaError
from app.recipes import (
    ORIGEN_RECURSO,
    apply_purchase_rounding,
    has_formula,
    requantify_row,
    resolve_waste,
)
from app.schemas import (
    AnalysisResponse,
    IndirectApplyRequest,
    IndirectConfigUpdate,
    PriceUpdateRequest,
    VersionCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Default values for indirect config fields that may not exist in older DB rows
_CONFIG_DEFAULTS: dict[str, float] = INDIRECT_DEFAULTS


def _get_items(budget_id: str, org_id: str) -> list[dict]:
    db = get_data_db()
    return (
        db.table("budget_items")
        .select("*")
        .eq("budget_id", budget_id)
        .eq("org_id", org_id)
        .execute()
        .data or []
    )


def _apply_config_defaults(config: dict) -> dict:
    """Fill in missing config keys with defaults (does not mutate original)."""
    result = dict(config)
    for key, default in _CONFIG_DEFAULTS.items():
        if result.get(key) is None:
            result[key] = default
    return result


def _is_leaf_item(item: dict) -> bool:
    """Leaf items have cantidad > 0 and represent actual work items (not sections)."""
    return (item.get("notas") != "Seccion") and (float(item.get("cantidad") or 0) > 0)


# ── Indirect config CRUD ────────────────────────────────────────────────────


def _get_budget(db, budget_id: str, org_id: str) -> dict:
    budget = (
        db.table("budgets")
        .select("*")
        .eq("id", budget_id)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not budget.data:
        raise HTTPException(404, "Presupuesto no encontrado")
    return budget.data


def _indirects_response(org_config: dict, budget: dict) -> dict:
    """Values of this budget, plus the general ones to compare."""
    return {
        **org_config,
        "org_id": org_config.get("org_id") or budget.get("org_id"),
        **effective_indirects(org_config, budget),
        "desperdicio_pct": org_config.get("desperdicio_pct"),
        "general": general_indirects(org_config),
        # False = the budget still follows the general values
        "propios": bool(budget_overrides(budget)),
    }


@router.get("/{budget_id}/indirects")
async def get_indirects(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Indirect % of this budget (its own values, or the general ones)."""
    db = get_data_db()
    org_id = user["org_id"]
    budget = _get_budget(db, str(budget_id), org_id)
    return _indirects_response(load_org_config(db, org_id), budget)


@router.patch("/{budget_id}/indirects")
async def update_indirects(
    budget_id: UUID,
    payload: IndirectConfigUpdate,
    user: dict = Depends(get_current_user),
):
    """Change the indirect % of this budget only.

    The other budgets and the general values do not change.
    ``desperdicio_pct`` is still the organization's default waste.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(400, "No hay campos para actualizar")

    budget = _get_budget(db, bid, org_id)
    org_config = load_org_config(db, org_id)

    pct = {k: v for k, v in update_data.items() if k in INDIRECT_KEYS and v is not None}
    if pct:
        # Save the full set: from now on the budget keeps its own numbers
        indirectos = {**effective_indirects(org_config, budget), **pct}
        db.table("budgets").update({
            "indirectos": indirectos,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", bid).eq("org_id", org_id).execute()
        budget = {**budget, "indirectos": indirectos}

    if "desperdicio_pct" in update_data:
        org_config = save_org_config(db, org_id, {"desperdicio_pct": update_data["desperdicio_pct"]})

    return _indirects_response(org_config, budget)


# ── Indirect costs (apply) ──────────────────────────────────────────────────


@router.post("/{budget_id}/indirects")
async def apply_indirects(
    budget_id: UUID,
    request: IndirectApplyRequest = Body(default=IndirectApplyRequest()),
    user: dict = Depends(get_current_user),
):
    """Apply this budget's cascade indirect % to all its leaf items."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    budget = _get_budget(db, bid, org_id)
    org_config = load_org_config(db, org_id)
    config = {**org_config, **effective_indirects(org_config, budget)}

    items = _get_items(bid, org_id)
    if not items:
        raise HTTPException(404, "Presupuesto sin items")

    # Only process leaf items (actual work items, not sections)
    leaf_items = [i for i in items if _is_leaf_item(i)]

    total_directo = sum(float(i.get("directo_total") or 0) for i in leaf_items)

    # Apply cascade indirects and batch-update
    updates = []
    for item in leaf_items:
        recalculated = calc_cascade_indirects(dict(item), config)
        updates.append({
            "id": item["id"],
            "indirecto_total": recalculated["indirecto_total"],
            "beneficio_total": recalculated["beneficio_total"],
            "impuestos_total": recalculated.get("impuestos_total", 0),
            "neto_total": recalculated["neto_total"],
            "iva_total": recalculated.get("iva_total", 0),
            "total_final": recalculated.get("total_final", 0),
        })

    for upd in updates:
        item_id = upd.pop("id")
        try:
            db.table("budget_items").update(upd).eq("id", item_id).execute()
        except Exception:
            # Columns impuestos_total / iva_total / total_final may not exist yet
            # Fall back to updating only the legacy fields
            logger.warning(
                "Full cascade update failed for item %s, falling back to legacy fields",
                item_id,
                exc_info=True,
            )
            db.table("budget_items").update({
                "indirecto_total": upd["indirecto_total"],
                "beneficio_total": upd["beneficio_total"],
                "neto_total": upd["neto_total"],
            }).eq("id", item_id).execute()

    total_indirecto = sum(u.get("indirecto_total", 0) for u in updates)
    total_beneficio = sum(u.get("beneficio_total", 0) for u in updates)
    total_neto = sum(u.get("neto_total", 0) for u in updates)
    total_final = sum(u.get("total_final", 0) for u in updates)

    return {
        "total_directo": round(total_directo, 2),
        "total_indirectos": round(total_indirecto, 2),
        "total_beneficio": round(total_beneficio, 2),
        "total_neto": round(total_neto, 2),
        "total_final": round(total_final, 2),
        "items_updated": len(updates),
        "config_id": org_config.get("id"),
    }


# ── Cascade recalculate (nuclear option) ────────────────────────────────────


@router.post("/{budget_id}/cascade-recalculate")
async def cascade_recalculate(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Full cascade recalculation from scratch.

    For every leaf item:
      1. Re-evaluate formulas (Q = item quantity, item parametros) and MO rendimiento
      2. Re-resolve inherited waste (presupuesto > plantilla > organización)
      3. Recalculate each resource subtotal (cantidad_efectiva, subtotal)
    Then, over the whole budget:
      4. Round resources marked ``redondear`` up to whole purchase units
    And for every leaf item:
      5. Derive item unit prices and directo from resources
      6. Apply cascade indirects of this budget (indirecto → beneficio → taxes → IVA → total)
    All DB records are updated in place.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    budget = _get_budget(db, bid, org_id)
    items = _get_items(bid, org_id)
    if not items:
        raise HTTPException(404, "Presupuesto sin items")
    return _run_cascade(db, org_id, budget, items)


def _run_cascade(db, org_id: str, budget: dict, items: list[dict], price_for=None) -> dict:
    """Recalculate a budget in place (see cascade_recalculate).

    ``price_for(resource)`` -> (precio, fecha, entry_id) or None: when given,
    each resource takes that price before its subtotal is calculated.
    """
    raw_config = load_org_config(db, org_id)
    config = _apply_config_defaults({**raw_config, **effective_indirects(raw_config, budget)})

    # Waste levels for inherited values
    org_waste = raw_config.get("desperdicio_pct")
    budget_waste = budget.get("desperdicio_pct")
    template_ids = {i.get("template_id") for i in items if i.get("template_id")}
    template_waste: dict[str, object] = {}
    if template_ids:
        templates = (
            db.table("item_templates")
            .select("*")
            .eq("org_id", org_id)
            .execute()
            .data or []
        )
        template_waste = {
            t["id"]: t.get("desperdicio_pct") for t in templates if t.get("id") in template_ids
        }

    items_updated = 0
    items_skipped = 0
    prices_updated = 0
    errores: list[str] = []

    # Steps 1-3: per resource
    leaf_items: list[tuple[dict, list[dict]]] = []
    all_resources: list[dict] = []
    for item in items:
        if not _is_leaf_item(item):
            items_skipped += 1
            continue

        resources = (
            db.table("item_resources")
            .select("*")
            .eq("item_id", item["id"])
            .eq("org_id", org_id)
            .execute()
            .data or []
        )
        qty = float(item.get("cantidad") or 0)
        params = item.get("parametros") or {}

        recalc_resources = []
        for res in resources:
            row = dict(res)
            if price_for is not None:
                found = price_for(row)
                if found is not None:
                    precio, fecha_precio, entry_id = found
                    row["_precio"] = {
                        "precio_unitario": precio,
                        "precio_fecha": fecha_precio,
                        "catalog_entry_id": entry_id,
                    }
                    row["precio_unitario"] = precio
                    prices_updated += 1
            if has_formula(row):
                try:
                    requantify_row(row, qty, params)
                except FormulaError as exc:
                    errores.append(
                        f"{item.get('code') or ''} {row.get('codigo') or row.get('descripcion') or ''}: {exc}".strip()
                    )
            origen = row.get("desperdicio_origen")
            if origen and origen != ORIGEN_RECURSO and row.get("tipo") != "mano_obra":
                pct, new_origen = resolve_waste(
                    None, budget_waste, template_waste.get(item.get("template_id")), org_waste
                )
                row["desperdicio_pct"] = pct
                row["desperdicio_origen"] = new_origen
            calc_resource_subtotal(row)
            recalc_resources.append(row)
        leaf_items.append((item, recalc_resources))
        all_resources.extend(recalc_resources)

    # Step 4: purchase rounding over the whole budget
    redondeos = apply_purchase_rounding(all_resources)

    resources_updated = 0
    for res in all_resources:
        patch = {
            "cantidad": res.get("cantidad") or 0,
            "dias": res.get("dias") or 0,
            "desperdicio_pct": res.get("desperdicio_pct") or 0,
            "cantidad_efectiva": res["cantidad_efectiva"],
            "subtotal": res["subtotal"],
            **res.pop("_precio", {}),
        }
        # Fase 2 columns: only written when the DB already has them
        # ("formula" comes from the DB row; nothing above adds it)
        if "formula" in res:
            patch["desperdicio_origen"] = res.get("desperdicio_origen")
            patch["cantidad_redondeo"] = res.get("cantidad_redondeo") or 0
        try:
            db.table("item_resources").update(patch).eq("id", res["id"]).execute()
            resources_updated += 1
        except Exception:
            logger.warning("Failed to update resource %s", res.get("id"), exc_info=True)

    # Steps 5-6: per item
    for item, recalc_resources in leaf_items:
        item_id = item["id"]

        item_copy = dict(item)
        if recalc_resources:
            calc_item_from_resources(item_copy, recalc_resources)
        else:
            # No resources — use existing unit prices to recalc totals
            item_copy = calc_item_totals(item_copy)

        calc_cascade_indirects(item_copy, config)

        # Patch fields to update in DB
        patch = {
            "mat_unitario": item_copy.get("mat_unitario", item.get("mat_unitario") or 0),
            "mo_unitario": item_copy.get("mo_unitario", item.get("mo_unitario") or 0),
            "mat_total": item_copy.get("mat_total", 0),
            "mo_total": item_copy.get("mo_total", 0),
            "directo_total": item_copy.get("directo_total", 0),
            "indirecto_total": item_copy.get("indirecto_total", 0),
            "beneficio_total": item_copy.get("beneficio_total", 0),
            "neto_total": item_copy.get("neto_total", 0),
        }
        # Include new cascade fields if they exist (require DB migration)
        cascade_extras = {
            "impuestos_total": item_copy.get("impuestos_total"),
            "iva_total": item_copy.get("iva_total"),
            "total_final": item_copy.get("total_final"),
        }

        try:
            db.table("budget_items").update({**patch, **cascade_extras}).eq("id", item_id).execute()
        except Exception:
            # New columns not yet in DB — fall back to legacy fields only
            logger.warning(
                "Cascade extra fields failed for item %s, using legacy fields",
                item_id,
                exc_info=True,
            )
            db.table("budget_items").update(patch).eq("id", item_id).execute()

        items_updated += 1

    # Build summary from freshly updated items
    all_items = _get_items(budget["id"], org_id)
    summary = calc_budget_summary(all_items)

    result = {
        "items_total": len(items),
        "items_updated": items_updated,
        "items_skipped": items_skipped,
        "resources_updated": resources_updated,
        "redondeos": redondeos,
        "errores": errores,
        "summary": summary,
    }
    if price_for is not None:
        result["precios_actualizados"] = prices_updated
    return result


# ── Update prices ───────────────────────────────────────────────────────────


@router.post("/{budget_id}/actualizar-precios")
async def update_prices(
    budget_id: UUID,
    payload: PriceUpdateRequest = Body(default=PriceUpdateRequest()),
    user: dict = Depends(get_current_user),
):
    """Take the last price of each resource (to today, or to ``fecha``), recalculate
    and save a new version. The state before the update is saved as a version too.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    fecha = payload.fecha or today()
    if fecha > today():
        raise HTTPException(422, "La fecha de precios no puede ser futura")

    budget = _get_budget(db, bid, org_id)
    items = _get_items(bid, org_id)
    if not items:
        raise HTTPException(404, "Presupuesto sin items")

    anterior = budget.get("precios_al")
    version_anterior = _save_version(
        db, org_id, user["user_id"], budget, items,
        f"Antes de actualizar precios (precios al {anterior or 'sin fecha'})",
    )

    price_for, problemas = load_price_lookup(db, org_id, fecha)
    result = _run_cascade(db, org_id, budget, items, price_for=price_for)

    db.table("budgets").update({
        "precios_al": fecha.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", bid).eq("org_id", org_id).execute()

    budget = _get_budget(db, bid, org_id)
    version_nueva = _save_version(
        db, org_id, user["user_id"], budget, _get_items(bid, org_id),
        f"Precios al {fecha.isoformat()}",
    )

    return {
        **result,
        "precios_al": fecha.isoformat(),
        "precios_al_anterior": anterior,
        "version_anterior": version_anterior,
        "version_nueva": version_nueva,
        # One line per code (the same code can be in many items)
        "sin_precio": list({(p["codigo"], p["motivo"]): p for p in problemas}.values()),
    }


# ── Analysis ─────────────────────────────────────────────────────────────────


@router.get("/{budget_id}/analysis", response_model=AnalysisResponse)
async def get_analysis(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Get cost analysis with MAT/MO/Indirect/Benefit breakdown."""
    items = _get_items(str(budget_id), user["org_id"])
    if not items:
        raise HTTPException(404, "Presupuesto vacio o sin acceso")

    summary = calc_budget_summary(items)
    return AnalysisResponse(budget_id=str(budget_id), **summary)


# ── Versions ─────────────────────────────────────────────────────────────────


def _save_version(db, org_id: str, user_id: str, budget: dict, items: list[dict], notes: str | None) -> dict:
    """Save a snapshot of the budget, its items and their resources (with prices)."""
    bid = budget["id"]
    item_ids = [i["id"] for i in items]
    resources: list[dict] = []
    for start in range(0, len(item_ids), 200):
        resources.extend(
            db.table("item_resources")
            .select("*")
            .eq("org_id", org_id)
            .in_("item_id", item_ids[start:start + 200])
            .execute()
            .data or []
        )

    # Auto-increment version number
    existing = (
        db.table("budget_versions")
        .select("version")
        .eq("budget_id", bid)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    next_ver = (existing.data[0]["version"] + 1) if existing.data else 1

    result = db.table("budget_versions").insert({
        "budget_id": bid,
        "org_id": org_id,
        "version": next_ver,
        "precios_al": budget.get("precios_al"),
        "notas": notes,
        "data": json.dumps({
            "budget": budget,
            "items": items,
            "resources": resources,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "notes": notes,
        }),
        "created_by": user_id,
    }).execute()

    return {
        "version_id": result.data[0]["id"],
        "version": next_ver,
    }


@router.post("/{budget_id}/versions")
async def create_version(
    budget_id: UUID,
    version: VersionCreate = Body(default=VersionCreate()),
    user: dict = Depends(get_current_user),
):
    """Create a snapshot of the current budget state."""
    db = get_data_db()
    bid = str(budget_id)
    org_id = user["org_id"]

    budget = _get_budget(db, bid, org_id)
    items = _get_items(bid, org_id)
    return _save_version(db, org_id, user["user_id"], budget, items, version.notes)


@router.get("/{budget_id}/versions")
async def list_versions(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    result = (
        db.table("budget_versions")
        .select("id, version, created_at, created_by, precios_al, notas")
        .eq("budget_id", str(budget_id))
        .eq("org_id", user["org_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.get("/{budget_id}/versions/{version_id}")
async def get_version(
    budget_id: UUID,
    version_id: UUID,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    result = (
        db.table("budget_versions")
        .select("*")
        .eq("id", str(version_id))
        .eq("budget_id", str(budget_id))
        .eq("org_id", user["org_id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Version no encontrada")

    return {
        "version_id": str(version_id),
        "version": result.data["version"],
        "created_at": result.data["created_at"],
        "snapshot": json.loads(result.data["data"]),
    }
