"""Aplicar una fórmula a un trabajo: reemplaza, pregunta la conversión de unidades,
avisa los precios que faltan y deja el neto al día (PLAN_PRECIO_SEGURO 2.1)."""

from __future__ import annotations

import copy
import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routers.templates import factor_propuesto, scale_resource
from tests.test_recipes_api import BUDGET, ITEM, MOCK_USER, ORG, PLATEA, TEMPLATE, FakeDB, base_tables

CASCOTE = "tmpl-cascote"
OFICIAL = "cat-oficial"

# Maestro 5.2.3: contrapiso de cascote, en m³
CONTRAPISO = {
    "id": CASCOTE,
    "org_id": ORG,
    "codigo": "5.2.3",
    "nombre": "CONTRAPISO DE CASCOTE",
    "unidad": "m3",
    "desperdicio_pct": 0,
    "parametros": [],
    "recursos": [
        {"tipo": "material", "codigo": "CASC", "descripcion": "Cascote", "unidad": "m3", "formula": "Q"},
        {"tipo": "mano_obra", "codigo": "MO-OF", "descripcion": "Oficial",
         "trabajadores": 1, "rendimiento": 2, "cargas_sociales_pct": 0},
    ],
}


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


def _db(**over) -> FakeDB:
    tables = base_tables(**over)
    tables["item_templates"].append(copy.deepcopy(CONTRAPISO))
    tables["catalog_entries"].append({"id": "c5", "org_id": ORG, "codigo": "CASC", "precio_sin_iva": 1000})
    return FakeDB(tables)


@pytest.fixture
def db():
    fake = _db()
    with patch("app.routers.templates.get_data_db", return_value=fake), \
         patch("app.routers.budgets.get_data_db", return_value=fake), \
         patch("app.routers.analysis.get_data_db", return_value=fake):
        yield fake


def apply(client, template=TEMPLATE, item_id=ITEM, **body):
    return client.post(f"/templates/{template}/apply/{BUDGET}/items/{item_id}", json=body or None)


def item(db) -> dict:
    return next(i for i in db.tables["budget_items"] if i["id"] == ITEM)


def resources(db) -> list[dict]:
    return [r for r in db.tables["item_resources"] if r["item_id"] == ITEM]


def as_contrapiso(db, descripcion="CONTRAPISO DE CASCOTE e=8cm", unidad="m2", cantidad=30):
    item(db).update({"description": descripcion, "unidad": unidad, "cantidad": cantidad})


# ── Reemplazar ───────────────────────────────────────────────────────────────


class TestReplace:
    def test_applying_twice_leaves_the_same_resources(self, client, db):
        assert apply(client).status_code == 200
        primera = sorted(r["codigo"] for r in resources(db))
        directo = item(db)["directo_total"]

        r = apply(client)
        assert r.status_code == 200, r.text
        assert sorted(r["codigo"] for r in resources(db)) == primera
        assert len(resources(db)) == len(PLATEA["recursos"])
        assert item(db)["directo_total"] == directo
        assert r.json()["resources_created"] == len(PLATEA["recursos"])

    def test_another_formula_leaves_only_the_new_one(self, client, db):
        apply(client)
        item(db)["unidad"] = "m3"
        assert apply(client, CASCOTE).status_code == 200
        assert sorted(r["codigo"] for r in resources(db)) == ["CASC", "MO-OF"]
        assert item(db)["template_id"] == CASCOTE
        # 20 m³ × $1000 + 10 días × $200
        assert item(db)["directo_total"] == pytest.approx(22000)

    def test_other_items_keep_their_resources(self, client, db):
        db.tables["item_resources"].append(
            {"id": "otro", "item_id": "otro-item", "org_id": ORG, "tipo": "material", "codigo": "X"})
        apply(client)
        apply(client)
        assert any(r["id"] == "otro" for r in db.tables["item_resources"])

    def test_bad_formula_keeps_what_the_item_had(self, client, db):
        apply(client)
        antes = copy.deepcopy(resources(db))
        db.tables["item_templates"][0]["recursos"].append({"tipo": "material", "codigo": "X", "formula": "Q / nada"})
        assert apply(client).status_code == 422
        assert resources(db) == antes


