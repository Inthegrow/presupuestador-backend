"""Subir una lista de precios en .csv (POST /catalogs/upload-csv): separador, encabezados, precios y respuesta."""

from __future__ import annotations

import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routers import catalogs as cat
from tests.test_recipes_api import MOCK_USER, ORG, FakeDB


@pytest.fixture
def db():
    return FakeDB({"price_catalogs": [], "catalog_entries": [], "catalog_price_history": []})


@pytest.fixture
def client(db):
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    with patch("app.routers.catalogs.get_data_db", return_value=db):
        yield TestClient(app)


def subir(client, texto: str | bytes, archivo: str = "lista.csv", url: str = "/catalogs/upload-csv?tipo=material",
          data: dict | None = None):
    contenido = texto.encode("utf-8") if isinstance(texto, str) else texto
    return client.post(url, files={"file": (archivo, contenido, "text/csv")}, data=data or {})


def entradas(db) -> dict[str, dict]:
    return {e["codigo"]: e for e in db.tables["catalog_entries"]}


class TestSeparadorYEncabezados:
    def test_punto_y_coma_con_tildes(self, client, db):
        csv = ("Código;Descripción;Unidad;Precio sin IVA;Fecha;Proveedor\n"
               "CEM;Cemento 50 kg;bolsa;$ 1.234,50;03/06/2026;Easy\n"
               "ARE;Arena gruesa;m3;5000;;\n")
        r = subir(client, csv)
        assert r.status_code == 200, r.text
        e = entradas(db)
        assert e["CEM"]["precio_sin_iva"] == 1234.5 and e["CEM"]["descripcion"] == "Cemento 50 kg"
        assert e["CEM"]["unidad"] == "bolsa" and e["CEM"]["fecha_precio"] == "2026-06-03"
        assert e["CEM"]["proveedor"] == "Easy" and e["CEM"]["tipo"] == "material"
        assert e["ARE"]["precio_sin_iva"] == 5000 and e["ARE"]["proveedor"] is None

    def test_excel_en_castellano_latin1_y_sep(self, client, db):
        csv = "sep=;\r\nCODIGO;DESCRIPCION;U;PRECIO\r\nLAD;Ladrillo común;u;1.234\r\n;;;\r\n".encode("cp1252")
        r = subir(client, csv)
        assert r.status_code == 200, r.text
        assert entradas(db)["LAD"]["precio_sin_iva"] == 1234
        assert entradas(db)["LAD"]["descripcion"] == "Ladrillo común"
        assert r.json()["salteadas"] == 0  # the empty ";;;" row is not a row

    def test_tabulador(self, client, db):
        r = subir(client, "cod\tdetalle\tunid\tprecio unitario\nCAL\tCal hidratada\tbolsa\t1234.5\n")
        assert r.status_code == 200, r.text
        e = entradas(db)["CAL"]
        assert e["precio_sin_iva"] == 1234.5 and e["descripcion"] == "Cal hidratada" and e["unidad"] == "bolsa"

    def test_coma_con_precio_entre_comillas(self, client, db):
        r = subir(client, 'codigo,descripcion,unidad,precio\nH30,"Hormigón H30, elaborado",m3,"169.000,00"\n')
        assert r.status_code == 200, r.text
        e = entradas(db)["H30"]
        assert e["precio_sin_iva"] == 169000 and e["descripcion"] == "Hormigón H30, elaborado"

    def test_solo_codigo_y_precio(self, client, db):
        r = subir(client, "codigo;precio\nX1;10\n")
        assert r.status_code == 200, r.text
        assert entradas(db)["X1"]["descripcion"] == "" and entradas(db)["X1"]["unidad"] == ""

    def test_fuente_importado_de(self, client, db):
        subir(client, "codigo;precio\nX1;10\n", archivo="lista octubre.csv")
        assert entradas(db)["X1"]["fuente"] == "Importado de lista octubre.csv"
        assert db.tables["catalog_price_history"][0]["fuente"] == "Importado de lista octubre.csv"


