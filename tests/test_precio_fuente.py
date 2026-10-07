"""Cada precio dice de dónde salió: fuente y fuente_url en la lista y en el historial (migración 012)."""

from __future__ import annotations

import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.test_recipes_api import MOCK_USER, ORG, FakeDB, Query

CAT = "00000000-0000-0000-0000-0000000000c1"
ENTRY = "00000000-0000-0000-0000-0000000000e1"
URL = "https://www.easy.com.ar/cemento"


def tables() -> dict:
    return {
        "price_catalogs": [{"id": CAT, "org_id": ORG, "name": "Maestro", "oficial": True}],
        "catalog_entries": [{"id": ENTRY, "org_id": ORG, "catalog_id": CAT, "codigo": "CEM", "tipo": "material",
                             "descripcion": "Cemento", "unidad": "bolsa", "precio_sin_iva": 9000,
                             "fecha_precio": "2026-01-10", "proveedor": "X"}],
        "catalog_price_history": [],
    }


class SinColumnaQuery(Query):
    """Like PostgREST before migration 012: writing fuente/fuente_url fails."""

    def execute(self):
        rows = self.payload if isinstance(self.payload, list) else [self.payload or {}]
        if self.action in ("insert", "update") and any("fuente" in r or "fuente_url" in r for r in rows):
            raise RuntimeError("{'code': 'PGRST204', 'message': \"Could not find the 'fuente' column of "
                               "'catalog_entries' in the schema cache\"}")
        return super().execute()


class SinColumnaDB(FakeDB):
    def table(self, name):
        return SinColumnaQuery(self, name)


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture
def db():
    fake = FakeDB(tables())
    with patch("app.routers.catalogs.get_data_db", return_value=fake):
        yield fake


def entry(db, eid=ENTRY):
    return next(e for e in db.tables["catalog_entries"] if e["id"] == eid)


class TestCrear:
    def test_a_mano_por_defecto(self, client, db):
        r = client.post(f"/catalogs/{CAT}/entries", json={"codigo": "ARE", "precio_sin_iva": 100})
        assert r.status_code == 200, r.text
        assert r.json()["fuente"] == "Cargado a mano" and r.json()["fuente_url"] is None
        [hist] = db.tables["catalog_price_history"]
        assert hist["fuente"] == "Cargado a mano"

    def test_desde_internet(self, client, db):
        r = client.post(f"/catalogs/{CAT}/entries", json={
            "codigo": "CEM2", "precio_sin_iva": 10000, "proveedor": "Easy",
            "fuente": "Internet: Easy · Cemento Loma Negra 50 kg", "fuente_url": URL})
        body = r.json()
        assert body["fuente"] == "Internet: Easy · Cemento Loma Negra 50 kg" and body["fuente_url"] == URL
        assert db.tables["catalog_price_history"][0]["fuente_url"] == URL

    @pytest.mark.parametrize("data, texto", [
        ({"fuente_url": "javascript:alert(1)"}, "http"),
        ({"fuente_url": "https://x.com/" + "a" * 600}, "500"),
        ({"fuente": 3}, "texto"),
    ])
    def test_invalido_400(self, client, db, data, texto):
        r = client.post(f"/catalogs/{CAT}/entries", json={"codigo": "X", "precio_sin_iva": 1, **data})
        assert r.status_code == 400 and texto in r.json()["detail"]

    def test_sin_migracion_se_ignora(self, client):
        fake = SinColumnaDB(tables())
        with patch("app.routers.catalogs.get_data_db", return_value=fake):
            r = client.post(f"/catalogs/{CAT}/entries", json={"codigo": "ARE", "precio_sin_iva": 100,
                                                              "fuente_url": URL})
        assert r.status_code == 200, r.text
        assert r.json()["fuente"] is None
        assert "fuente" not in fake.tables["catalog_entries"][-1]
        assert len(fake.tables["catalog_price_history"]) == 1


class TestEditar:
    def test_guarda_el_origen_y_va_al_historial(self, client, db):
        r = client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={
            "precio_sin_iva": 10000, "fecha_precio": "2026-10-07", "proveedor": "Easy",
            "fuente": "Internet: Easy · Cemento", "fuente_url": URL})
        assert r.status_code == 200, r.text
        e = entry(db)
        assert e["fuente"] == "Internet: Easy · Cemento" and e["fuente_url"] == URL and e["proveedor"] == "Easy"
        [hist] = db.tables["catalog_price_history"]
        assert hist["precio_sin_iva"] == 10000 and hist["fuente_url"] == URL

    def test_precio_a_mano_cambia_el_origen(self, client, db):
        entry(db).update(fuente="Internet: Easy", fuente_url=URL)
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 9500})
        assert entry(db)["fuente"] == "Cargado a mano" and entry(db)["fuente_url"] is None

    def test_sin_cambio_de_precio_no_toca_el_origen(self, client, db):
        entry(db).update(fuente="Internet: Easy", fuente_url=URL)
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"proveedor": "Otro"})
        assert entry(db)["fuente"] == "Internet: Easy"

    def test_sin_migracion_se_ignora(self, client):
        fake = SinColumnaDB(tables())
        with patch("app.routers.catalogs.get_data_db", return_value=fake):
            r = client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 9500, "fuente_url": URL})
        assert r.status_code == 200, r.text
        assert fake.tables["catalog_entries"][0]["precio_sin_iva"] == 9500


