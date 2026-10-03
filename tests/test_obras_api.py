"""Cargar una obra desde la app: /obras/analizar y /obras/cargar."""

from __future__ import annotations

import copy
import json
import os
from datetime import datetime
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


def _excel(wb=None) -> bytes:
    buf = BytesIO()
    (wb or _workbook()).save(buf)
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


def analizar(client, asignaciones=None, wb=None):
    data = {"asignaciones": json.dumps(asignaciones)} if asignaciones else {}
    return client.post("/obras/analizar", files={"file": ("obra.xlsx", _excel(wb), XLSX)}, data=data)


def cargar(client, nombre="OBRA PRUEBA", permitir=False, asignaciones=None, wb=None):
    data = {"nombre": nombre, "permitir_sin_precio": str(permitir).lower()}
    if asignaciones:
        data["asignaciones"] = json.dumps(asignaciones)
    return client.post("/obras/cargar", files={"file": ("obra.xlsx", _excel(wb), XLSX)}, data=data)


def _tareas(body) -> dict:
    return {t["clave"]: t for t in body["tareas"]}


ARISTAS = "ARISTAS DE YESO EN PAREDES | m"
TELGOPOR = "TELGOPOR 50 MM + CONTRAPISO EN AZOTEA ACCESIBLE E: 8CM | m2"
TENSORES = "TENSORES 20 CM X 40 CM. | m"
OBRADOR = "OBRADOR | gl"


def _fix_eps(db):
    next(e for e in db.tables["catalog_entries"] if e["codigo"] == "EPS-500")["precio_sin_iva"] = 10


