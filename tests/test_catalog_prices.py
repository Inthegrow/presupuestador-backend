"""Tests for dated catalog prices and price history (Fase 1)."""

from __future__ import annotations

import os
from datetime import date, datetime
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.catalog_prices import (
    fecha_iso,
    history_row,
    normalize_codigo,
    parse_fecha,
    price_changed,
    price_from_payload,
)
from app.main import create_app

MOCK_USER = {"user_id": "test-user-uuid", "org_id": "test-org-uuid"}
CATALOG = "00000000-0000-0000-0000-00000000000c"
ENTRY = "00000000-0000-0000-0000-00000000000e"


# ── Helpers ────────────────────────────────────────────────────────────────


class TestNormalizeCodigo:
    def test_upper_and_spaces(self):
        assert normalize_codigo("  a-ny200100m2 ") == "A-NY200100M2"
        assert normalize_codigo("SILL-  pe") == "SILL- PE"
        assert normalize_codigo("disco\tporc") == "DISCO PORC"

    def test_empty(self):
        assert normalize_codigo(None) == ""
        assert normalize_codigo("   ") == ""


class TestParseFecha:
    def test_datetime_and_date(self):
        assert parse_fecha(datetime(2026, 6, 3, 10, 30)) == date(2026, 6, 3)
        assert parse_fecha(date(2026, 6, 3)) == date(2026, 6, 3)

    @pytest.mark.parametrize("text", ["2026-06-03", "03/06/2026", "03/06/26", "03-06-2026", "2026-06-03T00:00:00"])
    def test_strings(self, text):
        assert parse_fecha(text) == date(2026, 6, 3)

    def test_empty_is_none(self):
        assert parse_fecha(None) is None
        assert parse_fecha("  ") is None

    def test_garbage_raises(self):
        with pytest.raises(ValueError):
            parse_fecha("rinde 0,5lts/m2")

    def test_fecha_iso(self):
        assert fecha_iso("03/06/2026") == "2026-06-03"
        assert fecha_iso(None) is None


class TestPriceHelpers:
    def test_price_from_payload(self):
        assert price_from_payload({"precio_sin_iva": 10}) == 10
        assert price_from_payload({"precio_unitario": "12.5"}) == 12.5
        assert price_from_payload({"precio_sin_iva": 0}) == 0
        assert price_from_payload({}) is None
        assert price_from_payload({"precio_sin_iva": ""}) is None

    def test_price_changed(self):
        old = {"precio_sin_iva": 100, "fecha_precio": "2026-01-01"}
        assert not price_changed(old, {"descripcion": "x"})
        assert not price_changed(old, {"precio_sin_iva": 100.0})
        assert price_changed(old, {"precio_sin_iva": 120})
        assert price_changed(old, {"fecha_precio": "2026-02-01"})
        assert price_changed({"precio_sin_iva": None}, {"precio_sin_iva": 0})

    def test_history_row(self):
        row = history_row({"id": "e1", "org_id": "o1", "precio_sin_iva": 5, "fecha_precio": "2026-06-03", "codigo": "X"})
        assert row == {"entry_id": "e1", "org_id": "o1", "precio_sin_iva": 5, "fecha_precio": "2026-06-03"}


# ── API ────────────────────────────────────────────────────────────────────


class Resp:
    def __init__(self, data):
        self.data = data


class RecordingTable:
    """Chainable table mock that records inserts and updates in the parent DB."""

    def __init__(self, db, name):
        self.db, self.name = db, name
        self._data = list(db.tables.get(name, []))

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def order(self, *a, **k): return self
    def ilike(self, *a, **k): return self
    def single(self, *a, **k):
        self._single = True
        return self

    def insert(self, data, **k):
        rows = data if isinstance(data, list) else [data]
        self.db.inserts.setdefault(self.name, []).extend(rows)
        self._data = [{**r, "id": r.get("id", f"new-{i}")} for i, r in enumerate(rows)]
        return self

    def update(self, data, **k):
        self.db.updates.setdefault(self.name, []).append(data)
        self._data = [{**self._data[0], **data}] if self._data else []
        return self

    def delete(self, **k): return self

    def execute(self):
        if getattr(self, "_single", False):
            return Resp(self._data[0] if self._data else None)
        return Resp(self._data)


class RecordingDB:
    def __init__(self, tables=None):
        self.tables = tables or {}
        self.inserts: dict[str, list] = {}
        self.updates: dict[str, list] = {}

    def table(self, name):
        return RecordingTable(self, name)


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


