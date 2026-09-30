"""Fase 4: indirectos por obra, "precios al [fecha]" y actualizar precios."""

from __future__ import annotations

import copy
import json
import os
from datetime import date

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")
from unittest.mock import patch

import pytest

from fastapi.testclient import TestClient

from app.budget_prices import effective_indirects, find_entry, general_indirects, pick_price
from app.main import create_app
from tests.test_recipes_api import BUDGET, ITEM, MOCK_USER, ORG, FakeDB, Resp

TODAY = date(2026, 9, 30)
ITEM_TOTALS = (
    "mat_unitario", "mo_unitario", "mat_total", "mo_total", "directo_total", "indirecto_total",
    "beneficio_total", "neto_total", "impuestos_total", "iva_total", "total_final",
)


def resource(**over):
    base = {
        "item_id": ITEM, "org_id": ORG, "tipo": "material", "codigo": None, "descripcion": "",
        "cantidad": 1, "desperdicio_pct": 0, "precio_unitario": 0, "subtotal": 0,
        "catalog_entry_id": None, "formula": None, "rendimiento": None, "desperdicio_origen": None,
        "lo_compra_cliente": False, "redondear": False, "unidad_compra": 1, "cantidad_redondeo": 0,
        "trabajadores": 0, "dias": 0, "cargas_sociales_pct": 0, "precio_fecha": None,
        "cantidad_efectiva": None,
    }
    return {**base, **over}


def tables(**over):
    t = {
        "budgets": [{
            "id": BUDGET, "org_id": ORG, "name": "Obra", "desperdicio_pct": None,
            "indirectos": {}, "precios_al": "2026-03-01",
        }],
        "budget_items": [
            {"id": ITEM, "budget_id": BUDGET, "org_id": ORG, "code": "4.1", "cantidad": 10,
             "notas": None, "template_id": None, "parametros": {},
             **dict.fromkeys(ITEM_TOTALS, 0)},
        ],
        "item_resources": [
            resource(id="r1", codigo="H30", catalog_entry_id="c1", precio_unitario=1000, subtotal=1000),
            resource(id="r2", tipo="mano_obra", codigo="mo-of", trabajadores=1, dias=2,
                     precio_unitario=200, subtotal=400),
            resource(id="r3", codigo="XYZ", precio_unitario=7, subtotal=7),
        ],
        "catalog_entries": [
            {"id": "c1", "org_id": ORG, "tipo": "material", "codigo": "H30",
             "precio_sin_iva": 2000, "fecha_precio": "2026-12-01"},
            {"id": "c4", "org_id": ORG, "tipo": "mano_obra", "codigo": "MO-OF",
             "precio_sin_iva": 300, "fecha_precio": "2026-08-01"},
        ],
        "catalog_price_history": [
            {"id": "h1", "entry_id": "c1", "org_id": ORG, "precio_sin_iva": 1000,
             "fecha_precio": "2026-03-01", "created_at": "2026-03-01T10:00:00"},
            {"id": "h2", "entry_id": "c1", "org_id": ORG, "precio_sin_iva": 1500,
             "fecha_precio": "2026-09-01", "created_at": "2026-09-01T10:00:00"},
            {"id": "h3", "entry_id": "c1", "org_id": ORG, "precio_sin_iva": 2000,
             "fecha_precio": "2026-12-01", "created_at": "2026-09-20T10:00:00"},
        ],
        "indirect_config": [{"id": "cfg", "org_id": ORG, "estructura_pct": 20, "beneficio_pct": 10}],
        "budget_versions": [],
        "item_templates": [],
    }
    t.update(over)
    return t


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture
def db():
    fake = FakeDB(tables())
    with patch("app.routers.budgets.get_data_db", return_value=fake), \
         patch("app.routers.analysis.get_data_db", return_value=fake), \
         patch("app.routers.indirects.get_data_db", return_value=fake), \
         patch("app.routers.analysis.today", return_value=TODAY), \
         patch("app.routers.budgets.today", return_value=TODAY):
        yield fake


def res(db, rid):
    return next(r for r in db.tables["item_resources"] if r["id"] == rid)


def budget(db):
    return db.tables["budgets"][0]


# ── Precio a una fecha ──────────────────────────────────────────────────────