class TestAnalizar:
    def test_contract(self, client, db):
        res = analizar(client)
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body) == {"archivo", "catalogo_oficial", "titulo", "fecha_precios", "resumen", "tareas",
                             "precios", "recetas", "correcciones_excel", "listo"}
        assert body["catalogo_oficial"] is False
        assert body["resumen"] == {
            "rubros": 3, "pisos": 3, "trabajos": 7, "grupos": 6,
            "verdes": 3, "amarillos": 2, "rojos": 1, "total_excel": 13850.0,
        }
        assert [t["estado"] for t in body["tareas"]] == ["rojo", "amarillo", "amarillo", "verde", "verde", "verde"]
        for t in body["tareas"]:
            assert set(t) == {"clave", "descripcion", "unidad", "veces", "cantidad_total", "total_excel", "codigos",
                              "estado", "motivo_rojo", "receta", "sugerencias", "pregunta", "avisos",
                              "precios_faltantes"}
        tareas = _tareas(body)

        telgopor = tareas[TELGOPOR]
        assert (telgopor["estado"], telgopor["motivo_rojo"]) == ("rojo", "precio")
        assert telgopor["precios_faltantes"] == ["EPS-500"]
        assert telgopor["receta"]["origen"] == "regla"
        assert telgopor["receta"]["porque"] == "Coincide la descripción"
        assert telgopor["receta"]["nombre"] == "Receta 8.3 + Receta 5.2.3"
        assert [p["factor"] for p in telgopor["receta"]["partes"]] == [1.0, 0.08]
        assert telgopor["pregunta"]["receta"] == "5.2.3"
        assert telgopor["pregunta"]["valor"] == 0.08
        assert set(telgopor["pregunta"]) == {"tipo", "texto", "receta", "unidad_receta", "unidad_obra", "valor",
                                             "dato"}
        # The rule already knows the conversion: shown as a fact, not as a question
        assert telgopor["pregunta"]["dato"] == 'Cada m² lleva 0,08 m³ de "Receta 5.2.3"'
        assert telgopor["avisos"] == ["Compuesto: placas EPS + contrapiso de cascote de 8 cm."]  # sin códigos

        tensores = tareas[TENSORES]
        assert tensores["estado"] == "verde"
        assert tensores["pregunta"]["texto"] == '¿Cuántos m³ de "Receta 4.1.7" lleva cada ml de este trabajo?'
        assert (tensores["pregunta"]["unidad_receta"], tensores["pregunta"]["unidad_obra"]) == ("m3", "ml")
        assert tensores["pregunta"]["dato"] == 'Cada ml lleva 0,08 m³ de "Receta 4.1.7"'

        assert len(body["precios"]) == 1
        for p in body["precios"]:
            assert set(p) == {"codigo", "descripcion", "unidad", "tipo", "problema", "motivo", "recursos", "items",
                              "entradas", "referencias", "propuesta", "catalogo_destino"}
            # Without an oficial catalog: no references, no destination; no Excel price to propose
            assert (p["referencias"], p["catalogo_destino"], p["propuesta"]) == ([], None, None)

        piso = next(t for t in body["tareas"] if t["descripcion"].startswith("COLOCACION DE REVESTIMIENTOS"))
        assert (piso["veces"], piso["cantidad_total"], piso["codigos"]) == (2, 40.0, ["4.2.4", "4.3.5"])
        assert piso["pregunta"] is None
        assert piso["avisos"] == ["No incluye el porcelanato: queda como material que compra el cliente."]

        obrador = tareas[OBRADOR]
        assert (obrador["estado"], obrador["receta"], obrador["motivo_rojo"]) == ("amarillo", None, None)

        assert {r["codigo"] for r in body["recetas"]} == set(TEMPLATES)
        assert body["recetas"][0] == {"codigo": "4.1.7", "nombre": "Receta 4.1.7", "unidad": "m3", "categoria": None}
        assert body["listo"] is False

    def test_summary_and_price_problems(self, client, db):
        body = analizar(client).json()
        precios = {p["codigo"]: p for p in body["precios"]}
        assert precios["EPS-500"]["problema"] == "sin_precio"
        assert precios["EPS-500"]["entradas"][0]["id"] == "e-EPS-500"
        assert "RP-PORC" not in precios  # lo compra el cliente
        assert db.tables["budgets"] == []  # analizar no escribe

        _fix_eps(db)
        body = analizar(client).json()
        assert body["resumen"]["rojos"] == 0
        assert body["listo"] is True

    def test_question_needs_the_value(self, client, db):
        body = analizar(client, {ARISTAS: {"plantillas": [["5.1.4", None]]}}).json()
        aristas = _tareas(body)[ARISTAS]
        assert (aristas["estado"], aristas["motivo_rojo"]) == ("rojo", "pregunta")
        assert aristas["pregunta"]["valor"] is None
        assert aristas["pregunta"]["dato"] is None
        assert aristas["pregunta"]["texto"] == '¿Cuántos m² de "Receta 5.1.4" lleva cada m de este trabajo?'
        assert aristas["receta"]["origen"] == "manual"

        body = analizar(client, {ARISTAS: {"plantillas": [["5.1.4", 2.5]]}}).json()
        aristas = _tareas(body)[ARISTAS]
        assert aristas["estado"] == "verde"
        assert aristas["pregunta"]["valor"] == 2.5
        assert aristas["pregunta"]["dato"] == 'Cada m lleva 2,5 m² de "Receta 5.1.4"'
        assert aristas["receta"]["partes"][0]["factor"] == 2.5
        assert aristas["receta"]["porque"] == "La elegiste vos"

    def test_confirmations(self, client, db):
        body = analizar(client, {
            OBRADOR: {"plantillas": [], "confirmada": True},
            # Confirming the rule keeps its conversion when the screen sends none
            TENSORES: {"plantillas": [["4.1.7", None]], "confirmada": True},
        }).json()
        tareas = _tareas(body)
        assert (tareas[OBRADOR]["estado"], tareas[OBRADOR]["receta"]) == ("verde", None)
        assert tareas[TENSORES]["estado"] == "verde"
        assert tareas[TENSORES]["receta"]["origen"] == "regla"
        assert tareas[TENSORES]["pregunta"]["valor"] == 0.08

    def test_suggestion_until_confirmed(self, client, db):
        db.tables["item_templates"].append({"id": "tmpl-6.9", "org_id": ORG, "codigo": "6.9", "unidad": "m",
                                            "nombre": "ARISTAS DE YESO", "parametros": [], "recursos": []})
        aristas = _tareas(analizar(client).json())[ARISTAS]
        assert aristas["estado"] == "amarillo"
        assert aristas["receta"]["codigo"] == "6.9"
        assert aristas["receta"]["origen"] == "sugerida"
        assert aristas["receta"]["porque"] == "Se parece por 'aristas', 'yeso'"
        assert all(s["codigo"] != "6.9" for s in aristas["sugerencias"])

        body = analizar(client, {ARISTAS: {"plantillas": [["6.9", 1]], "confirmada": True}}).json()
        aristas = _tareas(body)[ARISTAS]
        assert (aristas["estado"], aristas["receta"]["origen"]) == ("verde", "sugerida")

    def test_memory(self, client, db):
        db.tables["obra_recetas_memoria"] = [
            {"id": "m1", "org_id": ORG, "clave": ARISTAS, "plantillas": [["5.1.4", 2.0]], "veces": 1},
            {"id": "m2", "org_id": "otra-org", "clave": OBRADOR, "plantillas": [["5.1.4", 1.0]], "veces": 1},
        ]
        tareas = _tareas(analizar(client).json())
        assert tareas[ARISTAS]["estado"] == "verde"
        assert tareas[ARISTAS]["receta"]["origen"] == "memoria"
        assert tareas[ARISTAS]["receta"]["porque"] == "Ya la usaste así en otra obra"
        assert tareas[ARISTAS]["pregunta"]["valor"] == 2.0
        assert tareas[OBRADOR]["receta"] is None  # memory of another org

        # The screen's choice wins over memory
        tareas = _tareas(analizar(client, {ARISTAS: {"plantillas": []}}).json())
        assert tareas[ARISTAS]["receta"] is None

    def test_recipe_not_in_the_app(self, client, db):
        body = analizar(client, {ARISTAS: {"plantillas": [["9.9", 1], ["5.1.4", None]]}}).json()
        aristas = _tareas(body)[ARISTAS]
        assert (aristas["estado"], aristas["motivo_rojo"]) == ("rojo", "receta_inexistente")
        assert aristas["receta"]["partes"][0]["nombre"] is None
        assert body["listo"] is False

    def test_bad_choices(self, client, db):
        assert analizar(client, {ARISTAS: {"plantillas": "5.1.4"}}).status_code == 400
        res = client.post("/obras/analizar", files={"file": ("obra.xlsx", _excel(), XLSX)},
                          data={"asignaciones": "{no"})
        assert res.status_code == 400

    def test_duplicated_code(self, client, db):
        # LH18 exists dated (2026-01-01) in the fixture; a second one, undated, must not block
        db.tables["catalog_entries"].append(
            {"id": "e-dup", "catalog_id": "cat1", "org_id": ORG, "codigo": "lh18", "tipo": "material",
             "precio_sin_iva": 9, "fecha_precio": None})
        precios = {p["codigo"]: p for p in analizar(client).json()["precios"]}
        assert "LH18" not in precios
        # Two undated copies of the same code: nobody can tell which one is right
        for e in db.tables["catalog_entries"]:
            if e["codigo"] in ("LH18", "lh18"):
                e["fecha_precio"] = None
        precios = {p["codigo"]: p for p in analizar(client).json()["precios"]}
        assert precios["LH18"]["problema"] == "duplicado"
        assert len(precios["LH18"]["entradas"]) == 2

    def test_future_price_in_another_catalog_does_not_hide_the_one_in_force(self, client, db):
        """Codex: LH18 at 500 (2026-01-01, in force) and a copy at 900 dated in the future.
        The analysis must price LH18 at 500 today, not pick the future entry and go red."""
        db.tables["price_catalogs"].append({"id": "cat2", "org_id": ORG, "name": "Lista futura"})
        db.tables["catalog_entries"].append(
            {"id": "e-fut", "catalog_id": "cat2", "org_id": ORG, "codigo": "LH18", "tipo": "material",
             "precio_sin_iva": 900, "fecha_precio": "2099-01-01"})
        _fix_eps(db)
        body = analizar(client).json()
        assert all(p["codigo"] != "LH18" for p in body["precios"])
        assert cargar(client).status_code == 200
        lh18 = next(r for r in db.tables["item_resources"] if r["codigo"] == "LH18")
        assert lh18["precio_unitario"] == 500
        assert lh18["catalog_entry_id"] == "e-LH18"

    def test_rejects_other_files(self, client, db):
        res = client.post("/obras/analizar", files={"file": ("obra.csv", b"a,b", "text/csv")})
        assert res.status_code == 400


