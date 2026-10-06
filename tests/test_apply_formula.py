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
from app.budget_prices import falta_precio, precios_faltantes
from app.routers.templates import A_MEDIAS, NO_SE_APLICO, factor_propuesto, scale_resource
from tests.test_recipes_api import (
    BUDGET,
    ITEM,
    ITEM2,
    MOCK_USER,
    ORG,
    PLATEA,
    RESOURCE_DEFAULTS,
    TEMPLATE,
    FakeDB,
    base_tables,
)

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

        r = apply(client, reemplazar=True)
        assert r.status_code == 200, r.text
        assert sorted(r["codigo"] for r in resources(db)) == primera
        assert len(resources(db)) == len(PLATEA["recursos"])
        assert item(db)["directo_total"] == directo
        assert r.json()["resources_created"] == len(PLATEA["recursos"])

    def test_another_formula_leaves_only_the_new_one(self, client, db):
        apply(client)
        item(db)["unidad"] = "m3"
        assert apply(client, CASCOTE, reemplazar=True).status_code == 200
        assert sorted(r["codigo"] for r in resources(db)) == ["CASC", "MO-OF"]
        assert item(db)["template_id"] == CASCOTE
        # 20 m³ × $1000 + 10 días × $200
        assert item(db)["directo_total"] == pytest.approx(22000)

    def test_other_items_keep_their_resources(self, client, db):
        db.tables["item_resources"].append(
            {"id": "otro", "item_id": "otro-item", "org_id": ORG, "tipo": "material", "codigo": "X"})
        assert apply(client).status_code == 200
        assert apply(client, reemplazar=True).status_code == 200
        assert any(r["id"] == "otro" for r in db.tables["item_resources"])

    def test_bad_formula_keeps_what_the_item_had(self, client, db):
        apply(client)
        antes = copy.deepcopy(resources(db))
        db.tables["item_templates"][0]["recursos"].append({"tipo": "material", "codigo": "X", "formula": "Q / nada"})
        assert apply(client, reemplazar=True).status_code == 422
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
        assert apply(client, CASCOTE, reemplazar=True).status_code == 200
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


# ── Confirmar antes de reemplazar (Codex, PR #37) ───────────────────────────

# Loaded by hand: the item has no recipe
MANUAL = {**RESOURCE_DEFAULTS, "id": "manual", "item_id": ITEM, "org_id": ORG, "tipo": "material",
          "codigo": "ARENA", "descripcion": "Arena", "cantidad": 1, "desperdicio_pct": 0,
          "precio_unitario": 300, "cantidad_efectiva": 1, "subtotal": 300}

CONFIRMAR = {
    "codigo": "CONFIRMAR_REEMPLAZO",
    "mensaje": "Este trabajo ya tiene 1 recurso cargado (material, mano de obra o subcontrato). La fórmula lo reemplaza.",
    "recursos": 1,
}


class TestConfirmReplace:
    def test_hand_loaded_resources_ask_first(self, client, db):
        db.tables["item_resources"].append(copy.deepcopy(MANUAL))
        r = apply(client)
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == CONFIRMAR
        assert resources(db) == [MANUAL]
        assert item(db)["template_id"] is None

    def test_confirmed_replaces(self, client, db):
        db.tables["item_resources"].append(copy.deepcopy(MANUAL))
        r = apply(client, reemplazar=True)
        assert r.status_code == 200, r.text
        assert sorted(x["codigo"] for x in resources(db)) == sorted(x["codigo"] for x in PLATEA["recursos"])
        assert item(db)["template_id"] == TEMPLATE

    def test_without_resources_nothing_is_asked(self, client, db):
        r = apply(client)
        assert r.status_code == 200, r.text
        assert len(resources(db)) == len(PLATEA["recursos"])

    def test_confirm_comes_before_the_conversion(self, client, db):
        as_contrapiso(db)
        db.tables["item_resources"].append(copy.deepcopy(MANUAL))
        r = apply(client, CASCOTE)
        assert r.status_code == 409 and r.json()["detail"] == CONFIRMAR
        r = apply(client, CASCOTE, reemplazar=True)
        assert r.status_code == 409 and r.json()["detail"]["codigo"] == "FALTA_CONVERSION"
        assert resources(db) == [MANUAL]
        r = apply(client, CASCOTE, reemplazar=True, factor=0.08)
        assert r.status_code == 200, r.text
        assert sorted(x["codigo"] for x in resources(db)) == ["CASC", "MO-OF"]


