"""Agregar un trabajo en el renglón del editor: lo crea con su fórmula aplicada, dentro del
rubro de la fórmula, y cuenta los precios que faltan de todo el presupuesto
(PLAN_AGREGAR_TRABAJO 2)."""

from __future__ import annotations

import copy
import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routers.budgets import NO_SE_AGREGO, RUBRO_AJENO
from app.routers.templates import A_MEDIAS
from tests.test_apply_formula import CASCOTE, CONTRAPISO, fail_writes, item_update
from tests.test_recipes_api import (
    BUDGET,
    ITEM,
    MOCK_USER,
    ORG,
    PLATEA,
    RESOURCE_DEFAULTS,
    TEMPLATE,
    FakeDB,
    base_tables,
)

SECCION = "00000000-0000-0000-0000-0000000000c1"
OTRA = "00000000-0000-0000-0000-0000000000c2"
OTRO_BUDGET = "00000000-0000-0000-0000-0000000000b2"


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture
def db():
    tables = base_tables()
    tables["item_templates"][0]["categoria"] = "ALBAÑILERÍA"
    tables["item_templates"].append({**copy.deepcopy(CONTRAPISO), "categoria": "Contrapisos"})
    tables["catalog_entries"].append({"id": "c5", "org_id": ORG, "codigo": "CASC", "precio_sin_iva": 1000})
    fake = FakeDB(tables)
    with patch("app.routers.templates.get_data_db", return_value=fake), \
         patch("app.routers.budgets.get_data_db", return_value=fake), \
         patch("app.routers.analysis.get_data_db", return_value=fake):
        yield fake


def agregar(client, budget=BUDGET, **body):
    return client.post(f"/budgets/{budget}/trabajos", json={"template_id": TEMPLATE, "cantidad": 40, **body})


def items(db) -> dict[str, dict]:
    return {i["id"]: i for i in db.tables["budget_items"]}


def resources(db, item_id) -> list[dict]:
    return [r for r in db.tables["item_resources"] if r["item_id"] == item_id]


def state(db) -> tuple:
    return copy.deepcopy(items(db)), copy.deepcopy({r["id"]: r for r in db.tables["item_resources"]})


def section(db, sid=SECCION, code="3", nombre="ALBANILERIA", sort_order=0, budget=BUDGET, **kw):
    db.tables["budget_items"].append({
        "id": sid, "budget_id": budget, "org_id": ORG, "parent_id": None, "code": code,
        "description": nombre, "notas": "Seccion", "sort_order": sort_order, "cantidad": None, **kw,
    })


def child(db, iid, parent, code, sort_order=1):
    db.tables["budget_items"].append({
        "id": iid, "budget_id": BUDGET, "org_id": ORG, "parent_id": parent, "code": code,
        "description": "Otro", "notas": None, "sort_order": sort_order, "cantidad": 0,
        "template_id": None, "parametros": {},
    })


# ── Crear con la fórmula ─────────────────────────────────────────────────────