class TestPickPrice:
    HISTORY = tables()["catalog_price_history"]
    ENTRY = tables()["catalog_entries"][0]

    def test_last_price_on_or_before_date(self):
        assert pick_price(self.ENTRY, self.HISTORY, date(2026, 9, 30)) == (1500, "2026-09-01")
        assert pick_price(self.ENTRY, self.HISTORY, date(2026, 5, 1)) == (1000, "2026-03-01")

    def test_future_prices_are_ignored(self):
        assert pick_price(self.ENTRY, self.HISTORY, date(2026, 12, 1)) == (2000, "2026-12-01")

    def test_nothing_before_the_date(self):
        assert pick_price(self.ENTRY, self.HISTORY, date(2026, 1, 1)) is None

    def test_entry_without_history(self):
        entry = {"precio_sin_iva": 50, "fecha_precio": None}
        assert pick_price(entry, [], TODAY) == (50, None)

    def test_dated_price_wins_over_undated(self):
        entry = {"precio_sin_iva": 50, "fecha_precio": None}
        history = [{"precio_sin_iva": 80, "fecha_precio": "2026-06-01"}]
        assert pick_price(entry, history, TODAY) == (80, "2026-06-01")

    def test_same_date_entry_is_newest(self):
        entry = {"precio_sin_iva": 90, "fecha_precio": "2026-06-01"}
        history = [{"precio_sin_iva": 80, "fecha_precio": "2026-06-01", "created_at": "2026-06-01"}]
        assert pick_price(entry, history, TODAY) == (90, "2026-06-01")


class TestFindEntry:
    def test_by_id_then_by_code(self):
        e1 = {"id": "c1", "codigo": "H30", "tipo": "material"}
        by_id = {"c1": e1}
        by_codigo = {"H30": [e1]}
        assert find_entry({"catalog_entry_id": "c1"}, by_id, by_codigo) == (e1, None)
        assert find_entry({"codigo": " h30 ", "tipo": "material"}, by_id, by_codigo) == (e1, None)

    def test_duplicate_code_is_reported(self):
        a = {"id": "a", "codigo": "H30", "tipo": "material"}
        b = {"id": "b", "codigo": "H30", "tipo": "material"}
        assert find_entry({"codigo": "H30", "tipo": "material"}, {}, {"H30": [a, b]}) == (None, "duplicado")

    def test_same_type_breaks_the_tie(self):
        a = {"id": "a", "codigo": "X", "tipo": "material"}
        b = {"id": "b", "codigo": "X", "tipo": "mano_obra"}
        assert find_entry({"codigo": "X", "tipo": "mano_obra"}, {}, {"X": [a, b]}) == (b, None)

    def test_unknown_code(self):
        assert find_entry({"codigo": "NADA"}, {}, {}) == (None, "sin_precio")


# ── Indirectos por obra ─────────────────────────────────────────────────────


class TestIndirectsMerge:
    def test_defaults_then_general_then_obra(self):
        org = {"estructura_pct": 20, "jefatura_pct": None}
        obra = {"indirectos": {"jefatura_pct": 0, "otra_cosa": 5}}
        eff = effective_indirects(org, obra)
        assert eff["estructura_pct"] == 20
        assert eff["jefatura_pct"] == 0  # 0% is a valid value of the obra
        assert eff["iva_pct"] == 21
        assert "otra_cosa" not in eff

    def test_general_defaults(self):
        assert general_indirects(None)["beneficio_pct"] == 10