def _db_with_entry(**entry):
    base = {"id": ENTRY, "org_id": "test-org-uuid", "precio_sin_iva": 100, "fecha_precio": "2026-01-01"}
    return RecordingDB({
        "price_catalogs": [{"id": CATALOG}],
        "catalog_entries": [{**base, **entry}],
    })


class TestCreateEntry:
    @patch("app.routers.catalogs.get_data_db")
    def test_saves_date_and_history(self, mock_db, client):
        db = RecordingDB({"price_catalogs": [{"id": CATALOG}]})
        mock_db.return_value = db
        r = client.post(f"/catalogs/{CATALOG}/entries", json={
            "codigo": "H30", "descripcion": "Hormigon", "precio_sin_iva": 169000,
            "fecha_precio": "2026-06-03", "proveedor": "HBA",
        })
        assert r.status_code == 200
        entry = db.inserts["catalog_entries"][0]
        assert entry["fecha_precio"] == "2026-06-03"
        assert entry["proveedor"] == "HBA"
        hist = db.inserts["catalog_price_history"][0]
        assert hist["precio_sin_iva"] == 169000
        assert hist["fecha_precio"] == "2026-06-03"

    @patch("app.routers.catalogs.get_data_db")
    def test_defaults_to_today_and_accepts_precio_unitario(self, mock_db, client):
        db = RecordingDB({"price_catalogs": [{"id": CATALOG}]})
        mock_db.return_value = db
        r = client.post(f"/catalogs/{CATALOG}/entries", json={"descripcion": "X", "precio_unitario": 50})
        assert r.status_code == 200
        entry = db.inserts["catalog_entries"][0]
        assert entry["precio_sin_iva"] == 50
        assert entry["fecha_precio"] == date.today().isoformat()

    @patch("app.routers.catalogs.get_data_db")
    def test_bad_date_is_400(self, mock_db, client):
        mock_db.return_value = RecordingDB({"price_catalogs": [{"id": CATALOG}]})
        r = client.post(f"/catalogs/{CATALOG}/entries", json={"descripcion": "X", "fecha_precio": "ayer"})
        assert r.status_code == 400


class TestUpdateEntry:
    @patch("app.routers.catalogs.get_data_db")
    def test_price_change_dates_today_and_records_history(self, mock_db, client):
        db = _db_with_entry()
        mock_db.return_value = db
        r = client.patch(f"/catalogs/{CATALOG}/entries/{ENTRY}", json={"precio_sin_iva": 120})
        assert r.status_code == 200
        update = db.updates["catalog_entries"][0]
        assert update["precio_sin_iva"] == 120
        assert update["fecha_precio"] == date.today().isoformat()
        hist = db.inserts["catalog_price_history"]
        assert len(hist) == 1
        assert hist[0]["entry_id"] == ENTRY
        assert hist[0]["precio_sin_iva"] == 120

    @patch("app.routers.catalogs.get_data_db")
    def test_explicit_date_is_kept(self, mock_db, client):
        db = _db_with_entry()
        mock_db.return_value = db
        r = client.patch(f"/catalogs/{CATALOG}/entries/{ENTRY}", json={
            "precio_sin_iva": 120, "fecha_precio": "2026-05-01",
        })
        assert r.status_code == 200
        assert db.updates["catalog_entries"][0]["fecha_precio"] == "2026-05-01"
        assert db.inserts["catalog_price_history"][0]["fecha_precio"] == "2026-05-01"

    @patch("app.routers.catalogs.get_data_db")
    def test_date_only_change_records_history(self, mock_db, client):
        db = _db_with_entry()
        mock_db.return_value = db
        r = client.patch(f"/catalogs/{CATALOG}/entries/{ENTRY}", json={"fecha_precio": "2026-02-01"})
        assert r.status_code == 200
        assert db.inserts["catalog_price_history"][0]["fecha_precio"] == "2026-02-01"
        assert db.inserts["catalog_price_history"][0]["precio_sin_iva"] == 100

    @patch("app.routers.catalogs.get_data_db")
    def test_same_price_no_history(self, mock_db, client):
        db = _db_with_entry()
        mock_db.return_value = db
        r = client.patch(f"/catalogs/{CATALOG}/entries/{ENTRY}", json={
            "descripcion": "Nuevo nombre", "precio_sin_iva": 100,
        })
        assert r.status_code == 200
        assert "catalog_price_history" not in db.inserts
        assert "fecha_precio" not in db.updates["catalog_entries"][0]

    @patch("app.routers.catalogs.get_data_db")
    def test_precio_unitario_alias_is_saved(self, mock_db, client):
        # The Catalogs page used to send precio_unitario, which was silently ignored
        db = _db_with_entry()
        mock_db.return_value = db
        r = client.patch(f"/catalogs/{CATALOG}/entries/{ENTRY}", json={"precio_unitario": 130})
        assert r.status_code == 200
        assert db.updates["catalog_entries"][0]["precio_sin_iva"] == 130