class TestCreate:
    def test_new_item_in_the_rubro_of_its_category(self, client, db):
        antes = set(items(db))
        r = agregar(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"item", "rubro", "precios_faltantes"}

        # The rubro did not exist: created at the end, with the next code
        rubro = body["rubro"]
        assert rubro["creado"] is True and rubro["nombre"] == "Albañilería"
        nuevos = set(items(db)) - antes
        assert nuevos == {rubro["id"], body["item"]["id"]}
        seccion = items(db)[rubro["id"]]
        assert seccion["notas"] == "Seccion" and seccion["parent_id"] is None and seccion["code"] == "5"

        trabajo = items(db)[body["item"]["id"]]
        assert trabajo["parent_id"] == rubro["id"] and trabajo["code"] == "5.1"
        assert trabajo["description"] == "Platea de fundación" and trabajo["unidad"] == "m2"
        assert trabajo["cantidad"] == 40 and trabajo["template_id"] == TEMPLATE
        assert trabajo["parametros"] == {"espesor": 0.20}
        assert seccion["sort_order"] < trabajo["sort_order"]
        # Resources and net, already calculated (the answer is the saved item)
        assert sorted(x["codigo"] for x in resources(db, trabajo["id"])) == sorted(
            x["codigo"] for x in PLATEA["recursos"])
        h30 = next(x for x in resources(db, trabajo["id"]) if x["codigo"] == "H30")
        assert h30["cantidad"] == pytest.approx(8)  # 40 m² × 0,20 m
        assert trabajo["neto_total"] > trabajo["directo_total"] > 0
        assert body["item"] == trabajo
        assert body["precios_faltantes"] == []

    def test_existing_rubro_by_name_without_capitals_or_accents(self, client, db):
        section(db)
        child(db, "i31", SECCION, "3.1")
        child(db, "i34", SECCION, "3.4", sort_order=2)
        n = len(db.tables["budget_items"])
        r = agregar(client)
        assert r.status_code == 200, r.text
        assert r.json()["rubro"] == {"id": SECCION, "nombre": "ALBANILERIA", "creado": False}
        assert len(db.tables["budget_items"]) == n + 1
        trabajo = items(db)[r.json()["item"]["id"]]
        assert trabajo["parent_id"] == SECCION and trabajo["code"] == "3.5"

    def test_chosen_rubro_wins(self, client, db):
        section(db)
        section(db, OTRA, code="7", nombre="Terminaciones", sort_order=5)
        r = agregar(client, parent_id=OTRA, descripcion="Platea del quincho", unidad="M²")
        assert r.status_code == 200, r.text
        assert r.json()["rubro"] == {"id": OTRA, "nombre": "Terminaciones", "creado": False}
        trabajo = items(db)[r.json()["item"]["id"]]
        assert trabajo["parent_id"] == OTRA and trabajo["code"] == "7.1"
        assert trabajo["description"] == "Platea del quincho" and trabajo["unidad"] == "M²"

    @pytest.mark.parametrize("como", ["otro presupuesto", "no es rubro", "no existe", "no es uuid"])
    def test_chosen_rubro_must_be_of_this_budget(self, client, db, como):
        parent = {"otro presupuesto": OTRA, "no es rubro": ITEM, "no existe": SECCION, "no es uuid": "x"}[como]
        if como == "otro presupuesto":
            db.tables["budgets"].append({"id": OTRO_BUDGET, "org_id": ORG, "name": "Otra"})
            section(db, OTRA, budget=OTRO_BUDGET)
        antes = state(db)
        r = agregar(client, parent_id=parent)
        assert r.status_code == 422, r.text
        assert r.json()["detail"] == RUBRO_AJENO
        assert state(db) == antes

    def test_another_rubro_of_another_company_is_not_found(self, client, db):
        section(db, org_id="other-org")
        r = agregar(client, parent_id=SECCION)
        assert r.status_code == 422
        # And by name it is not used either: a new one is created
        r = agregar(client)
        assert r.status_code == 200 and r.json()["rubro"]["creado"] is True

    def test_missing_prices(self, client, db):
        db.tables["catalog_entries"] = [e for e in db.tables["catalog_entries"] if e["codigo"] != "MO-OF"]
        r = agregar(client)
        assert r.status_code == 200, r.text
        assert r.json()["precios_faltantes"] == [
            {"codigo": "MO-OF", "descripcion": "Oficial", "motivo": "No está en el catálogo"}]

    @pytest.mark.parametrize("cantidad", [0, -1])
    def test_quantity_must_be_positive(self, client, db, cantidad):
        antes = state(db)
        assert agregar(client, cantidad=cantidad).status_code == 422
        assert state(db) == antes


# ── Conversión de unidades ───────────────────────────────────────────────────