class TestCargar:
    def test_blocked_while_prices_missing(self, client, db):
        res = cargar(client)
        assert res.status_code == 409
        detail = res.json()["detail"]
        assert detail["rojos"] == [TELGOPOR]
        assert "EPS-500" in json.dumps(detail["precios"])
        assert detail["mensaje"] == "Falta 1 precio: corregilo antes de cargar, o cargá igual con ese precio en $0"
        assert db.tables["budgets"] == []

    def test_blocked_without_conversion(self, client, db):
        _fix_eps(db)
        res = cargar(client, permitir=True, asignaciones={ARISTAS: {"plantillas": [["5.1.4", None]]}})
        assert res.status_code == 409
        assert res.json()["detail"]["rojos"] == [ARISTAS]
        assert res.json()["detail"]["mensaje"] == "Hay 1 trabajo en rojo: resolvelo antes de cargar"
        assert db.tables["budgets"] == []

    def test_blocked_with_missing_recipe(self, client, db):
        res = cargar(client, permitir=True, asignaciones={ARISTAS: {"plantillas": [["9.9", 1]]}})
        assert res.status_code == 409
        assert res.json()["detail"]["rojos"] == [ARISTAS]

    def test_saves_memory(self, client, db):
        _fix_eps(db)
        elegidas = {ARISTAS: {"plantillas": [["5.1.4", 2.5]], "confirmada": True},
                    OBRADOR: {"plantillas": [], "confirmada": True}}
        res = cargar(client, asignaciones=elegidas)
        assert res.status_code == 200, res.text
        assert res.json()["memoria_guardada"] == 2
        memoria = {m["clave"]: m for m in db.tables["obra_recetas_memoria"]}
        assert memoria[ARISTAS]["plantillas"] == [["5.1.4", 2.5]]
        assert memoria[ARISTAS]["org_id"] == ORG
        assert (memoria[OBRADOR]["plantillas"], memoria[OBRADOR]["veces"]) == ([], 1)
        aristas = next(i for i in db.tables["budget_items"] if i["code"] == "4.2.2")
        assert aristas["template_id"] == "tmpl-5.1.4"

        # Same task again: one row per (org, clave), updated
        elegidas[ARISTAS]["plantillas"] = [["5.1.4", 3]]
        assert cargar(client, nombre="OTRA", asignaciones=elegidas).json()["memoria_guardada"] == 2
        memoria = [m for m in db.tables["obra_recetas_memoria"] if m["clave"] == ARISTAS]
        assert len(memoria) == 1
        assert (memoria[0]["plantillas"], memoria[0]["veces"]) == ([["5.1.4", 3.0]], 2)

        # Next obra: proposed from memory
        aristas = _tareas(analizar(client).json())[ARISTAS]
        assert (aristas["receta"]["origen"], aristas["estado"]) == ("memoria", "verde")

    def test_combined_recipes_keep_their_waste(self, client, db):
        """Codex: in a combined item each resource inherits the waste of ITS recipe, also
        after the cascade; and a waste set later on the budget wins for all of them."""
        _fix_eps(db)
        waste = {"tmpl-8.3": 10, "tmpl-5.2.3": 25}
        for t in db.tables["item_templates"]:
            t["desperdicio_pct"] = waste.get(t["id"], t["desperdicio_pct"])
        assert cargar(client).status_code == 200
        item = next(i for i in db.tables["budget_items"] if i["code"] == "4.2.3")
        assert item["template_id"] == "tmpl-8.3"

        def res():
            return {r["codigo"]: r for r in db.tables["item_resources"] if r["item_id"] == item["id"]}

        assert (res()["EPS-500"]["template_id"], res()["ES"]["template_id"]) == ("tmpl-8.3", "tmpl-5.2.3")
        assert (res()["EPS-500"]["desperdicio_pct"], res()["EPS-500"]["desperdicio_origen"]) == (10, "plantilla")
        assert (res()["ES"]["desperdicio_pct"], res()["ES"]["desperdicio_origen"]) == (25, "plantilla")
        assert res()["ES"]["cantidad_efectiva"] == pytest.approx(res()["ES"]["cantidad"] * 1.25, rel=1e-3)

        # "Recalcular obra" keeps each recipe's %
        budget_id = db.tables["budgets"][0]["id"]
        assert client.post(f"/budgets/{budget_id}/cascade-recalculate").status_code == 200
        assert (res()["EPS-500"]["desperdicio_pct"], res()["ES"]["desperdicio_pct"]) == (10, 25)

        # A waste set on the budget wins over both recipes (presupuesto > receta > organización)
        db.tables["budgets"][0]["desperdicio_pct"] = 7
        assert client.post(f"/budgets/{budget_id}/cascade-recalculate").status_code == 200
        assert (res()["EPS-500"]["desperdicio_pct"], res()["EPS-500"]["desperdicio_origen"]) == (7, "presupuesto")
        assert (res()["ES"]["desperdicio_pct"], res()["ES"]["desperdicio_origen"]) == (7, "presupuesto")

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