# ── Todo o nada (Codex, PR #37) ──────────────────────────────────────────────


def fail_writes(db, falla, veces=1):
    """Make the next ``veces`` writes matching ``falla(table, query)`` raise (None: all of them),
    like FailingDB in test_budget_prices."""
    original = db.table
    left = {"n": veces}

    def table(name):
        query = original(name)
        execute = query.execute

        def guarded():
            if query.action in ("insert", "update", "delete") and left["n"] != 0 and falla(name, query):
                if left["n"] is not None:
                    left["n"] -= 1
                raise RuntimeError("write failed")
            return execute()

        query.execute = guarded
        return query

    db.table = table


def by_id(rows) -> dict:
    return {r["id"]: r for r in rows}


def item_update(name, query):
    return name == "budget_items" and query.action == "update"


class TestAtomicApply:
    def _with_other_item(self, db):
        """A second item with a resource, whose saved values a recalculation would change."""
        db.tables["budget_items"].append({
            "id": ITEM2, "budget_id": BUDGET, "org_id": ORG, "code": "4.2", "cantidad": 10,
            "notas": None, "template_id": None, "parametros": {}, "directo_total": 999,
        })
        db.tables["item_resources"].append({
            **RESOURCE_DEFAULTS, "id": "r-otro", "item_id": ITEM2, "org_id": ORG, "tipo": "material",
            "codigo": "H30", "cantidad": 2, "desperdicio_pct": 0, "precio_unitario": 100,
            "cantidad_efectiva": 2, "subtotal": 1,
        })

    def _state(self, db) -> tuple:
        return (
            copy.deepcopy(by_id(db.tables["budget_items"])),
            copy.deepcopy(by_id(db.tables["item_resources"])),
        )

    def test_failed_item_update_puts_back_the_old_resources(self, client, db):
        assert apply(client).status_code == 200
        antes = self._state(db)
        fail_writes(db, item_update)

        r = apply(client, CASCOTE, reemplazar=True)
        assert r.status_code == 500, r.text
        assert r.json()["detail"] == NO_SE_APLICO
        # Same resources (ids and values) and the item still on its recipe
        assert self._state(db) == antes
        assert item(db)["template_id"] == TEMPLATE

    def test_failed_cascade_is_not_a_200(self, client, db):
        self._with_other_item(db)
        assert apply(client).status_code == 200
        # Stale values of the other item: a recalculation would change them
        next(i for i in db.tables["budget_items"] if i["id"] == ITEM2)["directo_total"] = 999
        next(x for x in db.tables["item_resources"] if x["id"] == "r-otro")["subtotal"] = 1
        antes = self._state(db)
        directo = item(db)["directo_total"]
        fail_writes(db, lambda name, q: name == "item_resources" and q.action == "update"
                    and ("id", "r-otro") in q.filters)

        r = apply(client, CASCOTE, reemplazar=True)
        assert r.status_code == 500, r.text
        assert r.json()["detail"] == NO_SE_APLICO
        assert self._state(db) == antes
        assert item(db)["directo_total"] == directo

    def test_failed_restore_says_so(self, client, db):
        assert apply(client).status_code == 200
        fail_writes(db, item_update, veces=None)
        r = apply(client, CASCOTE, reemplazar=True)
        assert r.status_code == 500
        assert r.json()["detail"] == A_MEDIAS

    def test_happy_path(self, client, db):
        self._with_other_item(db)
        r = apply(client)
        assert r.status_code == 200, r.text
        assert set(r.json()) == {"resources_created", "item_updated", "parametros", "factor", "precios_faltantes"}
        assert r.json()["resources_created"] == len(PLATEA["recursos"])
        assert item(db)["template_id"] == TEMPLATE and item(db)["neto_total"] > 0
        assert any(x["id"] == "r-otro" for x in db.tables["item_resources"])