# ── Conversión de unidades ───────────────────────────────────────────────────


class TestConversion:
    def test_m2_item_with_m3_formula_asks(self, client, db):
        as_contrapiso(db)
        r = apply(client, CASCOTE)
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == {
            "codigo": "FALTA_CONVERSION",
            "mensaje": "La fórmula está en m³ y el trabajo en m². ¿Cuántos m³ hay en 1 m²?",
            "unidad_formula": "m³",
            "unidad_trabajo": "m²",
            "factor_propuesto": 0.08,
        }
        assert resources(db) == []
        assert item(db)["template_id"] is None

    def test_proposal_from_the_contrapiso_rule(self, client, db):
        as_contrapiso(db, descripcion="Contrapiso sobre terreno natural")
        r = apply(client, CASCOTE)
        assert r.status_code == 409
        assert r.json()["detail"]["factor_propuesto"] == pytest.approx(0.10)

    def test_no_proposal(self, client, db):
        as_contrapiso(db, descripcion="Relleno de patio")
        r = apply(client, CASCOTE)
        assert r.status_code == 409
        assert r.json()["detail"]["factor_propuesto"] is None

    def test_with_factor_the_direct_cost_is_scaled(self, client, db):
        as_contrapiso(db)
        r = apply(client, CASCOTE, factor=0.1)
        assert r.status_code == 200, r.text
        assert r.json()["factor"] == 0.1
        directo = item(db)["directo_total"]
        casc = next(x for x in resources(db) if x["codigo"] == "CASC")
        assert casc["formula"] == "(Q*0.1)" and casc["cantidad"] == pytest.approx(3)

        # The same formula on an item already in m³ (factor 1)
        item(db)["unidad"] = "m3"
        assert apply(client, CASCOTE).status_code == 200
        assert item(db)["directo_total"] == pytest.approx(directo * 10)
        assert directo == pytest.approx(3300)  # 3 m³ × $1000 + 1,5 días × $200

    def test_recalculating_keeps_the_factor(self, client, db):
        as_contrapiso(db)
        apply(client, CASCOTE, factor=0.1)
        directo = item(db)["directo_total"]
        r = client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        assert r.status_code == 200, r.text
        assert item(db)["directo_total"] == pytest.approx(directo)
        # A new quantity follows the scaled formula too
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}", json={"cantidad": 60})
        assert r.status_code == 200, r.text
        casc = next(x for x in resources(db) if x["codigo"] == "CASC")
        mo = next(x for x in resources(db) if x["codigo"] == "MO-OF")
        assert casc["cantidad"] == pytest.approx(6) and mo["dias"] == pytest.approx(3)

    @pytest.mark.parametrize("factor", [0, -0.1])
    def test_factor_must_be_positive(self, client, db, factor):
        as_contrapiso(db)
        r = apply(client, CASCOTE, factor=factor)
        assert r.status_code == 422
        assert r.json()["detail"] == ["El factor tiene que ser mayor que cero"]
        assert resources(db) == []

    def test_same_unit_written_differently(self, client, db):
        item(db)["unidad"] = "M²"  # the platea is in "m2"
        r = apply(client)
        assert r.status_code == 200, r.text
        assert next(x for x in resources(db) if x["codigo"] == "H30")["cantidad"] == pytest.approx(4)

    def test_same_unit_ignores_the_factor(self, client, db):
        item(db)["unidad"] = "m2"
        assert apply(client, factor=0.5).status_code == 200
        h30 = next(x for x in resources(db) if x["codigo"] == "H30")
        assert h30["cantidad"] == pytest.approx(4) and h30["formula"] == "Q * espesor"