class TestIndirectsApi:
    def test_new_budget_starts_with_general_values(self, client, db):
        r = client.post("/budgets", json={"name": "Nueva"})
        assert r.status_code == 200, r.text
        new = db.tables["budgets"][-1]
        assert new["indirectos"]["estructura_pct"] == 20
        assert new["indirectos"]["jefatura_pct"] == 8
        assert new["precios_al"] == "2026-09-30"

    def test_legacy_budget_follows_general(self, client, db):
        data = client.get(f"/budgets/{BUDGET}/indirects").json()
        assert data["estructura_pct"] == 20
        assert data["propios"] is False
        assert data["general"]["estructura_pct"] == 20

    def test_change_only_this_budget(self, client, db):
        r = client.patch(f"/budgets/{BUDGET}/indirects", json={"jefatura_pct": 12})
        assert r.status_code == 200, r.text
        assert r.json()["jefatura_pct"] == 12
        assert r.json()["propios"] is True
        # The budget keeps the full set, the general values do not change
        assert budget(db)["indirectos"]["jefatura_pct"] == 12
        assert budget(db)["indirectos"]["estructura_pct"] == 20
        assert "jefatura_pct" not in db.tables["indirect_config"][0]

    def test_general_change_does_not_touch_budget_with_own_values(self, client, db):
        client.patch(f"/budgets/{BUDGET}/indirects", json={"jefatura_pct": 12})
        r = client.patch("/indirects/general", json={"estructura_pct": 30})
        assert r.status_code == 200, r.text
        assert client.get("/indirects/general").json()["estructura_pct"] == 30
        data = client.get(f"/budgets/{BUDGET}/indirects").json()
        assert data["estructura_pct"] == 20
        assert data["general"]["estructura_pct"] == 30

    def test_desperdicio_stays_general(self, client, db):
        client.patch(f"/budgets/{BUDGET}/indirects", json={"desperdicio_pct": 5})
        assert db.tables["indirect_config"][0]["desperdicio_pct"] == 5
        assert budget(db)["indirectos"] == {}

    def test_cascade_uses_budget_values(self, client, db):
        budget(db)["indirectos"] = {**general_indirects({}), "beneficio_pct": 0, "estructura_pct": 0,
                                    "imprevistos_pct": 0, "jefatura_pct": 0, "logistica_pct": 0,
                                    "herramientas_pct": 0}
        r = client.post(f"/budgets/{BUDGET}/cascade-recalculate")
        assert r.status_code == 200, r.text
        item = db.tables["budget_items"][0]
        assert item["directo_total"] > 0
        assert item["indirecto_total"] == 0
        assert item["beneficio_total"] == 0

    def test_copy_keeps_budget_values_and_date(self, client, db):
        budget(db)["indirectos"] = {"jefatura_pct": 1}
        r = client.post(f"/budgets/{BUDGET}/copy", json={})
        assert r.status_code == 200, r.text
        new = db.tables["budgets"][-1]
        assert new["indirectos"] == {"jefatura_pct": 1}
        assert new["precios_al"] == "2026-03-01"


# ── Actualizar a precios de hoy ─────────────────────────────────────────────


class TestUpdatePrices:
    def test_takes_last_price_and_saves_date(self, client, db):
        r = client.post(f"/budgets/{BUDGET}/actualizar-precios")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["precios_al"] == "2026-09-30"
        assert body["precios_al_anterior"] == "2026-03-01"
        assert body["precios_actualizados"] == 2
        assert budget(db)["precios_al"] == "2026-09-30"

        # H30: the price of December is future, takes September's
        assert res(db, "r1")["precio_unitario"] == 1500
        assert res(db, "r1")["precio_fecha"] == "2026-09-01"
        assert res(db, "r1")["subtotal"] == 1500
        # MO found by code (case-insensitive) and linked to the entry
        assert res(db, "r2")["precio_unitario"] == 300
        assert res(db, "r2")["catalog_entry_id"] == "c4"
        assert res(db, "r2")["subtotal"] == 600
        # No price in the catalog: keeps the old one and is reported
        assert res(db, "r3")["precio_unitario"] == 7
        assert body["sin_precio"] == [{"codigo": "XYZ", "descripcion": "", "motivo": "sin_precio"}]

        item = db.tables["budget_items"][0]
        assert item["directo_total"] == pytest.approx(1500 + 600 + 7)

    def test_old_version_is_kept(self, client, db):
        body = client.post(f"/budgets/{BUDGET}/actualizar-precios").json()
        versions = sorted(db.tables["budget_versions"], key=lambda v: v["version"])
        assert [v["version"] for v in versions] == [1, 2]
        assert body["version_anterior"]["version"] == 1
        assert body["version_nueva"]["version"] == 2

        old, new = (json.loads(v["data"]) for v in versions)
        assert versions[0]["precios_al"] == "2026-03-01"
        assert versions[1]["precios_al"] == "2026-09-30"
        assert "Antes de actualizar" in versions[0]["notas"]
        old_prices = {r["id"]: r["precio_unitario"] for r in old["resources"]}
        new_prices = {r["id"]: r["precio_unitario"] for r in new["resources"]}
        assert old_prices["r1"] == 1000
        assert new_prices["r1"] == 1500

    def test_second_update_keeps_numbering(self, client, db):
        client.post(f"/budgets/{BUDGET}/actualizar-precios")
        body = client.post(f"/budgets/{BUDGET}/actualizar-precios").json()
        assert body["version_nueva"]["version"] == 4

    def test_past_date(self, client, db):
        r = client.post(f"/budgets/{BUDGET}/actualizar-precios", json={"fecha": "2026-05-01"})
        assert r.status_code == 200, r.text
        assert res(db, "r1")["precio_unitario"] == 1000
        # MO-OF has no price before August
        assert res(db, "r2")["precio_unitario"] == 200
        assert budget(db)["precios_al"] == "2026-05-01"

    def test_future_date_rejected(self, client, db):
        before = copy.deepcopy(db.tables)
        r = client.post(f"/budgets/{BUDGET}/actualizar-precios", json={"fecha": "2027-01-01"})
        assert r.status_code == 422
        assert db.tables == before

    def test_unknown_budget(self, client, db):
        r = client.post("/budgets/00000000-0000-0000-0000-00000000dead/actualizar-precios")
        assert r.status_code == 404

    def test_uses_budget_indirects(self, client, db):
        budget(db)["indirectos"] = {**general_indirects({}), "beneficio_pct": 0}
        client.post(f"/budgets/{BUDGET}/actualizar-precios")
        assert db.tables["budget_items"][0]["beneficio_total"] == 0

    def test_list_versions_shows_date(self, client, db):
        client.post(f"/budgets/{BUDGET}/actualizar-precios")
        r = client.get(f"/budgets/{BUDGET}/versions")
        assert r.status_code == 200
        assert {v["precios_al"] for v in r.json()} == {"2026-03-01", "2026-09-30"}


