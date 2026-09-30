"""API tests for smart recipes: templates, apply, item parameters, cascade (Fase 2)."""

from __future__ import annotations

import copy
import os
import uuid
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

ORG = "test-org-uuid"
MOCK_USER = {"user_id": "test-user-uuid", "org_id": ORG}
BUDGET = "00000000-0000-0000-0000-0000000000b1"
ITEM = "00000000-0000-0000-0000-0000000000a1"
ITEM2 = "00000000-0000-0000-0000-0000000000a2"
TEMPLATE = "tmpl-platea"

# Columns added by migration 005 (the fake DB fills them on insert, like Postgres)
RESOURCE_DEFAULTS = {
    "formula": None, "rendimiento": None, "desperdicio_origen": None,
    "lo_compra_cliente": False, "redondear": False, "unidad_compra": 1, "cantidad_redondeo": 0,
}


class Resp:
    def __init__(self, data):
        self.data = data


class Query:
    """Supabase-like query over in-memory lists: eq filters, insert, update, delete."""

    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters: list[tuple[str, object]] = []
        self.action = "select"
        self.payload = None
        self._single = False
        self._limit = None
        self._in: list[tuple[str, set]] = []
        self._order: tuple[str, bool] | None = None
        self._range: tuple[int, int] | None = None

    def select(self, *a, **k): return self
    def order(self, col, desc=False, **k):
        self._order = (col, desc)
        return self
    def range(self, start, end, **k):
        self._range = (start, end)
        return self
    def in_(self, col, values):
        self._in.append((col, {str(v) for v in values}))
        return self
    def limit(self, n, **k):
        self._limit = n
        return self
    def single(self, **k):
        self._single = True
        return self
    def eq(self, col, value):
        self.filters.append((col, str(value)))
        return self
    def insert(self, data, **k):
        self.action, self.payload = "insert", data
        return self
    def update(self, data, **k):
        self.action, self.payload = "update", data
        return self
    def delete(self, **k):
        self.action = "delete"
        return self

    def _match(self, row):
        return all(str(row.get(c)) == v for c, v in self.filters) and all(
            str(row.get(c)) in vs for c, vs in self._in
        )

    def execute(self):
        table = self.db.tables.setdefault(self.name, [])
        if self.action == "insert":
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for row in rows:
                new = {**(RESOURCE_DEFAULTS if self.name == "item_resources" else {}), **copy.deepcopy(row)}
                new.setdefault("id", str(uuid.uuid4()))
                table.append(new)
                out.append(new)
            return Resp(out)
        matched = [r for r in table if self._match(r)]
        if self.action == "update":
            for r in matched:
                r.update(copy.deepcopy(self.payload))
        elif self.action == "delete":
            self.db.tables[self.name] = [r for r in table if not self._match(r)]
        if self._order and self.action == "select":
            col, desc = self._order
            matched = sorted(matched, key=lambda r: (r.get(col) is None, r.get(col) or 0), reverse=desc)
        if self._range is not None:
            matched = matched[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            matched = matched[: self._limit]
        if self.action == "select" and self.db.max_rows is not None:
            # Like PostgREST: a select never returns more than max_rows
            matched = matched[: self.db.max_rows]
        data = [copy.deepcopy(r) for r in matched]
        if self._single:
            return Resp(data[0] if data else None)
        return Resp(data)


class FakeDB:
    def __init__(self, tables, max_rows=None):
        self.tables = copy.deepcopy(tables)
        self.max_rows = max_rows

    def table(self, name):
        return Query(self, name)


PLATEA = {
    "id": TEMPLATE,
    "org_id": ORG,
    "nombre": "Platea de fundación",
    "unidad": "m2",
    "desperdicio_pct": None,
    "parametros": [{"clave": "espesor", "valor": 0.20, "unidad": "m"}],
    "recursos": [
        {"tipo": "material", "codigo": "H30", "descripcion": "Hormigón H30", "unidad": "m3",
         "formula": "Q * espesor"},
        {"tipo": "material", "codigo": "MALLA", "descripcion": "Malla", "unidad": "u",
         "formula": "Q / 15", "desperdicio_pct": 0, "redondear": True},
        {"tipo": "material", "codigo": "NYL", "descripcion": "Nylon", "unidad": "m2",
         "formula": "Q", "lo_compra_cliente": True},
        {"tipo": "mano_obra", "codigo": "MO-OF", "descripcion": "Oficial",
         "trabajadores": 3, "rendimiento": 10, "cargas_sociales_pct": 0},
    ],
}


def base_tables(**over):
    tables = {
        "budgets": [{"id": BUDGET, "org_id": ORG, "name": "Obra", "desperdicio_pct": None}],
        "budget_items": [
            {"id": ITEM, "budget_id": BUDGET, "org_id": ORG, "code": "4.1", "cantidad": 20,
             "notas": None, "template_id": None, "parametros": {}},
        ],
        "item_templates": [copy.deepcopy(PLATEA)],
        "item_resources": [],
        "indirect_config": [{"id": "cfg", "org_id": ORG, "desperdicio_pct": 10}],
        "catalog_entries": [
            {"id": "c1", "org_id": ORG, "codigo": "H30", "precio_sin_iva": 1000},
            {"id": "c2", "org_id": ORG, "codigo": "MALLA", "precio_sin_iva": 50},
            {"id": "c3", "org_id": ORG, "codigo": "NYL", "precio_sin_iva": 5},
            {"id": "c4", "org_id": ORG, "codigo": "MO-OF", "precio_sin_iva": 200},
        ],
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
    fake = FakeDB(base_tables())
    with patch("app.routers.templates.get_data_db", return_value=fake), \
         patch("app.routers.budgets.get_data_db", return_value=fake), \
         patch("app.routers.analysis.get_data_db", return_value=fake):
        yield fake


def resources_by_code(db, item_id=ITEM):
    return {r["codigo"]: r for r in db.tables["item_resources"] if r["item_id"] == item_id}


def apply(client, params=None, item_id=ITEM):
    url = f"/templates/{TEMPLATE}/apply/{BUDGET}/items/{item_id}"
    return client.post(url, json={"parametros": params} if params else None)


# ── Templates CRUD + preview ───────────────────────────────────────────────


class TestTemplateSave:
    def test_create_with_params(self, client, db):
        body = {k: PLATEA[k] for k in ("nombre", "unidad", "parametros", "recursos")}
        r = client.post("/templates", json=body)
        assert r.status_code == 200, r.text
        saved = db.tables["item_templates"][-1]
        assert saved["parametros"][0]["clave"] == "espesor"
        assert saved["recursos"][0]["formula"] == "Q * espesor"

    def test_create_rejects_bad_formula(self, client, db):
        body = {"nombre": "X", "recursos": [{"tipo": "material", "codigo": "A", "formula": "Q * alto"}]}
        r = client.post("/templates", json=body)
        assert r.status_code == 422
        assert "alto" in r.text
        assert len(db.tables["item_templates"]) == 1

    def test_create_rejects_code_injection(self, client, db):
        body = {"nombre": "X", "recursos": [{"tipo": "material", "formula": "__import__('os')"}]}
        assert client.post("/templates", json=body).status_code == 422

    def test_update_checks_formulas_against_saved_params(self, client, db):
        r = client.patch(f"/templates/{TEMPLATE}", json={"recursos": [{"tipo": "material", "formula": "Q * ancho"}]})
        assert r.status_code == 422
        r = client.patch(f"/templates/{TEMPLATE}", json={"recursos": [{"tipo": "material", "formula": "Q * espesor * 2"}]})
        assert r.status_code == 200

    def test_update_marks_template_as_edited(self, client, db):
        db.tables["item_templates"][0]["editado"] = False  # column from migration 007
        assert client.patch(f"/templates/{TEMPLATE}", json={"nombre": "Platea 2"}).status_code == 200
        assert db.tables["item_templates"][0]["editado"] is True

    def test_update_without_edit_column(self, client, db):
        assert client.patch(f"/templates/{TEMPLATE}", json={"nombre": "Platea 2"}).status_code == 200
        assert "editado" not in db.tables["item_templates"][0]

    def test_update_removing_used_param_fails(self, client, db):
        r = client.patch(f"/templates/{TEMPLATE}", json={"parametros": []})
        assert r.status_code == 422

    def test_update_waste_to_null_means_inherit(self, client, db):
        db.tables["item_templates"][0]["desperdicio_pct"] = 8
        r = client.patch(f"/templates/{TEMPLATE}", json={"desperdicio_pct": None})
        assert r.status_code == 200
        assert db.tables["item_templates"][0]["desperdicio_pct"] is None


class TestPreview:
    def test_preview(self, client, db):
        body = {"cantidad": 30, "recursos": PLATEA["recursos"], "parametros": PLATEA["parametros"],
                "valores": {"espesor": 0.15}}
        r = client.post("/templates/preview", json=body)
        data = r.json()
        assert data["ok"] is True
        rows = {row["codigo"]: row for row in data["recursos"]}
        assert rows["H30"]["cantidad"] == pytest.approx(4.5)
        assert rows["H30"]["desperdicio_pct"] == 10
        assert rows["H30"]["desperdicio_origen"] == "organizacion"
        assert rows["H30"]["cantidad_efectiva"] == pytest.approx(4.95)
        assert rows["MO-OF"]["dias"] == 3
        assert data["desperdicio_organizacion"] == 10

    def test_preview_template_waste(self, client, db):
        body = {"cantidad": 10, "recursos": [{"tipo": "material", "formula": "Q"}], "desperdicio_pct": 5}
        row = client.post("/templates/preview", json=body).json()["recursos"][0]
        assert (row["desperdicio_pct"], row["desperdicio_origen"]) == (5, "plantilla")

    def test_preview_errors_in_body(self, client, db):
        body = {"cantidad": 10, "recursos": [{"tipo": "material", "formula": "Q *"}]}
        data = client.post("/templates/preview", json=body).json()
        assert data["ok"] is False and data["errores"]

    def test_preview_runtime_error(self, client, db):
        body = {"cantidad": 10, "recursos": [{"tipo": "material", "formula": "Q / x"}],
                "parametros": [{"clave": "x", "valor": 0}]}
        data = client.post("/templates/preview", json=body).json()
        assert data["ok"] is False and "cero" in data["errores"][0]


# ── Apply ─────────────────────────────────────────────────────────────────


class TestApply:
    def test_apply_defaults(self, client, db):
        r = apply(client)
        assert r.status_code == 200, r.text
        res = resources_by_code(db)
        assert res["H30"]["cantidad"] == pytest.approx(4)  # 20 m2 × 0.20 m
        assert res["H30"]["desperdicio_pct"] == 10
        assert res["H30"]["desperdicio_origen"] == "organizacion"
        assert res["H30"]["subtotal"] == pytest.approx(4400)
        assert res["MALLA"]["desperdicio_origen"] == "recurso"
        assert res["MO-OF"]["dias"] == 2 and res["MO-OF"]["trabajadores"] == 3
        assert res["MO-OF"]["subtotal"] == pytest.approx(3 * 2 * 200)
        assert res["NYL"]["lo_compra_cliente"] is True and res["NYL"]["subtotal"] == 0
        assert res["NYL"]["cantidad_efectiva"] == pytest.approx(22)

        item = db.tables["budget_items"][0]
        assert item["template_id"] == TEMPLATE
        assert item["parametros"] == {"espesor": 0.2}
        # client material is not in the cost
        # (unit price is rounded to cents before × Q, so allow a few cents)
        assert item["mat_total"] == pytest.approx(4400 + res["MALLA"]["subtotal"], abs=0.5)

    def test_apply_with_budget_params(self, client, db):
        apply(client, {"espesor": 0.15})
        assert resources_by_code(db)["H30"]["cantidad"] == pytest.approx(3)
        assert db.tables["budget_items"][0]["parametros"] == {"espesor": 0.15}

    def test_budget_waste_beats_template_and_org(self, client, db):
        db.tables["budgets"][0]["desperdicio_pct"] = 5
        db.tables["item_templates"][0]["desperdicio_pct"] = 8
        apply(client)
        h30 = resources_by_code(db)["H30"]
        assert (h30["desperdicio_pct"], h30["desperdicio_origen"]) == (5, "presupuesto")

    def test_template_waste_beats_org(self, client, db):
        db.tables["item_templates"][0]["desperdicio_pct"] = 8
        apply(client)
        h30 = resources_by_code(db)["H30"]
        assert (h30["desperdicio_pct"], h30["desperdicio_origen"]) == (8, "plantilla")

    def test_legacy_template_still_works(self, client, db):
        db.tables["item_templates"][0].update({
            "parametros": [],
            "recursos": '[{"tipo": "material", "codigo": "H30", "cantidad_por_unidad": 0.1, "desperdicio_pct": 0}]',
        })
        assert apply(client).status_code == 200
        assert resources_by_code(db)["H30"]["cantidad"] == pytest.approx(2)

    def test_bad_formula_creates_nothing(self, client, db):
        db.tables["item_templates"][0]["recursos"].append(
            {"tipo": "material", "codigo": "X", "formula": "Q / espesor_cero"}
        )
        assert apply(client).status_code == 422
        assert db.tables["item_resources"] == []

    def test_other_org_budget(self, client, db):
        db.tables["budgets"][0]["org_id"] = "other-org"
        assert apply(client).status_code == 404


# ── Item parameters and quantity changes ──────────────────────────────────


class TestItemParams:
    def test_change_param_recalculates(self, client, db):
        apply(client)
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}/parametros", json={"parametros": {"espesor": 0.30}})
        assert r.status_code == 200, r.text
        h30 = resources_by_code(db)["H30"]
        assert h30["cantidad"] == pytest.approx(6)
        assert h30["subtotal"] == pytest.approx(6 * 1.1 * 1000)
        item = db.tables["budget_items"][0]
        assert item["parametros"] == {"espesor": 0.30}
        assert item["mat_total"] > 6000

    def test_unknown_param(self, client, db):
        apply(client)
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}/parametros", json={"parametros": {"alto": 1}})
        assert r.status_code == 422

    def test_quantity_change_follows_formulas(self, client, db):
        apply(client)
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}", json={"cantidad": 40})
        assert r.status_code == 200, r.text
        res = resources_by_code(db)
        assert res["H30"]["cantidad"] == pytest.approx(8)
        assert res["MO-OF"]["dias"] == pytest.approx(4)

    def test_manual_waste_edit_stops_inheriting(self, client, db):
        apply(client)
        rid = resources_by_code(db)["H30"]["id"]
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}/resources/{rid}", json={"desperdicio_pct": 3})
        assert r.status_code == 200, r.text
        h30 = resources_by_code(db)["H30"]
        assert (h30["desperdicio_pct"], h30["desperdicio_origen"]) == (3, "recurso")

    def test_saving_same_waste_keeps_inheriting(self, client, db):
        apply(client)
        rid = resources_by_code(db)["H30"]["id"]
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}/resources/{rid}",
                         json={"desperdicio_pct": 10, "precio_unitario": 1200})
        assert r.status_code == 200, r.text
        assert resources_by_code(db)["H30"]["desperdicio_origen"] == "organizacion"

    def test_mark_client_material_by_hand(self, client, db):
        apply(client)
        rid = resources_by_code(db)["H30"]["id"]
        r = client.patch(f"/budgets/{BUDGET}/items/{ITEM}/resources/{rid}", json={"lo_compra_cliente": True})
        assert r.status_code == 200, r.text
        assert resources_by_code(db)["H30"]["subtotal"] == 0
        assert db.tables["budget_items"][0]["mat_total"] < 100