# ── Precios que el Excel ya trae y catálogo oficial ──────────────────────────


def _excel_with_prices():
    """The obra's Excel plus a detail sheet where Sol typed the prices the catalog lacks."""
    from tests.test_obra_import import _detail_sheet

    wb = _workbook()
    _detail_sheet(wb, "4.9-2", "4.9-2", "TELGOPOR 50 mm + CONTRAPISO EN AZOTEA ACCESIBLE e: 8cm", [
        ("MATERIALES", [("EPS-500", "Placa EPS 30 mm", "u", 10000), ("H30", "Hormigón H30", "m3", 90000)]),
    ])
    mat = wb.create_sheet("00_Mat")
    mat.append(["CODIGO", "MATERIALES", "UNIDAD", "PRECIO CON IVA", "PRECIO SIN IVA"])
    mat.append(["EPS-500", "Placa EPS", "u", None, 8000, "ML", datetime(2026, 9, 17)])
    return wb


def _drop_entry(db, codigo):
    db.tables["catalog_entries"] = [e for e in db.tables["catalog_entries"] if e["codigo"] != codigo]


def _consulta(db, rows, catalog=("cat-lh", "Las Heras", "2025-01-01")):
    """A reference catalog (old obra) with [(id, codigo, tipo, precio, fecha)]."""
    cid, name, created = catalog
    if not any(c["id"] == cid for c in db.tables["price_catalogs"]):
        db.tables["price_catalogs"].append({"id": cid, "org_id": ORG, "name": name, "created_at": created,
                                            "oficial": False})
    for eid, codigo, tipo, precio, fecha in rows:
        db.tables["catalog_entries"].append({"id": eid, "catalog_id": cid, "org_id": ORG, "codigo": codigo,
                                             "descripcion": f"{codigo} viejo", "unidad": "u", "tipo": tipo,
                                             "precio_sin_iva": precio, "fecha_precio": fecha})