class TestLeer:
    def test_lista_e_historial_traen_el_origen(self, client, db):
        [e] = client.get(f"/catalogs/{CAT}/entries").json()
        assert e["fuente"] is None and e["fuente_url"] is None  # old prices: no origin, nothing invented
        db.tables["catalog_price_history"].append({"id": "h1", "entry_id": ENTRY, "org_id": ORG,
                                                    "precio_sin_iva": 9000, "created_at": "2026-01-10"})
        [h] = client.get(f"/catalogs/{CAT}/entries/{ENTRY}/history").json()
        assert h["fuente"] is None and "fuente_url" in h


class TestImportar:
    def test_csv_importado_de(self, client, db):
        csv = "codigo,descripcion,unidad,precio_unitario\nARE,Arena,m3,5000\n"
        r = client.post("/catalogs/upload-csv?tipo=material",
                        files={"file": ("lista octubre.csv", csv.encode(), "text/csv")})
        assert r.status_code == 200, r.text
        nueva = next(e for e in db.tables["catalog_entries"] if e["codigo"] == "ARE")
        assert nueva["fuente"] == "Importado de lista octubre.csv"
        assert db.tables["catalog_price_history"][0]["fuente"] == "Importado de lista octubre.csv"


class TestPrecioConIva:
    """Cuando cambia el precio sin IVA, el precio con IVA viejo sigue la misma proporción (o queda vacío)."""

    def test_misma_proporcion(self, client, db):
        entry(db).update(precio_sin_iva=10000, precio_con_iva=12100)
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 20000})
        assert entry(db)["precio_con_iva"] == 24200

    def test_sin_con_iva_queda_sin(self, client, db):
        entry(db).update(precio_con_iva=None)
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 20000})
        assert entry(db)["precio_con_iva"] is None

    def test_sin_iva_viejo_en_cero_queda_vacio(self, client, db):
        entry(db).update(precio_sin_iva=0, precio_con_iva=5000)
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 20000})
        assert entry(db)["precio_con_iva"] is None

    def test_mismo_precio_no_lo_toca(self, client, db):
        entry(db).update(precio_sin_iva=10000, precio_con_iva=12345)
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 10000, "proveedor": "Otro"})
        assert entry(db)["precio_con_iva"] == 12345


class TestHistorialProveedor:
    def test_proveedor_solo_del_valor_actual(self, client, db):
        db.tables["catalog_price_history"] += [
            {"id": "h1", "entry_id": ENTRY, "org_id": ORG, "precio_sin_iva": 8000, "fecha_precio": "2025-12-01",
             "created_at": "2025-12-01"},
            {"id": "h2", "entry_id": ENTRY, "org_id": ORG, "precio_sin_iva": 9000, "fecha_precio": "2026-01-10",
             "created_at": "2026-01-10"},
            {"id": "h3", "entry_id": ENTRY, "org_id": ORG, "precio_sin_iva": 7000, "fecha_precio": "2025-06-01",
             "created_at": "2025-06-01", "proveedor": "Guardado"},
        ]
        hist = {h["id"]: h for h in client.get(f"/catalogs/{CAT}/entries/{ENTRY}/history").json()}
        assert hist["h2"]["proveedor"] == "X"      # the value the entry has now: its provider
        assert hist["h1"]["proveedor"] is None     # an older value: unknown, not invented
        assert hist["h3"]["proveedor"] == "Guardado"


class SinColumnaHistorialQuery(Query):
    """Before migration 012: the history has no fuente/fuente_url/proveedor columns."""

    def execute(self):
        rows = self.payload if isinstance(self.payload, list) else [self.payload or {}]
        if self.name == "catalog_price_history" and self.action == "insert" and any(
                "proveedor" in r or "fuente" in r for r in rows):
            raise RuntimeError("{'code': 'PGRST204', 'message': \"Could not find the 'proveedor' column of "
                               "'catalog_price_history' in the schema cache\"}")
        return super().execute()


class SinColumnaHistorialDB(FakeDB):
    def table(self, name):
        return SinColumnaHistorialQuery(self, name)


class TestHistorialGuardaProveedor:
    def test_crear_y_editar_lo_guardan(self, client, db):
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 9500, "proveedor": "Easy"})
        r = client.post(f"/catalogs/{CAT}/entries", json={"codigo": "ARE", "precio_sin_iva": 100, "proveedor": "EVER"})
        assert r.status_code == 200
        provs = {h["entry_id"]: h["proveedor"] for h in db.tables["catalog_price_history"]}
        assert provs[ENTRY] == "Easy" and provs[r.json()["id"]] == "EVER"

    def test_get_usa_el_de_la_fila(self, client, db):
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 9500, "proveedor": "Easy"})
        client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 9800, "proveedor": "Sodimac"})
        hist = client.get(f"/catalogs/{CAT}/entries/{ENTRY}/history").json()
        assert sorted(h["proveedor"] for h in hist) == ["Easy", "Sodimac"]

    def test_sin_migracion_se_guarda_sin_proveedor(self, client):
        fake = SinColumnaHistorialDB(tables())
        with patch("app.routers.catalogs.get_data_db", return_value=fake):
            r = client.patch(f"/catalogs/{CAT}/entries/{ENTRY}", json={"precio_sin_iva": 9500, "proveedor": "Easy"})
        assert r.status_code == 200, r.text
        [hist] = fake.tables["catalog_price_history"]
        assert hist["precio_sin_iva"] == 9500 and "proveedor" not in hist and "fuente" not in hist
