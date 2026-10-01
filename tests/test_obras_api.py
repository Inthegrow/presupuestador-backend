"""Cargar una obra desde la app: /obras/analizar y /obras/cargar."""

from __future__ import annotations

import copy
import json
import os
from io import BytesIO
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.test_obra_import import TEMPLATES, _workbook
from tests.test_recipes_api import MOCK_USER, ORG, FakeDB

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _excel() -> bytes:
    buf = BytesIO()
    _workbook().save(buf)
    return buf.getvalue()


def _tables(**over) -> dict:
    templates = [
        {**copy.deepcopy(t), "id": f"tmpl-{c}", "org_id": ORG, "nombre": f"Receta {c}", "desperdicio_pct": None}
        for c, t in TEMPLATES.items()
    ]
    entries = [
        ("LH18", "material", 500), ("HADN6", "material", 100), ("H30", "material", 1000),
        ("MO-OF", "mano_obra", 200), ("EPS-500", "material", 0), ("ES", "material", 30),
        ("RP-KP", "material", 40), ("RP-PORC", "material", 0),
    ]
    tables = {
        "budgets": [],
        "budget_items": [],
        "item_resources": [],
        "item_templates": templates,
        "indirect_config": [{"id": "cfg", "org_id": ORG, "desperdicio_pct": 5}],
        "price_catalogs": [{"id": "cat1", "org_id": ORG, "name": "Maestro TERRAC - Materiales"}],
        "catalog_entries": [
            {"id": f"e-{c}", "catalog_id": "cat1", "org_id": ORG, "codigo": c, "tipo": t,
             "precio_sin_iva": p, "fecha_precio": "2026-01-01"} for c, t, p in entries
        ],
        "catalog_price_history": [],
    }
    tables.update(over)
    return tables


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture
def db():
    fake = FakeDB(_tables())
    with patch("app.routers.obras.get_data_db", return_value=fake), \
         patch("app.routers.analysis.get_data_db", return_value=fake):
        yield fake


def analizar(client, asignaciones=None):
    data = {"asignaciones": json.dumps(asignaciones)} if asignaciones else {}
    return client.post("/obras/analizar", files={"file": ("obra.xlsx", _excel(), XLSX)}, data=data)


def cargar(client, nombre="OBRA PRUEBA", permitir=False, asignaciones=None):
    data = {"nombre": nombre, "permitir_sin_precio": str(permitir).lower()}
    if asignaciones:
        data["asignaciones"] = json.dumps(asignaciones)
    return client.post("/obras/cargar", files={"file": ("obra.xlsx", _excel(), XLSX)}, data=data)


class TestAnalizar:
    def test_summary_and_price_problems(self, client, db):
        res = analizar(client)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["resumen"]["items"] == 7
        assert body["resumen"]["con_receta"] == 5
        precios = {p["codigo"]: p for p in body["precios"]}
        assert precios["EPS-500"]["problema"] == "sin_precio"
        assert precios["EPS-500"]["entradas"][0]["id"] == "e-EPS-500"
        assert "RP-PORC" not in precios  # lo compra el cliente
        assert body["listo"] is False
        assert db.tables["budgets"] == []  # analizar no escribe

    def test_duplicated_code(self, client, db):
        db.tables["catalog_entries"].append(
            {"id": "e-dup", "catalog_id": "cat1", "org_id": ORG, "codigo": "lh18", "tipo": "material",
             "precio_sin_iva": 9, "fecha_precio": "2026-02-01"})
        precios = {p["codigo"]: p for p in analizar(client).json()["precios"]}
        assert precios["LH18"]["problema"] == "duplicado"
        assert len(precios["LH18"]["entradas"]) == 2

    def test_tasks_and_manual_recipe(self, client, db):
        tareas = {t["descripcion"]: t for t in analizar(client).json()["tareas"]}
        aristas = tareas["ARISTAS DE YESO EN PAREDES"]
        assert aristas["plantillas"] == []

        body = analizar(client, {aristas["clave"]: {"plantillas": [["5.1.4", 1]]}}).json()
        tareas = {t["descripcion"]: t for t in body["tareas"]}
        assert tareas["ARISTAS DE YESO EN PAREDES"]["plantillas"] == [{"codigo": "5.1.4", "factor": 1.0}]
        assert tareas["ARISTAS DE YESO EN PAREDES"]["elegida_a_mano"] is True
        assert body["resumen"]["con_receta"] == 6

    def test_rejects_other_files(self, client, db):
        res = client.post("/obras/analizar", files={"file": ("obra.csv", b"a,b", "text/csv")})
        assert res.status_code == 400


class TestCargar:
    def test_blocked_while_prices_missing(self, client, db):
        res = cargar(client)
        assert res.status_code == 409
        assert "EPS-500" in json.dumps(res.json())
        assert db.tables["budgets"] == []

    def test_loads_after_fixing_prices(self, client, db):
        eps = next(e for e in db.tables["catalog_entries"] if e["codigo"] == "EPS-500")
        eps["precio_sin_iva"] = 10
        res = cargar(client)
        assert res.status_code == 200, res.text
        body = res.json()
        budget = db.tables["budgets"][0]
        assert budget["name"] == "OBRA PRUEBA"
        assert budget["precios_al"]

        items = {i["code"]: i for i in db.tables["budget_items"]}
        assert items["4.2.1"]["parent_id"] == items["4.2"]["id"]
        assert items["4.2"]["parent_id"] == items["4"]["id"]
        assert items["4.2.1"]["template_id"] == "tmpl-5.1.4"
        # Sin receta: precio del Excel
        assert items["4.2.2"]["mat_unitario"] == 5
        # Con receta: calculado desde los recursos por la cascada de la app
        lh18 = next(r for r in db.tables["item_resources"] if r["codigo"] == "LH18")
        assert lh18["precio_unitario"] == 500
        assert lh18["desperdicio_pct"] == 15.0
        hadn6 = next(r for r in db.tables["item_resources"] if r["codigo"] == "HADN6")
        assert (hadn6["desperdicio_pct"], hadn6["desperdicio_origen"]) == (5, "organizacion")
        assert items["4.2.1"]["mat_unitario"] > 0
        assert items["4.2.1"]["neto_total"] > items["4.2.1"]["directo_total"]  # indirectos aplicados
        assert body["con_receta"] == 5

    def test_forced_load_and_name_taken(self, client, db):
        assert cargar(client, permitir=True).status_code == 200
        eps = next(r for r in db.tables["item_resources"] if r["codigo"] == "EPS-500")
        assert eps["precio_unitario"] == 0
        res = cargar(client, permitir=True)
        assert res.status_code == 409
        assert "Ya existe" in res.text

    def test_failure_leaves_nothing(self, client, db):
        with patch("app.routers.analysis._run_cascade", side_effect=RuntimeError("se cortó")):
            res = cargar(client, permitir=True)
        assert res.status_code == 500
        assert "no quedó nada a medias" in res.text
        assert db.tables["budgets"] == []