# ── Cascade recalculation ─────────────────────────────────────────────────


class TestCascade:
    def _two_items(self, client, db):
        db.tables["budget_items"].append(
            {"id": ITEM2, "budget_id": BUDGET, "org_id": ORG, "code": "4.2", "cantidad": 20,
             "notas": None, "template_id": None, "parametros": {}},
        )
        apply(client)
        apply(client, item_id=ITEM2)

    def test_rounding_over_whole_budget(self, client, db):
        self._two_items(client, db)
        # MALLA: 20/15 + 20/15 = 2.67 -> buy 3. Rounding each item would give 2 + 2 = 4.
        r = client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["errores"] == []
        malla = [x for x in data["redondeos"] if x["codigo"] == "MALLA"][0]
        assert malla["envases"] == 3
        total = sum(r["cantidad_efectiva"] for r in db.tables["item_resources"] if r["codigo"] == "MALLA")
        assert total == pytest.approx(3)
        assert all(r["cantidad_redondeo"] > 0 for r in db.tables["item_resources"] if r["codigo"] == "MALLA")

    def test_budget_waste_change_flows_to_inherited_only(self, client, db):
        apply(client)
        db.tables["budgets"][0]["desperdicio_pct"] = 0
        client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        res = resources_by_code(db)
        assert (res["H30"]["desperdicio_pct"], res["H30"]["desperdicio_origen"]) == (0, "presupuesto")
        assert res["H30"]["cantidad_efectiva"] == pytest.approx(4)
        # MALLA had its own value in the template: untouched
        assert res["MALLA"]["desperdicio_origen"] == "recurso"

    def test_client_material_not_in_totals(self, client, db):
        apply(client)
        client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        item = db.tables["budget_items"][0]
        costed = sum(r["subtotal"] for r in db.tables["item_resources"]
                     if r["tipo"] == "material" and not r["lo_compra_cliente"])
        assert item["mat_total"] == pytest.approx(costed, abs=0.05)

    def test_formula_error_is_reported(self, client, db):
        apply(client)
        for row in db.tables["item_resources"]:
            if row["codigo"] == "H30":
                row["formula"] = "Q * falta"
        data = client.post(f"/budgets/{BUDGET}/cascade-recalculate").json()
        assert data["errores"] and "falta" in data["errores"][0]

    def test_pre_migration_rows_are_not_patched_with_new_columns(self, client, db):
        db.tables["item_resources"].append({
            "id": "old", "item_id": ITEM, "org_id": ORG, "tipo": "material", "codigo": "OLD",
            "cantidad": 2, "desperdicio_pct": 0, "precio_unitario": 10,
        })
        client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        old = [r for r in db.tables["item_resources"] if r["id"] == "old"][0]
        assert "cantidad_redondeo" not in old and "desperdicio_origen" not in old
        assert old["subtotal"] == 20