class TestTipoYNombre:
    def test_en_el_formulario(self, client, db):
        r = subir(client, "codigo;precio\nMO1;25000\n", url="/catalogs/upload-csv",
                  data={"tipo": "mano_obra", "name": "Jornales octubre"})
        assert r.status_code == 200, r.text
        assert r.json()["tipo"] == "mano_obra" and r.json()["name"] == "Jornales octubre"
        assert db.tables["price_catalogs"][0]["name"] == "Jornales octubre"
        assert entradas(db)["MO1"]["tipo"] == "mano_obra"

    def test_nombre_en_el_formulario(self, client, db):
        r = subir(client, "codigo;precio\nE1;100\n", url="/catalogs/upload-csv",
                  data={"tipo": "equipo", "nombre": "Alquileres"})
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Alquileres" and r.json()["tipo"] == "equipo"

    def test_en_la_url(self, client, db):
        r = subir(client, "codigo;precio\nS1;100\n", url="/catalogs/upload-csv?tipo=subcontrato&name=Subs")
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Subs" and r.json()["tipo"] == "subcontrato"

    def test_sin_nombre_va_el_del_archivo(self, client, db):
        r = subir(client, "codigo;precio\nX1;10\n", archivo="Corralón octubre.csv",
                  url="/catalogs/upload-csv", data={"tipo": "material", "name": "  "})
        assert r.json()["name"] == "Corralón octubre"

    def test_tipo_en_palabras(self, client, db):
        r = subir(client, "codigo;precio\nMO1;1\n", url="/catalogs/upload-csv", data={"tipo": "Mano de obra"})
        assert r.status_code == 200 and r.json()["tipo"] == "mano_obra"

    @pytest.mark.parametrize("url, data", [("/catalogs/upload-csv", {}), ("/catalogs/upload-csv?tipo=otra", {}),
                                           ("/catalogs/upload-csv", {"tipo": "cualquiera"})])
    def test_sin_tipo_o_tipo_raro(self, client, db, url, data):
        r = subir(client, "codigo;precio\nX1;10\n", url=url, data=data)
        assert r.status_code == 422
        assert r.json()["detail"] == "Elegí el tipo de la lista: material, mano de obra, equipo o subcontrato."
        assert db.tables["price_catalogs"] == []


class TestRespuesta:
    def test_forma(self, client, db):
        r = subir(client, "codigo;descripcion;precio\nA;Uno;10\n;Sin código;5\nB;Sin precio;\nC;Raro;abc\nD;Dos;20\n")
        assert r.status_code == 200, r.text
        body = r.json()
        cat_id = db.tables["price_catalogs"][0]["id"]
        assert body["id"] == body["catalog_id"] == body["catalogo"]["id"] == cat_id
        assert body["catalogo"]["org_id"] == ORG and body["catalogo"]["oficial"] is False
        assert body["catalogo"]["source_file"] == "lista.csv" and body["name"] == "lista"
        assert body["entradas"] == body["entries_count"] == 2
        assert body["salteadas"] == 3
        assert body["warnings"] == [
            "2 renglones sin código o sin precio, no se cargaron (renglones 3 y 4).",
            "1 renglón con un precio que no se entiende, no se cargó (renglón 5: «abc»).",
        ]
        assert sorted(entradas(db)) == ["A", "D"]

    def test_fecha_no_reconocida_queda_en_warnings(self, client, db):
        r = subir(client, "codigo;precio;fecha\nA;10;cualquiera\n")
        assert r.json()["warnings"] == ["Fila 2: fecha 'cualquiera' no reconocida, quedó sin fecha"]
        assert r.json()["salteadas"] == 0

    def test_ningun_renglon_valido(self, client, db):
        r = subir(client, "codigo;precio\n;10\nB;\n")
        assert r.status_code == 400
        assert r.json()["detail"].startswith("El archivo .csv no tiene renglones para cargar (con código y precio).")
        assert "2 renglones sin código o sin precio" in r.json()["detail"]
        assert db.tables["price_catalogs"] == []


    def test_agrupaciones_invalidas_se_saltean_y_se_explican(self, client, db):
        """Codex PR #48: '1,2,3' and '1.234.56' were saved as 123 and 123456 with no warning."""
        r = subir(client, "codigo;precio\nA;1,2,3\nB;1.234.56\nC;1.23,4.5\nD;1.234,50\n")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["entradas"] == 1 and body["salteadas"] == 3
        assert set(entradas(db)) == {"D"} and entradas(db)["D"]["precio_sin_iva"] == pytest.approx(1234.5)
        assert any("precio que no se entiende" in w and "1,2,3" in w for w in body["warnings"]), body["warnings"]

    def test_solo_precios_mal_escritos_da_400_sin_crear_la_lista(self, client, db):
        r = subir(client, "codigo;precio\nA;1,2,3\nB;1.234.56\n")
        assert r.status_code == 400
        assert "precio que no se entiende" in r.json()["detail"]
        assert db.tables["price_catalogs"] == [] and db.tables["catalog_entries"] == []


