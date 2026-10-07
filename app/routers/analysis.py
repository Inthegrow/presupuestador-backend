"""Analysis, indirect costs, and version management."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user, require_editor
from app.budget_prices import (
    INDIRECT_DEFAULTS,
    INDIRECT_KEYS,
    budget_overrides,
    build_price_lookup,
    discarded_prices,
    effective_indirects,
    fetch_all,
    general_indirects,
    load_org_config,
    save_org_config,
    today,
)
from app.calculations import (
    CASCADE_FIELDS,
    cascade_factors,
    calc_budget_summary,
    calc_item_from_resources,
    calc_item_totals,
    calc_resource_subtotal,
    is_section,
    price_item,
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
    return fetch_all(
        lambda: db.table("budget_items")
        .select("*")
        .eq("budget_id", budget_id)
        .eq("org_id", org_id)
        .order("id")
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
    return not is_section(item) and (float(item.get("cantidad") or 0) > 0)


def reprice_budget(db, org_id: str, budget: dict, config: dict | None = None,
                   items: list[dict] | None = None, strict: bool = False) -> list[dict]:
    """Price every leaf item of a budget from its saved direct cost (price_item).

    Used when only the percentages change: resources and quantities stay as they are.
    ``config``: the cascade config (default: the budget's own, read here).
    ``strict``: every item must be written whole: a failed write (or one that updates no
    row) raises, never falls back to the three legacy columns. Callers that save the
    percentages use it, so a failure can be undone and retried.
    Returns the written cascade values, one dict per item (with "id" and "directo_total").
    """
    if config is None:
        raw = load_org_config(db, org_id)
        config = {**raw, **effective_indirects(raw, budget)}
    if items is None:
        items = _get_items(str(budget["id"]), org_id)

    written: list[dict] = []
    for item in items:
        if not _is_leaf_item(item):
            continue
        priced = price_item(dict(item), config)
        upd = {k: priced[k] for k in CASCADE_FIELDS}
        if strict:
            result = db.table("budget_items").update(upd).eq("id", item["id"]).eq("org_id", org_id).execute()
            if not result.data:
                raise RuntimeError(f"No se actualizó el ítem {item['id']}")
        else:
            try:
                db.table("budget_items").update(upd).eq("id", item["id"]).execute()
            except Exception:
                # Columns impuestos_total / iva_total / total_final may not exist yet
                logger.warning(
                    "Full cascade update failed for item %s, falling back to legacy fields",
                    item["id"],
                    exc_info=True,
                )
                db.table("budget_items").update({
                    k: upd[k] for k in ("indirecto_total", "beneficio_total", "neto_total")
                }).eq("id", item["id"]).execute()
        written.append({"id": item["id"], "directo_total": float(item.get("directo_total") or 0), **upd})
    return written


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
    """Values of this budget, plus the general ones to compare.

    ``indirecto_pct`` (the 5 indirect concepts) and ``coeficiente`` (price without IVA
    per 1 of direct cost) come from here, so the screens do not add them up.
    """
    effective = effective_indirects(org_config, budget)
    return {
        **org_config,
        "org_id": org_config.get("org_id") or budget.get("org_id"),
        **effective,
        **cascade_factors(effective),
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
    user: dict = Depends(require_editor),
):
    """Change the indirect % of this budget only, and reprice it.

    The other budgets and the general values do not change. When a % changes, every
    work of this budget is priced again from its saved direct cost (``actualizados``: 1).
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

    actualizados = 0
    if pct:
        # Strict: a failed write is an error (saving the same values again finishes the job)
        try:
            reprice_budget(db, org_id, budget, {**org_config, **effective_indirects(org_config, budget)},
                           strict=True)
        except Exception as exc:
            logger.exception("Repricing budget %s after a change of its indirects failed", bid)
            raise HTTPException(500, {
                "codigo": "A_MEDIAS",
                "mensaje": "Se guardaron los porcentajes, pero no pude actualizar todos los precios. "
                           "Volvé a guardar: la app termina de actualizarlos.",
            }) from exc
        actualizados = 1

    return {**_indirects_response(org_config, budget), "actualizados": actualizados}


# ── Indirect costs (apply) ──────────────────────────────────────────────────


@router.post("/{budget_id}/indirects")
async def apply_indirects(
    budget_id: UUID,
    request: IndirectApplyRequest = Body(default=IndirectApplyRequest()),
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "El presupuesto no tiene trabajos")

    # Only leaf items (actual work items, not sections)
    updates = reprice_budget(db, org_id, budget, config, items)
    total_directo = sum(u["directo_total"] for u in updates)

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
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "El presupuesto no tiene trabajos")
    return _run_cascade(db, org_id, budget, items)