class TestHistoryEndpoint:
    @patch("app.routers.catalogs.get_data_db")
    def test_list_history(self, mock_db, client):
        db = RecordingDB({
            "catalog_entries": [{"id": ENTRY}],
            "catalog_price_history": [
                {"entry_id": ENTRY, "precio_sin_iva": 120, "fecha_precio": "2026-06-01"},
                {"entry_id": ENTRY, "precio_sin_iva": 100, "fecha_precio": "2026-01-01"},
            ],
        })
        mock_db.return_value = db
        r = client.get(f"/catalogs/{CATALOG}/entries/{ENTRY}/history")
        assert r.status_code == 200
        assert [h["precio_sin_iva"] for h in r.json()] == [120, 100]


class TestUploadCsvDates:
    @patch("app.routers.catalogs.get_data_db")
    def test_csv_with_fecha_and_proveedor(self, mock_db, client):
        db = RecordingDB({"price_catalogs": [{"id": CATALOG}]})
        mock_db.return_value = db
        csv = (
            "codigo,descripcion,unidad,precio_unitario,fecha,proveedor\n"
            "H30,Hormigon,m3,169000,03/06/2026,HBA\n"
            "CEM,Cemento,u,6669.42,,\n"
            "CAL,Cal,u,5371.9,cualquiera,\n"
        )
        r = client.post(
            "/catalogs/upload-csv?tipo=material",
            files={"file": ("lista.csv", csv.encode(), "text/csv")},
        )
        assert r.status_code == 200
        entries = db.inserts["catalog_entries"]
        assert entries[0]["fecha_precio"] == "2026-06-03"
        assert entries[0]["proveedor"] == "HBA"
        assert entries[1]["fecha_precio"] is None
        assert entries[2]["fecha_precio"] is None
        assert len(r.json()["warnings"]) == 1
        assert len(db.inserts["catalog_price_history"]) == 3


# ── Catálogo oficial ─────────────────────────────────────────────────────────


class TestCatalogOficial:
    def _db(self):
        from tests.test_recipes_api import FakeDB

        return FakeDB({"price_catalogs": [
            {"id": CATALOG, "org_id": "test-org-uuid", "name": "Maestro", "oficial": False},
            {"id": ENTRY, "org_id": "otra-org", "name": "Ajeno", "oficial": False},
        ]})

    @patch("app.routers.catalogs.get_data_db")
    def test_mark_and_unmark(self, mock_db, client):
        db = mock_db.return_value = self._db()
        r = client.patch(f"/catalogs/{CATALOG}", json={"oficial": True})
        assert r.status_code == 200, r.text
        assert r.json() == {"id": CATALOG, "org_id": "test-org-uuid", "name": "Maestro", "oficial": True}
        assert db.tables["price_catalogs"][0]["oficial"] is True
        r = client.patch(f"/catalogs/{CATALOG}", json={"oficial": False})
        assert r.json()["oficial"] is False
        assert db.tables["price_catalogs"][1]["oficial"] is False  # the other org's is untouched

    @patch("app.routers.catalogs.get_data_db")
    def test_catalog_of_another_org(self, mock_db, client):
        db = mock_db.return_value = self._db()
        assert client.patch(f"/catalogs/{ENTRY}", json={"oficial": True}).status_code == 404
        assert db.tables["price_catalogs"][1]["oficial"] is False

    @patch("app.routers.catalogs.get_data_db")
    @pytest.mark.parametrize("body", [{"oficial": "si"}, {"oficial": 1}, {"oficial": None}, {"name": "x"}])
    def test_oficial_must_be_true_or_false(self, mock_db, client, body):
        db = mock_db.return_value = self._db()
        r = client.patch(f"/catalogs/{CATALOG}", json=body)
        assert r.status_code == 400
        assert r.json()["detail"] == "Indicá si el catálogo es oficial: true o false"
        assert db.tables["price_catalogs"][0] == {"id": CATALOG, "org_id": "test-org-uuid", "name": "Maestro",
                                                  "oficial": False}