def _oficial(db, cid="cat1"):
    for c in db.tables["price_catalogs"]:
        c.setdefault("oficial", False)
        if c["id"] == cid:
            c["oficial"] = True


class TestPreciosDelExcel:
    def test_proposal_for_missing_and_priceless_codes(self, client, db):
        _drop_entry(db, "H30")
        precios = {p["codigo"]: p for p in analizar(client, wb=_excel_with_prices()).json()["precios"]}
        eps, h30 = precios["EPS-500"], precios["H30"]
        assert (eps["problema"], h30["problema"]) == ("sin_precio", "no_esta")
        assert h30["motivo"] == "No está en el catálogo"
        # The detail sheet wins over the 00_Mat list, which stays as "otro"
        assert eps["propuesta"] == {
            "codigo": "EPS-500", "descripcion": "Placa EPS 30 mm", "unidad": "u", "tipo": "material",
            "precio": 10000.0, "fecha": None, "proveedor": None, "nota": None, "origen": "detalle", "hoja": "4.9-2",
            "trabajo": "TELGOPOR 50 mm + CONTRAPISO EN AZOTEA ACCESIBLE e: 8cm",
            "otros": [{"precio": 8000.0, "hoja": "00_Mat"}],
        }
        assert h30["propuesta"]["precio"] == 90000.0
        assert eps["referencias"] == [] and h30["catalogo_destino"] is None  # no oficial catalog

    def test_no_proposal_for_a_repeated_code(self, client, db):
        for e in db.tables["catalog_entries"]:
            if e["codigo"] == "EPS-500":
                e["fecha_precio"] = None
        db.tables["catalog_entries"].append({"id": "e-dup", "catalog_id": "cat1", "org_id": ORG,
                                             "codigo": "EPS-500", "tipo": "material", "precio_sin_iva": 0,
                                             "fecha_precio": None})
        precios = {p["codigo"]: p for p in analizar(client, wb=_excel_with_prices()).json()["precios"]}
        assert precios["EPS-500"]["problema"] == "duplicado"
        assert precios["EPS-500"]["propuesta"] is None

    def test_blocked_load_also_proposes(self, client, db):
        res = cargar(client, wb=_excel_with_prices())
        assert res.status_code == 409
        assert res.json()["detail"]["precios"][0]["propuesta"]["precio"] == 10000.0