def _run_cascade(
    db, org_id: str, budget: dict, items: list[dict], price_for=None, strict: bool = False,
) -> dict:
    """Recalculate a budget in place (see cascade_recalculate).

    ``price_for(resource)`` -> (precio, fecha, entry_id) or None: when given,
    each resource takes that price before its subtotal is calculated.
    ``strict``: a write that fails (or updates nothing) raises instead of being
    logged and skipped, so the caller can undo the whole update.
    """
    raw_config = load_org_config(db, org_id)
    config = _apply_config_defaults({**raw_config, **effective_indirects(raw_config, budget)})

    # Waste levels for inherited values
    org_waste = raw_config.get("desperdicio_pct")
    budget_waste = budget.get("desperdicio_pct")
    # All recipes of the org: a resource may come from a recipe other than its item's
    # (combined items, Cargar obra), so the lookup cannot be limited to the items' recipes
    template_waste: dict[str, object] = {}
    if any(i.get("template_id") for i in items):
        templates = (
            db.table("item_templates")
            .select("*")
            .eq("org_id", org_id)
            .execute()
            .data or []
        )
        template_waste = {t["id"]: t.get("desperdicio_pct") for t in templates}

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
                    None, budget_waste,
                    template_waste.get(row.get("template_id") or item.get("template_id")), org_waste,
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
            written = db.table("item_resources").update(patch).eq("id", res["id"]).execute()
            if strict and not written.data:
                raise RuntimeError(f"No se actualizó el recurso {res['id']}")
            resources_updated += 1
        except Exception:
            if strict:
                raise
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

        price_item(item_copy, config)

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
            written = db.table("budget_items").update({**patch, **cascade_extras}).eq("id", item_id).execute()
        except Exception:
            # New columns not yet in DB — fall back to legacy fields only
            logger.warning(
                "Cascade extra fields failed for item %s, using legacy fields",
                item_id,
                exc_info=True,
            )
            written = db.table("budget_items").update(patch).eq("id", item_id).execute()
        if strict and not written.data:
            raise RuntimeError(f"No se actualizó el ítem {item_id}")

        items_updated += 1

    # Build summary from freshly updated items
    all_items = _get_items(budget["id"], org_id)
    summary = calc_budget_summary(all_items, config["iva_pct"])

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


def apply_catalog(db, org_id: str, budget: dict, catalog_id: str) -> dict:
    """Price a budget with one catalog (match by code) and recalculate it like
    "Actualizar precios": _run_cascade with every resource tipo, what the client buys
    at $0 and the cascade of the budget.

    Returns the _run_cascade result plus ``matched`` / ``unmatched`` (resources whose
    code is / is not in the catalog) and ``total_updated`` (new subtotal of the matched ones).
    """
    entries = (
        db.table("catalog_entries")
        .select("*")
        .eq("catalog_id", catalog_id)
        .eq("org_id", org_id)
        .execute()
        .data or []
    )
    price_map: dict[str, dict] = {}
    for entry in entries:
        codigo = (entry.get("codigo") or "").strip()
        if codigo and entry.get("precio_sin_iva") is not None:
            price_map[codigo] = entry
    if not price_map:
        raise HTTPException(404, "El catálogo no tiene precios cargados")

    items = _get_items(str(budget["id"]), org_id)
    if not items:
        raise HTTPException(404, "El presupuesto no tiene trabajos")

    matched: list[dict] = []
    unmatched = 0

    def price_for(resource: dict):
        nonlocal unmatched
        entry = price_map.get((resource.get("codigo") or "").strip())
        if entry is None:
            unmatched += 1
            return None
        matched.append(resource)  # the same dict gets its new subtotal in _run_cascade
        return float(entry["precio_sin_iva"]), entry.get("fecha_precio"), str(entry["id"])

    result = _run_cascade(db, org_id, budget, items, price_for=price_for)
    return {
        **result,
        "matched": len(matched),
        "unmatched": unmatched,
        "total_updated": round(sum(float(r.get("subtotal") or 0) for r in matched), 2),
    }


