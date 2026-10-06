"""General indirect % of the organization (Fase 4).

These are the values every new budget starts with, and the ones a budget follows
while it has no values of its own. Saving them with ``aplicar`` reprices the budgets
whose cascade changes; the budgets with their own values never change.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, require_admin
from app.budget_prices import (
    INDIRECT_KEYS,
    effective_indirects,
    fetch_all,
    general_indirects,
    load_org_config,
    save_org_config,
)
from app.calculations import CASCADE_FIELDS, cascade_factors
from app.db import get_data_db
from app.routers.analysis import _get_items, _is_leaf_item, reprice_budget
from app.schemas import GeneralIndirectsUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


def _response(org_config: dict) -> dict:
    general = general_indirects(org_config)
    return {
        **org_config,
        **general,
        **cascade_factors(general),
        "desperdicio_pct": org_config.get("desperdicio_pct"),
    }


def _changes(payload: GeneralIndirectsUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    data.pop("aplicar", None)  # not a column
    if not data:
        raise HTTPException(400, "No hay campos para actualizar")
    return data


def _affected(db, org_id: str, org_config: dict, data: dict) -> list[dict]:
    """Budgets of the org whose cascade config would change with ``data``."""
    new_config = {**org_config, **{k: v for k, v in data.items() if k in INDIRECT_KEYS}}
    budgets = fetch_all(
        lambda: db.table("budgets").select("*").eq("org_id", org_id).order("id")
    )
    return [
        b for b in budgets
        if effective_indirects(org_config, b) != effective_indirects(new_config, b)
    ]


@router.get("/general")
async def get_general_indirects(user: dict = Depends(get_current_user)):
    db = get_data_db()
    return _response(load_org_config(db, user["org_id"]))


@router.post("/general/afectados")
async def general_indirects_affected(
    payload: GeneralIndirectsUpdate,
    user: dict = Depends(require_admin),
):
    """Budgets whose price would change with these general values (same body as the PATCH).

    The ones with all their own values are never listed. Nothing is saved.
    """
    db = get_data_db()
    org_id = user["org_id"]
    budgets = _affected(db, org_id, load_org_config(db, org_id), _changes(payload))
    return {"presupuestos": [{"id": b["id"], "nombre": b.get("name")} for b in budgets]}


@router.patch("/general")
async def update_general_indirects(
    payload: GeneralIndirectsUpdate,
    user: dict = Depends(require_admin),
):
    """Save the general values. With ``aplicar: true``, also reprice the budgets that
    follow them (see /general/afectados) and say how many (``actualizados``)."""
    db = get_data_db()
    org_id = user["org_id"]
    data = _changes(payload)
    if not payload.aplicar:
        return _response(save_org_config(db, org_id, data))

    org_config = load_org_config(db, org_id)
    budgets = _affected(db, org_id, org_config, data)
    new_config = {**org_config, **data}

    # Reprice first and save last: while the new values are not saved, a retry finds the
    # same budgets. If anything fails, the repriced budgets get their old prices back.
    done: list[tuple[str, list[dict]]] = []
    try:
        for budget in budgets:
            items = _get_items(str(budget["id"]), org_id)
            done.append((str(budget["id"]), items))
            reprice_budget(db, org_id, budget, {**new_config, **effective_indirects(new_config, budget)}, items,
                           strict=True)
        saved = save_org_config(db, org_id, data)
    except Exception as exc:
        logger.exception("Saving the general indirects failed; restoring %d budgets", len(done))
        try:
            for _, items in done:
                _restore_prices(db, items)
        except Exception:
            logger.exception("Restoring the prices failed")
            raise HTTPException(500, {
                "codigo": "A_MEDIAS",
                "mensaje": "No se guardaron los porcentajes y algunos presupuestos pueden haber quedado con "
                           "precios nuevos. Volvé a guardar: la app termina de actualizarlos.",
            }) from exc
        raise HTTPException(500, {
            "codigo": "NO_SE_APLICO",
            "mensaje": "No se guardaron los porcentajes ni cambió ningún precio. Probá de nuevo.",
        }) from exc
    return {**_response(saved), "actualizados": len(budgets)}


def _restore_prices(db, items: list[dict]) -> None:
    """Write back the cascade values the items had before (only those columns)."""
    for item in items:
        if not _is_leaf_item(item):
            continue
        old = {k: item.get(k) for k in CASCADE_FIELDS if k in item}
        if old:
            db.table("budget_items").update(old).eq("id", item["id"]).execute()