class TestCatalogoOficial:
    def test_references_only_with_an_oficial_catalog(self, client, db):
        _consulta(db, [("lh-eps", "EPS-500", "material", 6592, "2026-03-12")])
        body = analizar(client).json()
        assert body["catalogo_oficial"] is False
        # Without oficial every catalog prices: the Las Heras copy has a price and is used
        assert body["precios"] == []

        _oficial(db)
        body = analizar(client).json()
        assert body["catalogo_oficial"] is True
        eps = {p["codigo"]: p for p in body["precios"]}["EPS-500"]
        assert eps["problema"] == "sin_precio"
        assert [e["id"] for e in eps["entradas"]] == ["e-EPS-500"]  # only the oficial entry
        assert eps["referencias"] == [{
            "id": "lh-eps", "catalog_id": "cat-lh", "catalogo": "Las Heras", "codigo": "EPS-500",
            "descripcion": "EPS-500 viejo", "unidad": "u", "tipo": "material", "precio_sin_iva": 6592,
            "fecha_precio": "2026-03-12",
        }]

    def test_references_newest_first_at_most_five(self, client, db):
        _oficial(db)
        _consulta(db, [
            ("r-old", "EPS-500", "material", 1, "2024-01-01"),
            ("r-none", "EPS-500", "material", 2, None),
            ("r-new", "EPS-500", "material", 3, "2026-05-01"),
            ("r-zero", "EPS-500", "material", 0, "2026-09-01"),  # no price: not a reference
            ("r-mid", "EPS-500", "material", 4, "2025-06-01"),
            ("r-mid2", "eps-500", "material", 5, "2025-01-01"),
            ("r-mid3", "EPS-500", "material", 6, "2024-06-01"),
        ])
        eps = {p["codigo"]: p for p in analizar(client).json()["precios"]}["EPS-500"]
        assert [r["id"] for r in eps["referencias"]] == ["r-new", "r-mid", "r-mid2", "r-mid3", "r-old"]

    def test_code_only_in_a_reference_catalog_is_missing(self, client, db):
        """With an oficial catalog, the old catalogs do not price, even when the code is only there."""
        _drop_entry(db, "H30")
        _consulta(db, [("lh-h30", "H30", "material", 95000, "2026-02-01")])
        _oficial(db)
        db.tables["price_catalogs"].append({"id": "cat-mo", "org_id": ORG, "name": "Maestro - Mano de obra",
                                            "created_at": "2026-09-01", "oficial": True})
        db.tables["catalog_entries"].append({"id": "e-mo2", "catalog_id": "cat-mo", "org_id": ORG,
                                             "codigo": "MO-AY", "tipo": "mano_obra", "precio_sin_iva": 80,
                                             "fecha_precio": "2026-01-01"})
        h30 = {p["codigo"]: p for p in analizar(client, wb=_excel_with_prices()).json()["precios"]}["H30"]
        assert (h30["problema"], h30["motivo"]) == ("no_esta", "No está en el catálogo oficial")
        assert h30["entradas"] == []
        assert [r["id"] for r in h30["referencias"]] == ["lh-h30"]
        assert h30["propuesta"]["precio"] == 90000.0
        # Created where most materials are (cat1), not in the newer oficial catalog of labor
        assert h30["catalogo_destino"] == {"id": "cat1", "name": "Maestro TERRAC - Materiales"}

    def test_destination_tie_goes_to_the_newest_oficial(self, client, db):
        _drop_entry(db, "H30")
        _oficial(db)
        db.tables["price_catalogs"][0]["created_at"] = "2026-01-01"
        db.tables["price_catalogs"].append({"id": "cat-new", "org_id": ORG, "name": "Maestro nuevo",
                                            "created_at": "2026-09-01", "oficial": True})
        for e in db.tables["catalog_entries"]:
            if e["tipo"] == "material":
                e["catalog_id"] = "cat-new" if e["codigo"] in ("LH18", "HADN6", "ES", "RP-KP") else "cat1"
        # 4 materials each: cat-new LH18, HADN6, ES, RP-KP; cat1 EPS-500, RP-PORC and these two
        db.tables["catalog_entries"] += [
            {"id": f"x{i}", "catalog_id": "cat1", "org_id": ORG, "codigo": f"X{i}", "tipo": "material",
             "precio_sin_iva": 1, "fecha_precio": "2026-01-01"} for i in range(2)
        ]
        h30 = {p["codigo"]: p for p in analizar(client).json()["precios"]}["H30"]
        assert h30["catalogo_destino"] == {"id": "cat-new", "name": "Maestro nuevo"}

    def test_load_uses_only_oficial_prices(self, client, db):
        _fix_eps(db)
        _consulta(db, [("lh-lh18", "LH18", "material", 900, "2026-09-01")])  # newer, but only a reference
        _oficial(db)
        assert cargar(client).status_code == 200
        lh18 = next(r for r in db.tables["item_resources"] if r["codigo"] == "LH18")
        assert (lh18["precio_unitario"], lh18["catalog_entry_id"]) == (500, "e-LH18")

    def test_update_prices_relinks_a_reference_entry_by_code(self, client, db):
        """A resource linked to an entry of a reference catalog takes the oficial one by code."""
        _fix_eps(db)
        assert cargar(client).status_code == 200
        _consulta(db, [("lh-lh18", "LH18", "material", 900, "2026-01-01")])
        lh18 = next(r for r in db.tables["item_resources"] if r["codigo"] == "LH18")
        lh18["catalog_entry_id"], lh18["precio_unitario"] = "lh-lh18", 900
        _oficial(db)
        budget_id = db.tables["budgets"][0]["id"]
        res = client.post(f"/budgets/{budget_id}/actualizar-precios")
        assert res.status_code == 200, res.text
        lh18 = next(r for r in db.tables["item_resources"] if r["id"] == lh18["id"])
        assert (lh18["precio_unitario"], lh18["catalog_entry_id"]) == (500, "e-LH18")