# ── Update prices ───────────────────────────────────────────────────────────


@router.post("/{budget_id}/actualizar-precios")
async def update_prices(
    budget_id: UUID,
    payload: PriceUpdateRequest = Body(default=PriceUpdateRequest()),
    user: dict = Depends(require_editor),
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
        raise HTTPException(404, "El presupuesto no tiene trabajos")

    anterior = budget.get("precios_al")
    # Save the current state as a version BEFORE changing anything: if this
    # fails, nothing was touched. It is also used to undo a failed update.
    before = _snapshot(db, org_id, budget, items)
    lookup = build_price_lookup(db, org_id, fecha)
    # Codex (PR #25): a price taken from a catalog that is now "solo consulta" must not stay
    # in the total when the oficial catalog cannot replace it. Stop here, before writing anything.
    descartados = discarded_prices(before["resources"], lookup["idx"], fecha)
    if descartados:
        codigos = [d["codigo"] for d in descartados]
        n = len(codigos)
        raise HTTPException(409, {
            "mensaje": (
                f"{'Hay ' + str(n) + ' precios que vienen' if n > 1 else 'Hay 1 precio que viene'} de un catálogo "
                f"que ya no es oficial y {'no están' if n > 1 else 'no está'} en el oficial: {', '.join(codigos)}. "
                "Cargalos en el catálogo oficial y volvé a actualizar. No se cambió nada."
            ),
            "codigos": codigos,
            "precios": descartados,
        })
    notas_antes = f"Antes de actualizar precios (precios al {anterior or 'sin fecha'})"
    try:
        version_anterior = _insert_version(db, org_id, user["user_id"], before, notas_antes)
    except Exception as exc:
        logger.exception("Could not save the version before updating budget %s", bid)
        raise HTTPException(
            500,
            "No se pudo guardar la versión actual. No se cambió nada; probá de nuevo.",
        ) from exc

    price_for, problemas = lookup["price_for"], lookup["problemas"]
    try:
        result = _run_cascade(db, org_id, budget, items, price_for=price_for, strict=True)
        written = db.table("budgets").update({
            "precios_al": fecha.isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", bid).eq("org_id", org_id).execute()
        if not written.data:
            raise RuntimeError("No se guardó la fecha de precios")
        budget = _get_budget(db, bid, org_id)
        version_nueva = _save_version(
            db, org_id, user["user_id"], budget, _get_items(bid, org_id),
            f"Precios al {fecha.isoformat()}",
        )
    except Exception as exc:
        logger.exception("Price update failed for budget %s", bid)
        try:
            _restore(db, org_id, before)
        except Exception:
            logger.exception("Could not restore budget %s", bid)
            raise HTTPException(
                500,
                "La actualización de precios falló y el presupuesto quedó a medias. "
                f"Los valores anteriores están guardados en la versión v{version_anterior['version']}.",
            ) from exc
        # Back as it was: the "antes" version would only repeat the current state
        try:
            db.table("budget_versions").delete().eq("id", version_anterior["version_id"]).eq(
                "org_id", org_id
            ).execute()
        except Exception:
            logger.warning("Could not delete version %s", version_anterior["version_id"], exc_info=True)
        raise HTTPException(
            500,
            "No se pudieron guardar los precios nuevos. El presupuesto quedó como estaba; probá de nuevo.",
        ) from exc

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
    org_id = user["org_id"]
    items = _get_items(str(budget_id), org_id)
    if not items:
        raise HTTPException(404, "El presupuesto está vacío o no tenés acceso")

    # Old items without stored IVA take the IVA of this budget, as /full and the exports do
    db = get_data_db()
    rows = db.table("budgets").select("*").eq("id", str(budget_id)).eq("org_id", org_id).execute().data or []
    raw = load_org_config(db, org_id)
    config = _apply_config_defaults({**raw, **effective_indirects(raw, rows[0] if rows else None)})
    summary = calc_budget_summary(items, config["iva_pct"])
    return AnalysisResponse(budget_id=str(budget_id), **summary)


# ── Versions ─────────────────────────────────────────────────────────────────


def _snapshot(db, org_id: str, budget: dict, items: list[dict]) -> dict:
    """The budget, its items and their resources (with prices), as they are now."""
    item_ids = [i["id"] for i in items]
    resources: list[dict] = []
    for start in range(0, len(item_ids), 200):
        chunk = item_ids[start:start + 200]
        resources.extend(fetch_all(
            lambda chunk=chunk: db.table("item_resources")
            .select("*")
            .eq("org_id", org_id)
            .in_("item_id", chunk)
            .order("id")
        ))
    return {"budget": dict(budget), "items": list(items), "resources": resources}


def _restore(db, org_id: str, snapshot: dict) -> None:
    """Write back every resource, item and the budget date of a snapshot."""
    for table, rows in (("item_resources", snapshot["resources"]), ("budget_items", snapshot["items"])):
        for row in rows:
            data = {k: v for k, v in row.items() if k != "id"}
            written = db.table(table).update(data).eq("id", row["id"]).eq("org_id", org_id).execute()
            if not written.data:
                raise RuntimeError(f"No se pudo restaurar {table} {row['id']}")
    budget = snapshot["budget"]
    db.table("budgets").update({"precios_al": budget.get("precios_al")}).eq(
        "id", budget["id"]
    ).eq("org_id", org_id).execute()


def _insert_version(db, org_id: str, user_id: str, snapshot: dict, notes: str | None) -> dict:
    """Save a snapshot as the next version of its budget."""
    budget = snapshot["budget"]
    bid = budget["id"]

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
            **snapshot,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "notes": notes,
        }),
        "created_by": user_id,
    }).execute()

    return {
        "version_id": result.data[0]["id"],
        "version": next_ver,
    }