class TestScaleHelpers:
    def test_proposal_rules(self):
        cascote = {"unidad": "m3", "codigo": "5.2.3"}
        assert factor_propuesto("CONTRAPISO e=8cm", "m2", cascote) == 0.08
        assert factor_propuesto("CONTRAPISO", "m2", cascote) == 0.10
        assert factor_propuesto("TELGOPOR 50 MM + CONTRAPISO", "m2", cascote) == 0.08
        # The rule uses another recipe
        assert factor_propuesto("CONTRAPISO", "m2", {"unidad": "m3", "codigo": "4.1.3"}) is None
        # A fixed factor of a rule written for the item's unit (ml of tensor → m³)
        assert factor_propuesto("TENSORES", "ml", {"unidad": "m3", "codigo": "4.1.7"}) == 0.08
        assert factor_propuesto("TENSORES", "m2", {"unidad": "m3", "codigo": "4.1.7"}) is None

    def test_old_resources_scale_their_per_unit_quantities(self):
        mat = scale_resource({"tipo": "material", "cantidad_por_unidad": 2}, 0.1)
        mo = scale_resource({"tipo": "mano_obra", "trabajadores_por_unidad": "0,5"}, 0.1)
        assert mat["cantidad_por_unidad"] == pytest.approx(0.2)
        assert mo["trabajadores_por_unidad"] == pytest.approx(0.05)
        rend = scale_resource({"tipo": "mano_obra", "rendimiento": 10}, 0.1)
        assert rend["rendimiento"] == "(10)/0.1"


# ── Precios que faltan ───────────────────────────────────────────────────────


class TestMissingPrices:
    def _oficial(self, db, entries):
        db.tables["price_catalogs"] = [
            {"id": OFICIAL, "org_id": ORG, "name": "Maestro", "oficial": True, "created_at": "2026-01-01"},
            {"id": "cat-ref", "org_id": ORG, "name": "Las Heras", "oficial": False, "created_at": "2026-09-01"},
        ]
        db.tables["catalog_entries"] = [{"org_id": ORG, "catalog_id": OFICIAL, **e} for e in entries]

    def test_codes_without_price(self, client, db):
        recursos = db.tables["item_templates"][0]["recursos"]
        recursos.append({"tipo": "material", "codigo": "MALLA", "descripcion": "Malla otra vez", "formula": "Q"})
        recursos.append({"tipo": "material", "codigo": "AGUA", "descripcion": "Agua", "formula": "Q"})
        self._oficial(db, [
            {"id": "e1", "codigo": "H30", "tipo": "material", "precio_sin_iva": 1000, "fecha_precio": "2026-08-01"},
            # undated 0: nobody loaded it
            {"id": "e2", "codigo": "MO-OF", "tipo": "mano_obra", "precio_sin_iva": 0, "fecha_precio": None},
            # dated 0: a price ("Va en $0")
            {"id": "e3", "codigo": "AGUA", "tipo": "material", "precio_sin_iva": 0, "fecha_precio": "2026-08-01"},
        ])
        # MALLA is only in the reference list; NYL is bought by the client
        db.tables["catalog_entries"].append(
            {"id": "e4", "org_id": ORG, "catalog_id": "cat-ref", "codigo": "MALLA", "tipo": "material",
             "precio_sin_iva": 50, "fecha_precio": "2026-08-01"})

        r = apply(client)
        assert r.status_code == 200, r.text
        faltan = r.json()["precios_faltantes"]
        assert faltan == [
            {"codigo": "MALLA", "descripcion": "Malla", "motivo": "No está en la lista oficial"},
            {"codigo": "MO-OF", "descripcion": "Oficial", "motivo": "No tiene precio"},
        ]

    def test_none_missing(self, client, db):
        r = apply(client)
        assert r.status_code == 200
        assert r.json()["precios_faltantes"] == []


# ── Neto al día ──────────────────────────────────────────────────────────────


class TestNetAfterApply:
    def test_net_is_calculated(self, client, db):
        # Old indirects of the item do not stay: the cascade of the company applies
        item(db).update({"indirecto_total": 100, "beneficio_total": 50, "neto_total": 0})
        assert apply(client).status_code == 200
        neto = item(db)["neto_total"]
        directo = item(db)["directo_total"]
        assert neto > directo > 0
        assert item(db)["indirecto_total"] > 0 and item(db)["beneficio_total"] > 0

        # Same result as the full recalculation (Recálculo completo)
        r = client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        assert r.status_code == 200, r.text
        assert item(db)["neto_total"] == pytest.approx(neto)