# ── Diferencias con el Excel ─────────────────────────────────────────────────

BUDGET_ID = "00000000-0000-0000-0000-0000000000d1"


def _item(id_, code, desc, unidad, cantidad, parent=None, neto=0.0, excel=None, directo=0.0, excel_dir=None,
          template=None, seccion=False, sort=0):
    return {"id": id_, "budget_id": BUDGET_ID, "org_id": ORG, "code": code, "description": desc,
            "unidad": unidad, "cantidad": cantidad, "parent_id": parent, "neto_total": neto,
            "excel_neto": excel, "directo_total": directo, "excel_directo": excel_dir, "template_id": template,
            "notas": "Seccion" if seccion else "Receta del Maestro", "sort_order": sort}


def _budget_with_excel(db):
    db.tables["budgets"].append({"id": BUDGET_ID, "org_id": ORG, "name": "EDIFICIO GINKGO",
                                 "precios_al": "2026-10-03", "source_file": "ginkgo.xlsx"})
    db.tables["budget_items"] += [
        _item("s4", "4", "ALBAÑILERIA", None, None, seccion=True, sort=0),
        _item("i-obr", "1.1", "OBRADOR", "gl", 1, parent="s4", neto=1000, excel=1500, directo=800,
              excel_dir=1200, sort=1),
        _item("p1", "4.2", "PRIMER PISO", None, None, parent="s4", seccion=True, sort=2),
        # Listed out of order on purpose: items come by sort_order
        _item("i-m2", "4.3.1", "MURO HUECO 18", "m2", 50, parent="p2", neto=600, excel=500, directo=450,
              excel_dir=400, template="tmpl-5.1.4", sort=6),
        _item("i-m1", "4.2.1", "MURO HUECO 18", "m²", 100, parent="p1", neto=1200, excel=1000, directo=900,
              excel_dir=800, template="tmpl-5.1.4", sort=3),
        _item("i-lim", "4.2.2", "LIMPIEZA", "gl", 1, parent="p1", neto=1030, excel=1000, sort=4),
        _item("p2", "4.3", "SEGUNDO PISO", None, None, parent="s4", seccion=True, sort=5),
        _item("i-ay", "4.3.2", "AYUDA DE GREMIOS", "gl", 1, parent="p2", neto=50, excel=0, sort=7),
        _item("i-cero", "4.3.3", "CERO", "gl", 0, parent="p2", neto=0, excel=0, sort=8),
        _item("i-viejo", "4.3.4", "AGREGADO A MANO", "gl", 1, parent="p2", neto=999, excel=None, sort=9),
    ]


def diferencias(client, budget_id=BUDGET_ID):
    return client.get(f"/obras/{budget_id}/diferencias")