def _save_version(db, org_id: str, user_id: str, budget: dict, items: list[dict], notes: str | None) -> dict:
    """Save a snapshot of the budget, its items and their resources (with prices)."""
    return _insert_version(db, org_id, user_id, _snapshot(db, org_id, budget, items), notes)


@router.post("/{budget_id}/versions")
async def create_version(
    budget_id: UUID,
    version: VersionCreate = Body(default=VersionCreate()),
    user: dict = Depends(require_editor),
):
    """Create a snapshot of the current budget state."""
    db = get_data_db()
    bid = str(budget_id)
    org_id = user["org_id"]

    budget = _get_budget(db, bid, org_id)
    items = _get_items(bid, org_id)
    return _save_version(db, org_id, user["user_id"], budget, items, version.notes)


def _version_neto(data: object) -> float:
    """Price without IVA of a saved version: the sum of its works' saved neto."""
    try:
        snapshot = json.loads(data) if isinstance(data, (str, bytes)) else (data or {})
    except (TypeError, ValueError):
        return 0.0
    items = snapshot.get("items") if isinstance(snapshot, dict) else None
    if not isinstance(items, list):
        return 0.0
    return calc_budget_summary([i for i in items if isinstance(i, dict)])["neto_total"]


_VERSION_FIELDS = ("id", "version", "created_at", "created_by", "precios_al", "notas")


@router.get("/{budget_id}/versions")
async def list_versions(
    budget_id: UUID,
    user: dict = Depends(get_current_user),
):
    """Versions of a budget, newest first, each with ``neto_total`` (price without IVA)."""
    db = get_data_db()
    result = (
        db.table("budget_versions")
        .select(", ".join((*_VERSION_FIELDS, "data")))
        .eq("budget_id", str(budget_id))
        .eq("org_id", user["org_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return [
        {**{k: v.get(k) for k in _VERSION_FIELDS}, "neto_total": _version_neto(v.get("data"))}
        for v in (result.data or [])
    ]


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
        raise HTTPException(404, "Versión no encontrada")

    return {
        "version_id": str(version_id),
        "version": result.data["version"],
        "created_at": result.data["created_at"],
        "snapshot": json.loads(result.data["data"]),
    }
