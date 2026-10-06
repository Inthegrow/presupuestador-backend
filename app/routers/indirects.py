"""General indirect % of the organization (Fase 4).

These are the values every new budget starts with, and the ones a budget follows
while it has no values of its own. Saving them with ``aplicar`` reprices the budgets
whose cascade changes; the budgets with their own values never change.
"""

from __future__ import annotations

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
from app.calculations import cascade_factors
from app.db import get_data_db
from app.routers.analysis import reprice_budget
from app.schemas import GeneralIndirectsUpdate

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

    budgets = _affected(db, org_id, load_org_config(db, org_id), data)
    saved = save_org_config(db, org_id, data)
    for budget in budgets:
        reprice_budget(db, org_id, budget, {**saved, **effective_indirects(saved, budget)})
    return {**_response(saved), "actualizados": len(budgets)}