class TestFaltanColumnas:
    def test_falta_el_precio(self, client, db):
        r = subir(client, "Código;Descripción;Unidad\nA;Uno;u\n")
        assert r.status_code == 400
        assert r.json()["detail"] == ("Al archivo le falta la columna del precio (precio_unitario o precio). "
                                      "Tiene: código, descripción, unidad.")
        assert db.tables["price_catalogs"] == []

    def test_falta_el_codigo(self, client, db):
        r = subir(client, "Material,Importe\nCemento,10\n")
        assert r.json()["detail"] == ("Al archivo le faltan la columna del código (código o cod) y la del precio "
                                      "(precio_unitario o precio). Tiene: Material, Importe.")

    def test_solo_falta_el_codigo(self, client, db):
        r = subir(client, "descripcion;precio\nCemento;10\n")
        assert r.json()["detail"] == ("Al archivo le falta la columna del código (código o cod). "
                                      "Tiene: descripción, precio.")

    def test_vacio(self, client, db):
        r = subir(client, "\n\n")
        assert r.status_code == 400 and r.json()["detail"].startswith("El archivo está vacío")

    def test_excel_en_vez_de_csv(self, client, db):
        r = subir(client, b"PK\x03\x04resto", archivo="lista.csv")
        assert r.status_code == 400 and "es un Excel" in r.json()["detail"]
        r = subir(client, "x", archivo="lista.xlsx")
        assert r.status_code == 400 and "es un Excel" in r.json()["detail"]


class TestPiezas:
    @pytest.mark.parametrize("raw, valor", [
        ("$ 1.234,50", 1234.5), ("1.234,50", 1234.5), ("1234,5", 1234.5), ("1234.5", 1234.5), ("1.234", 1234),
        ("12.345", 12345), ("1.234.567", 1234567), ("1,234.50", 1234.5), ("$1234", 1234), ("  5000 ", 5000),
        ("6669.42", 6669.42), ("0.125", 0.125), ("12345.678", 12345.678), ("$ 1.000", 1000), ("ARS 10", 10),
        ("169000", 169000), ("0", 0), ("1,234,567", 1234567), ("0,5", 0.5), ("012.345", 12.345),
    ])
    def test_leer_precio(self, raw, valor):
        assert cat.leer_precio(raw) == pytest.approx(valor)

    # Codex PR #48: thousands groups that are not well formed are not prices (they used to become 123, 123456)
    @pytest.mark.parametrize("raw", ["", "$", "abc", "1,2,x", "nan", "inf", "1,2,3", "1.234.56", "1.23,4.5",
                                     "1,234.5.6", "12.34.567", "1,23,456", "1.2345,6", "--5"])
    def test_precio_ilegible(self, raw):
        assert cat.leer_precio(raw) is None

    @pytest.mark.parametrize("texto, sep", [
        ("a;b;c\n1;2,5;3\n", ";"), ("a,b,c\n1,2,3\n", ","), ("a\tb\n1\t2\n", "\t"),
        ("codigo;precio\nCEM;$ 1.234,50\n", ";"), ("codigo;precio\n", ";"), ("solo\n", ","),
    ])
    def test_detectar_separador(self, texto, sep):
        assert cat.detectar_separador(texto) == sep

    @pytest.mark.parametrize("raw, norm", [
        ("Código", "codigo"), (" Precio sin IVA ", "precio_sin_iva"), ("precio-unitario", "precio_unitario"),
        ("﻿COD.", "cod"), ("Descripción", "descripcion"),
    ])
    def test_normalizar_encabezado(self, raw, norm):
        assert cat.normalizar_encabezado(raw) == norm

    def test_alias_preferido(self):
        assert cat.columnas_csv(["precio", "Precio unitario", "codigo"]) == {"precio": 1, "codigo": 2}


def test_windows_1252_con_comillas_curvas(client, db):
    r = subir(client, "codigo;descripcion;precio\nP1;Pintura “látex” 20 l;10\n".encode("cp1252"))
    assert r.status_code == 200, r.text
    assert entradas(db)["P1"]["descripcion"] == "Pintura “látex” 20 l"
