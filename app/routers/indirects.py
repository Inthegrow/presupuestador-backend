"""General indirect % of the organization (Fase 4).

These are the values every new budget starts with. Changing them does not
change the budgets that already have their own values.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, require_admin
from app.budget_prices import general_indirects, load_org_config, save_org_config
from app.db import get_data_db
from app.schemas import IndirectConfigUpdate

router = APIRouter()


def _response(org_config: dict) -> dict:
    return {
        **org_config,
        **general_indirects(org_config),
        "desperdicio_pct": org_config.get("desperdicio_pct"),
    }


@router.get("/general")
async def get_general_indirects(user: dict = Depends(get_current_user)):
    db = get_data_db()
    return _response(load_org_config(db, user["org_id"]))


@router.patch("/general")
async def update_general_indirects(
    payload: IndirectConfigUpdate,
    user: dict = Depends(require_admin),
):
    db = get_data_db()
    org_id = user["org_id"]
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "No hay campos para actualizar")
    return _response(save_org_config(db, org_id, data))
