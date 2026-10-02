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
        assert set(body) == {"archivo", "titulo", "fecha_precios", "resumen", "tareas", "precios", "recetas",
                             "correcciones_excel", "listo"}
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
        assert telgopor["avisos"] == ["Compuesto: placas EPS + contrapiso de cascote de 8 cm."]  # sin códigos

        tensores = tareas[TENSORES]
        assert tensores["estado"] == "verde"
        assert tensores["pregunta"]["texto"] == '¿Cuántos m³ de "Receta 4.1.7" lleva cada ml de este trabajo?'
        assert (tensores["pregunta"]["unidad_receta"], tensores["pregunta"]["unidad_obra"]) == ("m3", "ml")

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
        assert aristas["pregunta"]["texto"] == '¿Cuántos m² de "Receta 5.1.4" lleva cada m de este trabajo?'
        assert aristas["receta"]["origen"] == "manual"

        body = analizar(client, {ARISTAS: {"plantillas": [["5.1.4", 2.5]]}}).json()
        aristas = _tareas(body)[ARISTAS]
        assert aristas["estado"] == "verde"
        assert aristas["pregunta"]["valor"] == 2.5
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