class TestDiferencias:
    def test_saves_the_excel_totals_when_loading(self, client, db):
        _fix_eps(db)
        assert cargar(client).status_code == 200
        items = {i["code"]: i for i in db.tables["budget_items"]}
        assert (items["4.2.1"]["excel_directo"], items["4.2.1"]["excel_neto"]) == (9000, 12000)
        assert (items["1.1"]["excel_directo"], items["1.1"]["excel_neto"]) == (1000, 1500)
        assert (items["4"]["excel_neto"], items["4.2"]["excel_directo"]) == (None, None)  # rubros y pisos

        body = diferencias(client, items["4.2.1"]["budget_id"]).json()
        assert body["total"]["excel_neto"] == 13850.0
        piso = next(t for t in body["trabajos"] if t["descripcion"].startswith("COLOCACION DE REVESTIMIENTOS"))
        assert [(i["code"], i["piso"]) for i in piso["items"]] == [("4.2.4", "PRIMER PISO"), ("4.3.5", "SEGUNDO PISO")]

    def test_compares_task_by_task(self, client, db):
        _budget_with_excel(db)
        res = diferencias(client)
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body) == {"budget_id", "nombre", "precios_al", "source_file", "total", "resumen", "trabajos"}
        assert (body["budget_id"], body["nombre"], body["precios_al"], body["source_file"]) == (
            BUDGET_ID, "EDIFICIO GINKGO", "2026-10-03", "ginkgo.xlsx")
        # The hand-added item without Excel totals is left out
        assert body["total"] == {"app_neto": 3880.0, "excel_neto": 4000.0, "diferencia": -120.0,
                                 "diferencia_pct": -3.0, "app_directo": 2150.0, "excel_directo": 2400.0}
        assert body["resumen"] == {"trabajos": 5, "mas_caros": 2, "mas_baratos": 1, "parecidos": 2,
                                   "sin_receta": 4}
        # Biggest difference first (in absolute value)
        assert [t["descripcion"] for t in body["trabajos"]] == [
            "OBRADOR", "MURO HUECO 18", "AYUDA DE GREMIOS", "LIMPIEZA", "CERO"]

        muro = body["trabajos"][1]
        assert set(muro) == {"clave", "descripcion", "unidad", "veces", "cantidad_total", "receta", "sin_receta",
                             "app_neto", "excel_neto", "diferencia", "diferencia_pct", "app_directo",
                             "excel_directo", "app_unitario", "excel_unitario", "items"}
        assert muro["clave"] == "MURO HUECO 18 | m2"  # m² and m2 are the same task
        assert (muro["veces"], muro["cantidad_total"]) == (2, 150.0)
        assert (muro["receta"], muro["sin_receta"]) == ({"codigo": "5.1.4", "nombre": "Receta 5.1.4"}, False)
        assert (muro["app_neto"], muro["excel_neto"], muro["diferencia"], muro["diferencia_pct"]) == (
            1800.0, 1500.0, 300.0, 20.0)
        assert (muro["app_directo"], muro["excel_directo"]) == (1350.0, 1200.0)
        assert (muro["app_unitario"], muro["excel_unitario"]) == (12.0, 10.0)
        assert muro["items"] == [
            {"id": "i-m1", "code": "4.2.1", "piso": "PRIMER PISO", "cantidad": 100.0, "app_neto": 1200.0,
             "excel_neto": 1000.0, "diferencia": 200.0},
            {"id": "i-m2", "code": "4.3.1", "piso": "SEGUNDO PISO", "cantidad": 50.0, "app_neto": 600.0,
             "excel_neto": 500.0, "diferencia": 100.0},
        ]

        obrador, ayuda, cero = body["trabajos"][0], body["trabajos"][2], body["trabajos"][4]
        assert (obrador["receta"], obrador["sin_receta"], obrador["diferencia_pct"]) == (None, True, -33.3)
        assert obrador["items"][0]["piso"] == "ALBAÑILERIA"  # its direct parent
        assert (ayuda["diferencia"], ayuda["diferencia_pct"]) == (50.0, None)  # the Excel said 0
        assert (cero["app_unitario"], cero["excel_unitario"], cero["diferencia_pct"]) == (None, None, None)

    def test_budget_loaded_before_saving_the_excel_totals(self, client, db):
        _budget_with_excel(db)
        for i in db.tables["budget_items"]:
            i.pop("excel_neto")
        res = diferencias(client)
        assert res.status_code == 409
        assert res.json()["detail"] == (
            'Este presupuesto no tiene guardados los totales del Excel. Cargá la obra de nuevo desde '
            '"Cargar obra" para poder compararla.')

    def test_budget_of_another_org(self, client, db):
        _budget_with_excel(db)
        db.tables["budgets"][-1]["org_id"] = "otra-org"
        assert diferencias(client).status_code == 404
        assert diferencias(client, "00000000-0000-0000-0000-00000000dead").status_code == 404
