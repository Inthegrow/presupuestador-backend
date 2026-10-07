"""Buscador de precios en internet: POST /precios/buscar (app/price_search.py).

No guarda nada: "Usar este precio" es el POST/PATCH de la entrada de la lista
(/catalogs/{id}/entries) con ``fuente`` y ``fuente_url``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import price_search
from app.auth import require_editor

router = APIRouter()


class BusquedaPrecio(BaseModel):
    descripcion: str = Field(min_length=1, max_length=300)
    unidad: str | None = Field(default=None, max_length=40)
    tipo: str | None = Field(default=None, max_length=40)
    codigo: str | None = Field(default=None, max_length=80)


@router.post("/buscar")
async def buscar_precio(body: BusquedaPrecio, user: dict = Depends(require_editor)):
    """2 to 6 price options from shops, each with its link and the arithmetic to the app's unit (without VAT)."""
    if not body.descripcion.strip():
        raise HTTPException(422, "Escribí qué querés buscar")
    try:
        # Through the module: the fake server and the tests replace buscar_opciones
        return await price_search.buscar_opciones(body.descripcion.strip(), body.unidad, body.tipo, body.codigo)
    except price_search.BuscadorNoConfigurado as exc:
        raise HTTPException(503, {"codigo": "NO_CONFIGURADO", "mensaje": price_search.NO_CONFIGURADO}) from exc
    except price_search.BuscadorError as exc:
        raise HTTPException(502, {"codigo": "ERROR_BUSQUEDA", "mensaje": str(exc)}) from exc
