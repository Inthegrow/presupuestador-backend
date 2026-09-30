"""Analysis, indirect costs, and version management."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
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
from app.schemas import AnalysisResponse, IndirectApplyRequest, IndirectConfigUpdate, VersionCreate

logger = logging.getLogger(__name__)

router = APIRouter()

# Default values for indirect config fields that may not exist in older DB rows
_CONFIG_DEFAULTS: dict[str, float] = {
    "imprevistos_pct": 3,
    "estructura_pct": 15,
    "jefatura_pct": 8,
    "logistica_pct": 5,
    "herramientas_pct": 3,
    "beneficio_pct": 10,
    "ingresos_brutos_pct": 7,
    "imp_cheque_pct": 1.2,
    "iva_pct": 21,
}


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


@router.get("/{budget_id}/indirects")
async def get_indirects(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Get indirect cost config for this org (all fields including cascade fields)."""
    db = get_data_db()
    org_id = user["org_id"]
    result = (
        db.table("indirect_config")
        .select("*")
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        # Return all defaults
        return {"org_id": org_id, **_CONFIG_DEFAULTS}
    return _apply_config_defaults(result.data[0])


@router.patch("/{budget_id}/indirects")
async def update_indirects(
    budget_id: UUID,
    payload: IndirectConfigUpdate,
    user: dict = Depends(get_current_user),
):
    """Update indirect cost percentages (upsert)."""
    db = get_data_db()
    org_id = user["org_id"]

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(400, "No hay campos para actualizar")

    existing = (
        db.table("indirect_config")
        .select("id")
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        result = (
            db.table("indirect_config")
            .update(update_data)
            .eq("org_id", org_id)
            .execute()
        )
    else:
        result = (
            db.table("indirect_config")
            .insert({"org_id": org_id, **update_data})
            .execute()
        )

    row = result.data[0] if result.data else update_data
    return _apply_config_defaults(row)


# ── Indirect costs (apply) ──────────────────────────────────────────────────


@router.post("/{budget_id}/indirects")
async def apply_indirects(
    budget_id: UUID,
    request: IndirectApplyRequest = Body(default=IndirectApplyRequest()),
    user: dict = Depends(get_current_user),
):
    """Apply cascade indirect cost percentages to all leaf items in a budget."""
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    # Load indirect config
    q = db.table("indirect_config").select("*").eq("org_id", org_id)
    if request.config_id:
        q = q.eq("id", str(request.config_id))
    config_result = q.limit(1).execute()
    if not config_result.data:
        raise HTTPException(404, "Configuracion de indirectos no encontrada")

    config = _apply_config_defaults(config_result.data[0])

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
        "config_id": config_result.data[0].get("id"),
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
      6. Apply cascade indirects (indirecto → beneficio → taxes → IVA → total)
    All DB records are updated in place.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)

    # Verify budget ownership
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
    if not items:
        raise HTTPException(404, "Presupuesto sin items")

    # Load indirect config (with defaults)
    config_result = (
        db.table("indirect_config")
        .select("*")
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )
    raw_config = config_result.data[0] if config_result.data else {}
    config = _apply_config_defaults(raw_config)

    # Waste levels for inherited values
    org_waste = raw_config.get("desperdicio_pct")
    budget_waste = budget.data.get("desperdicio_pct")
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
    all_items = _get_items(bid, org_id)
    summary = calc_budget_summary(all_items)

    return {
        "items_total": len(items),
        "items_updated": items_updated,
        "items_skipped": items_skipped,
        "resources_updated": resources_updated,
        "redondeos": redondeos,
        "errores": errores,
        "summary": summary,
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


@router.post("/{budget_id}/versions")
async def create_version(
    budget_id: UUID,
    version: VersionCreate = Body(...),
    user: dict = Depends(get_current_user),
):
    """Create a snapshot of the current budget state."""
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
        "data": json.dumps({
            "budget": budget.data,
            "items": items,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "notes": version.notes,
        }),
        "created_by": user["user_id"],
    }).execute()

    return {
        "version_id": result.data[0]["id"],
        "version": next_ver,
    }


@router.get("/{budget_id}/versions")
async def list_versions(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    db = get_data_db()
    result = (
        db.table("budget_versions")
        .select("id, version, created_at, created_by")
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
