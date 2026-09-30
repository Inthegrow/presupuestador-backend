"""Standard trees: the organization's rubros / subrubros / items (Fase 3).

Loaded from the Maestro's CYP sheet by import_recetas.py. Each item may link
to its recipe (item_templates). Read-only for now.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.db import get_data_db
from app.tree import build_tree

router = APIRouter()


@router.get("")
async def list_standard_trees(user: dict = Depends(get_current_user)):
    db = get_data_db()
    result = db.table("standard_trees").select("*").eq("org_id", user["org_id"]).order("nombre").execute()
    return result.data or []


@router.get("/{tree_id}")
async def get_standard_tree(tree_id: str, user: dict = Depends(get_current_user)):
    """The tree with its nodes nested (children), in CYP order."""
    db = get_data_db()
    org_id = user["org_id"]
    tree = db.table("standard_trees").select("*").eq("id", tree_id).eq("org_id", org_id).execute()
    if not tree.data:
        raise HTTPException(404, "Árbol no encontrado")
    nodes = (
        db.table("standard_tree_nodes")
        .select("*")
        .eq("tree_id", tree_id)
        .eq("org_id", org_id)
        .order("orden")
        .execute()
    )
    rows = sorted(nodes.data or [], key=lambda n: n.get("orden") or 0)
    return {**tree.data[0], "nodos": build_tree(rows)}