class TestConversion:
    def test_other_unit_without_factor_asks_and_creates_nothing(self, client, db):
        antes = state(db)
        r = agregar(client, template_id=CASCOTE, descripcion="Contrapiso de cascote e=8cm", unidad="m2",
                    cantidad=30)
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == {
            "codigo": "FALTA_CONVERSION",
            "mensaje": "La fórmula está en m³ y el trabajo en m². ¿Cuántos m³ hay en 1 m²?",
            "unidad_formula": "m³",
            "unidad_trabajo": "m²",
            "factor_propuesto": 0.08,
        }
        assert state(db) == antes

    def test_with_factor_it_is_created_and_scaled(self, client, db):
        r = agregar(client, template_id=CASCOTE, descripcion="Contrapiso de cascote e=8cm", unidad="m2",
                    cantidad=30, factor=0.08)
        assert r.status_code == 200, r.text
        assert r.json()["rubro"]["nombre"] == "Contrapisos"
        trabajo = items(db)[r.json()["item"]["id"]]
        casc = next(x for x in resources(db, trabajo["id"]) if x["codigo"] == "CASC")
        assert casc["formula"] == "(Q*0.08)" and casc["cantidad"] == pytest.approx(2.4)
        assert trabajo["unidad"] == "m2" and trabajo["template_id"] == CASCOTE
        # 2,4 m³ × $1000 + 1,2 días × $200
        assert trabajo["directo_total"] == pytest.approx(2640)

    def test_defaults_come_from_the_formula(self, client, db):
        r = agregar(client, template_id=CASCOTE, cantidad=3)
        assert r.status_code == 200, r.text
        trabajo = r.json()["item"]
        assert trabajo["description"] == "Contrapiso de cascote" and trabajo["unidad"] == "m3"

    @pytest.mark.parametrize("factor", [0, -0.1])
    def test_factor_must_be_positive(self, client, db, factor):
        antes = state(db)
        r = agregar(client, template_id=CASCOTE, unidad="m2", factor=factor)
        assert r.status_code == 422
        assert r.json()["detail"] == ["El factor tiene que ser mayor que cero"]
        assert state(db) == antes


# ── Todo o nada ──────────────────────────────────────────────────────────────


class TestNothingLeftOnFailure:
    def test_failed_apply_removes_the_item_and_the_new_rubro(self, client, db):
        antes = state(db)
        fail_writes(db, item_update)
        r = agregar(client)
        assert r.status_code == 500, r.text
        assert r.json()["detail"] == {"codigo": "NO_SE_APLICO", "mensaje": NO_SE_AGREGO}
        assert state(db) == antes

    def test_failed_cascade_keeps_the_existing_rubro(self, client, db):
        section(db)
        # Stale values of another item: the recalculation of the whole budget writes them
        db.tables["item_resources"].append(_res("r-otro", ITEM, precio_unitario=100, cantidad=2,
                                                desperdicio_pct=0, cantidad_efectiva=2, subtotal=1))
        antes = state(db)
        fail_writes(db, lambda name, q: name == "item_resources" and q.action == "update"
                    and ("id", "r-otro") in q.filters)
        r = agregar(client)
        assert r.status_code == 500, r.text
        assert r.json()["detail"]["codigo"] == "NO_SE_APLICO"
        assert state(db) == antes

    def test_failed_item_insert(self, client, db):
        antes = state(db)
        fail_writes(db, lambda name, q: name == "budget_items" and q.action == "insert"
                    and q.payload.get("notas") is None)
        r = agregar(client)
        assert r.status_code == 500
        assert r.json()["detail"] == {"codigo": "NO_SE_APLICO", "mensaje": NO_SE_AGREGO}
        assert state(db) == antes

    def test_failed_restore_says_so(self, client, db):
        fail_writes(db, item_update, veces=None)
        r = agregar(client)
        assert r.status_code == 500
        assert r.json()["detail"] == {"codigo": "A_MEDIAS", "mensaje": A_MEDIAS}

    def test_bad_formula_creates_nothing(self, client, db):
        db.tables["item_templates"][0]["recursos"].append({"tipo": "material", "codigo": "X", "formula": "Q / nada"})
        antes = state(db)
        assert agregar(client).status_code == 422
        assert state(db) == antes