# ── Fallos de escritura y paginación ────────────────────────────────────────


class FailingDB(FakeDB):
    """FakeDB whose writes fail for the chosen (table, id) pairs."""

    def __init__(self, tables, fail_update=(), fail_restore=False, empty_update=(),
                 fail_version_insert=(), fail_updates_after_version=None, **kw):
        super().__init__(tables, **kw)
        # Which budget_versions inserts fail: 1 = the first one, 2 = the second...
        self.fail_version_insert = set(fail_version_insert)
        self.version_inserts = 0
        # Every update fails once this many version inserts were tried (breaks the restore)
        self.fail_updates_after_version = fail_updates_after_version
        self.fail_update = set(fail_update)
        self.empty_update = set(empty_update)
        self.fail_restore = fail_restore
        self.failed_once = False

    def table(self, name):
        query = super().table(name)
        execute = query.execute

        def guarded():
            if query.action == "insert" and name == "budget_versions":
                self.version_inserts += 1
                if self.version_inserts in self.fail_version_insert:
                    raise RuntimeError("insert failed")
            if (
                query.action == "update"
                and self.fail_updates_after_version is not None
                and self.version_inserts >= self.fail_updates_after_version
            ):
                raise RuntimeError("write failed")
            if query.action == "update":
                ids = {v for c, v in query.filters if c == "id"}
                if any((name, i) in self.fail_update for i in ids):
                    if not self.failed_once or self.fail_restore:
                        self.failed_once = True
                        raise RuntimeError("write failed")
                if any((name, i) in self.empty_update for i in ids) and not self.failed_once:
                    # The row is gone: PostgREST answers OK with no rows
                    self.failed_once = True
                    return Resp([])
            return execute()

        query.execute = guarded
        return query


def _patched(fake):
    return (
        patch("app.routers.budgets.get_data_db", return_value=fake),
        patch("app.routers.analysis.get_data_db", return_value=fake),
        patch("app.routers.analysis.today", return_value=TODAY),
    )