# ── Precios que faltan al abrir el trabajo (Codex, PR #37) ───────────────────


def _res(**kw) -> dict:
    return {"codigo": "H30", "descripcion": "Hormigón", "tipo": "material", "precio_unitario": 0,
            "precio_fecha": None, "lo_compra_cliente": False, **kw}


class TestMissingPriceRule:
    def test_rule(self):
        assert falta_precio(_res()) is True
        assert falta_precio(_res(precio_unitario=None)) is True
        assert falta_precio(_res(precio_fecha="2026-08-01")) is False  # a dated $0 is a price
        assert falta_precio(_res(lo_compra_cliente=True)) is False
        assert falta_precio(_res(precio_unitario=1200)) is False
        assert falta_precio(_res(codigo=None)) is False
        assert falta_precio(_res(codigo=" ")) is False
        assert falta_precio(_res(tipo="mano_obra", codigo="MO-OF")) is True

    def test_one_line_per_code(self):
        faltan = precios_faltantes([_res(), _res(codigo="h30 ", descripcion="Otra"), _res(codigo="X")])
        assert faltan == [
            {"codigo": "H30", "descripcion": "Hormigón", "motivo": "No tiene precio"},
            {"codigo": "X", "descripcion": "Hormigón", "motivo": "No tiene precio"},
        ]


class TestMissingPricesOnOpen:
    def _get(self, client):
        return client.get(f"/budgets/{BUDGET}/items/{ITEM}/precios-faltantes")

    def _add(self, db, rid, **kw):
        db.tables["item_resources"].append({**RESOURCE_DEFAULTS, "id": rid, "item_id": ITEM, "org_id": ORG,
                                             **_res(**kw)})

    def test_missing(self, client, db):
        self._add(db, "r1", codigo="SIN", descripcion="Sin precio")
        self._add(db, "r2", codigo="CERO", precio_fecha="2026-08-01")
        self._add(db, "r3", codigo="NYL", lo_compra_cliente=True)
        self._add(db, "r4", codigo="CON", precio_unitario=500, precio_fecha="2026-08-01")
        self._add(db, "r5", codigo="MO-OF", descripcion="Oficial", tipo="mano_obra")
        self._add(db, "r6", codigo="sin", descripcion="Repetido")
        r = self._get(client)
        assert r.status_code == 200, r.text
        assert r.json() == {"precios_faltantes": [
            {"codigo": "SIN", "descripcion": "Sin precio", "motivo": "No tiene precio"},
            {"codigo": "MO-OF", "descripcion": "Oficial", "motivo": "No tiene precio"},
        ]}

    def test_none_missing(self, client, db):
        self._add(db, "r1", precio_unitario=500)
        assert self._get(client).json() == {"precios_faltantes": []}

    def test_after_apply_matches_the_apply_answer(self, client, db):
        db.tables["catalog_entries"] = [e for e in db.tables["catalog_entries"] if e["codigo"] != "MO-OF"]
        db.tables["catalog_entries"].append({"id": "c4", "org_id": ORG, "codigo": "MO-OF", "precio_sin_iva": 0})
        r = apply(client)
        assert r.status_code == 200, r.text
        assert self._get(client).json()["precios_faltantes"] == r.json()["precios_faltantes"]

    def test_other_company(self, client, db):
        self._add(db, "r1")
        item(db)["org_id"] = "other-org"
        assert self._get(client).status_code == 404