# ── Otra empresa ─────────────────────────────────────────────────────────────


class TestOtherCompany:
    def test_budget_of_another_company(self, client, db):
        db.tables["budgets"][0]["org_id"] = "other-org"
        antes = state(db)
        r = agregar(client)
        assert r.status_code == 404
        assert state(db) == antes

    def test_formula_of_another_company(self, client, db):
        db.tables["item_templates"][0]["org_id"] = "other-org"
        antes = state(db)
        assert agregar(client).status_code == 404
        assert state(db) == antes


# ── Precios que faltan de todo el presupuesto ─────────────────────────────────


def _res(rid, item_id, **kw) -> dict:
    return {**RESOURCE_DEFAULTS, "id": rid, "item_id": item_id, "org_id": ORG, "tipo": "material",
            "codigo": "H30", "descripcion": "Hormigón", "precio_unitario": 0, "precio_fecha": None, **kw}


class TestMissingPricesOfTheBudget:
    def _get(self, client, budget=BUDGET):
        return client.get(f"/budgets/{budget}/precios-faltantes")

    def test_counts_per_item(self, client, db):
        section(db)
        child(db, "i31", SECCION, "3.1")
        child(db, "i32", SECCION, "3.2")
        db.tables["item_resources"] += [
            _res("r1", ITEM),
            _res("r2", ITEM, codigo="h30 "),  # the same code: one line
            _res("r3", ITEM, codigo="MO-OF", tipo="mano_obra"),
            _res("r4", ITEM, codigo="NYL", lo_compra_cliente=True),
            _res("r5", "i31", precio_unitario=500),
            _res("r6", "i31", codigo="AGUA", precio_fecha="2026-08-01"),  # a dated $0 is a price
            _res("r7", "otro-item"),  # not of this budget
        ]
        r = self._get(client)
        assert r.status_code == 200, r.text
        assert r.json() == {"por_item": {ITEM: 2, "i31": 0, "i32": 0},
                            "recursos_por_item": {ITEM: 4, "i31": 2, "i32": 0}}

    def test_reads_the_resources_in_bulk(self, client, db):
        for n in range(5):
            child(db, f"i{n}", None, f"9.{n}")
        calls = []
        original = db.table

        def table(name):
            calls.append(name)
            return original(name)

        db.table = table
        assert self._get(client).status_code == 200
        assert calls.count("item_resources") == 1

    def test_matches_the_new_item(self, client, db):
        db.tables["catalog_entries"] = [e for e in db.tables["catalog_entries"] if e["codigo"] not in ("MO-OF", "H30")]
        r = agregar(client)
        assert r.status_code == 200, r.text
        por_item = self._get(client).json()["por_item"]
        assert por_item[r.json()["item"]["id"]] == len(r.json()["precios_faltantes"]) == 2
        assert r.json()["rubro"]["id"] not in por_item

    def test_counts_the_real_resources(self, client, db):
        # Codex, PR #41: a formula that leaves no resources must not look "listo" in the table
        originales = copy.deepcopy(db.tables["item_templates"][0]["recursos"])
        db.tables["item_templates"][0]["recursos"] = []
        r = agregar(client)
        assert r.status_code == 200, r.text
        nuevo = r.json()["item"]["id"]
        body = self._get(client).json()
        assert body["por_item"][nuevo] == 0
        assert body["recursos_por_item"][nuevo] == 0
        # and with the formula's resources, deleting all of them later also gives 0
        db.tables["item_templates"][0]["recursos"] = originales
        r = agregar(client)
        otro = r.json()["item"]["id"]
        assert self._get(client).json()["recursos_por_item"][otro] > 0
        db.tables["item_resources"] = [x for x in db.tables["item_resources"] if x["item_id"] != otro]
        assert self._get(client).json()["recursos_por_item"][otro] == 0

    def test_other_company(self, client, db):
        db.tables["budgets"][0]["org_id"] = "other-org"
        assert self._get(client).status_code == 404