class TestPriceUpdateFailure:
    def _run(self, client, fake):
        p1, p2, p3 = _patched(fake)
        with p1, p2, p3:
            return client.post(f"/budgets/{BUDGET}/actualizar-precios")

    def test_failed_write_leaves_budget_as_it_was(self, client):
        fake = FailingDB(tables(), fail_update={("item_resources", "r2")})
        before = copy.deepcopy(fake.tables)
        r = self._run(client, fake)
        assert r.status_code == 500
        assert "quedó como estaba" in r.json()["detail"]
        # r1 was written before r2 failed: it is back to the old price
        assert fake.tables["item_resources"] == before["item_resources"]
        assert fake.tables["budget_items"] == before["budget_items"]
        assert fake.tables["budgets"][0]["precios_al"] == "2026-03-01"
        # No version says the prices were updated
        assert fake.tables["budget_versions"] == []

    def test_failed_restore_keeps_old_values_in_a_version(self, client):
        fake = FailingDB(tables(), fail_update={("item_resources", "r2")}, fail_restore=True)
        r = self._run(client, fake)
        assert r.status_code == 500
        assert "v1" in r.json()["detail"]
        assert fake.tables["budgets"][0]["precios_al"] == "2026-03-01"
        [version] = fake.tables["budget_versions"]
        old = {x["id"]: x["precio_unitario"] for x in json.loads(version["data"])["resources"]}
        assert old["r1"] == 1000

    def test_update_that_matches_no_row_is_a_failure(self, client):
        fake = FailingDB(tables(), empty_update={("item_resources", "r3")})
        r = self._run(client, fake)
        assert r.status_code == 500
        assert fake.tables["budgets"][0]["precios_al"] == "2026-03-01"
        assert res(fake, "r1")["precio_unitario"] == 1000
        assert fake.tables["budget_versions"] == []


    def test_failed_before_version_changes_nothing(self, client):
        fake = FailingDB(tables(), fail_version_insert={1})
        before = copy.deepcopy(fake.tables)
        r = self._run(client, fake)
        assert r.status_code == 500
        assert fake.tables == before

    def test_failed_new_version_restores_budget(self, client):
        fake = FailingDB(tables(), fail_version_insert={2})
        before = copy.deepcopy(fake.tables)
        r = self._run(client, fake)
        assert r.status_code == 500
        assert "quedó como estaba" in r.json()["detail"]
        assert res(fake, "r1")["precio_unitario"] == 1000
        assert fake.tables["item_resources"] == before["item_resources"]
        assert fake.tables["budget_items"] == before["budget_items"]
        assert fake.tables["budgets"][0]["precios_al"] == "2026-03-01"
        assert fake.tables["budget_versions"] == []

    def test_failed_new_version_and_restore_keeps_before_version(self, client):
        fake = FailingDB(tables(), fail_version_insert={2}, fail_updates_after_version=2)
        r = self._run(client, fake)
        assert r.status_code == 500
        assert "v1" in r.json()["detail"]
        [version] = fake.tables["budget_versions"]
        old = {x["id"]: x["precio_unitario"] for x in json.loads(version["data"])["resources"]}
        assert old["r1"] == 1000


class TestPagination:
    """The API returns at most 1000 rows per request: every page must be read."""

    def test_more_rows_than_one_page(self, client):
        extra_entries = [
            {"id": f"e{i:05d}", "org_id": ORG, "tipo": "material", "codigo": f"X{i}",
             "precio_sin_iva": 1, "fecha_precio": "2026-01-01"}
            for i in range(1200)
        ]
        # c1's newest price sorts last by id, past the first page
        extra_history = [
            {"id": f"h{i:05d}", "entry_id": "c1", "org_id": ORG, "precio_sin_iva": 100 + i,
             "fecha_precio": "2026-02-01", "created_at": "2026-02-01"}
            for i in range(1500)
        ]
        t = tables()
        t["catalog_entries"] = extra_entries + t["catalog_entries"]
        t["catalog_price_history"] = extra_history + t["catalog_price_history"]
        t["catalog_price_history"].append(
            {"id": "z-last", "entry_id": "c1", "org_id": ORG, "precio_sin_iva": 1800,
             "fecha_precio": "2026-09-15", "created_at": "2026-09-15"}
        )
        fake = FakeDB(t, max_rows=1000)
        p1, p2, p3 = _patched(fake)
        with p1, p2, p3:
            r = client.post(f"/budgets/{BUDGET}/actualizar-precios")
        assert r.status_code == 200, r.text
        # MO-OF (entry after 1200 others) is found, and c1 takes its newest price
        assert res(fake, "r2")["precio_unitario"] == 300
        assert res(fake, "r1")["precio_unitario"] == 1800
        assert [p["codigo"] for p in r.json()["sin_precio"]] == ["XYZ"]

    def test_fetch_all_reads_until_a_short_page(self):
        from app.budget_prices import fetch_all
        fake = FakeDB({"t": [{"id": f"{i:03d}"} for i in range(7)]}, max_rows=3)
        rows = fetch_all(lambda: fake.table("t").select("*").order("id"), page_size=3)
        assert [r["id"] for r in rows] == [f"{i:03d}" for i in range(7)]
