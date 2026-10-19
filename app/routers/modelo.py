"""El modelo de presupuestación de Terrac: los «Trabajos típicos» del asistente de Nuevo presupuesto.

app/data/modelo_terrac.json se armó una sola vez de la hoja CYP del modelo de Terrac (emilia_modelo.xlsx):
rubros, pisos y trabajos en orden, con código, descripción y unidad, sin cantidades ni precios. Los
trabajos del modelo tienen el código de las fórmulas del Maestro (4.1.3 Bases aisladas): cada uno sale
con la fórmula de la empresa que tiene ese código, si existe, para que Nuevo presupuesto lo cree con la
fórmula aplicada (POST /budgets/create-full, ``plantilla``).
"""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.db import get_data_db
from app.routers.obras import _templates
from app.tree import normalize_item_code

router = APIRouter()

MODELO = Path(__file__).resolve().parent.parent / "data" / "modelo_terrac.json"


@lru_cache(maxsize=1)
def load_modelo() -> dict:
    """The model as it is in the file (read once)."""
    return json.loads(MODELO.read_text(encoding="utf-8"))


def trabajos_del_modelo(modelo: dict) -> list[dict]:
    """Every work of the model, in order (the ones of each rubro, then the ones of its pisos)."""
    out: list[dict] = []
    for rubro in modelo.get("rubros") or []:
        out += rubro.get("trabajos") or []
        for piso in rubro.get("pisos") or []:
            out += piso.get("trabajos") or []
    return out


def modelo_con_formulas(templates: dict[str, dict]) -> dict:
    """The model with, per work, the company's fórmula with its code.

    ``plantilla``: the fórmula's code (None when the company has no fórmula with that code: the
    work goes in without a fórmula), ``plantilla_nombre`` and ``plantilla_unidad``.
    """
    by_code = {normalize_item_code(c): t for c, t in templates.items()}
    modelo = copy.deepcopy(load_modelo())
    trabajos = trabajos_del_modelo(modelo)
    for trabajo in trabajos:
        tmpl = by_code.get(normalize_item_code(trabajo.get("codigo")))
        trabajo["plantilla"] = tmpl.get("codigo") if tmpl else None
        trabajo["plantilla_nombre"] = tmpl.get("nombre") if tmpl else None
        trabajo["plantilla_unidad"] = tmpl.get("unidad") if tmpl else None
    modelo["resumen"] = {
        "rubros": len(modelo.get("rubros") or []),
        "trabajos": len(trabajos),
        "con_formula": sum(1 for t in trabajos if t["plantilla"]),
    }
    return modelo


@router.get("/modelo-terrac")
async def modelo_terrac(user: dict = Depends(get_current_user)):
    """Rubros, pisos y trabajos del modelo de Terrac, cada trabajo con la fórmula de la empresa de su código."""
    return modelo_con_formulas(_templates(get_data_db(), user["org_id"]))
