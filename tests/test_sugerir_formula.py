"""GET /templates/sugerir: el "Quizás sea:" de la ventana de fórmulas del detalle de un trabajo."""

from __future__ import annotations

import copy
import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.obra_import import task_key
from tests.test_obra_import import TEMPLATES
from tests.test_recipes_api import MOCK_USER, ORG, FakeDB

OTRA = "otra-org-uuid"

# The test Maestro of Cargar obra (tests/test_obras_api.py) with names like the real ones
NOMBRES = {
    "5.1.4": ("LADRILLO CERAMICO HUECO DEL 18", "Mampostería"),
    "4.1.7": ("HORMIGON DE TENSORES", "Hormigones"),
    "8.3": ("AISLACION TERMICA CON PLACAS EPS", "Aislaciones"),
    "5.2.3": ("CONTRAPISO DE CASCOTE", "Contrapisos"),
    "7.1.1": ("REVESTIMIENTO PORCELANATO EN PISOS", "Revestimientos"),
}


def _templates(org: str = ORG, prefijo: str = "tmpl") -> list[dict]:
    return [
        {**copy.deepcopy(t), "id": f"{prefijo}-{c}", "org_id": org, "nombre": NOMBRES[c][0],
         "categoria": NOMBRES[c][1], "desperdicio_pct": None}
        for c, t in TEMPLATES.items()
    ]


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture
def db():
    fake = FakeDB({"item_templates": _templates(), "obra_recetas_memoria": []})
    with patch("app.routers.templates.get_data_db", return_value=fake):
        yield fake


def sugerir(client, descripcion, unidad="m2"):
    res = client.get("/templates/sugerir", params={"descripcion": descripcion, "unidad": unidad})
    assert res.status_code == 200, res.text
    return res.json()


PROPUESTA = {"id", "codigo", "nombre", "unidad", "categoria", "origen", "porque", "factor"}
PARECIDA = {"id", "codigo", "nombre", "unidad", "categoria", "porque", "puntaje"}


class TestSugerir:
    def test_rule_proposes_its_recipe(self, client, db):
        body = sugerir(client, "Muro ladrillo hueco del 18")
        assert set(body) == {"propuesta", "parecidas"}
        assert body["propuesta"] == {
            "id": "tmpl-5.1.4", "codigo": "5.1.4", "nombre": "LADRILLO CERAMICO HUECO DEL 18",
            "unidad": "m2", "categoria": "Mampostería", "origen": "regla",
            "porque": "Coincide la descripción", "factor": 1.0,
        }
        assert all(set(p) == PARECIDA for p in body["parecidas"])
        assert "5.1.4" not in [p["codigo"] for p in body["parecidas"]]  # the proposal is not repeated

    def test_rule_with_a_default_thickness_brings_its_factor(self, client, db):
        body = sugerir(client, "Contrapiso")
        assert (body["propuesta"]["codigo"], body["propuesta"]["origen"]) == ("5.2.3", "regla")
        assert body["propuesta"]["factor"] == pytest.approx(0.10)
        assert body["parecidas"] == []  # no other recipe shares a word

    def test_thickness_in_the_name_and_unknown_unit(self, client, db):
        assert sugerir(client, "Contrapiso e=8cm")["propuesta"]["factor"] == pytest.approx(0.08)
        # The rule was written for m²: in another unit Cargar obra has no conversion
        assert sugerir(client, "Contrapiso", "m3")["propuesta"]["factor"] is None

    def test_memory_wins_over_the_rule(self, client, db):
        db.tables["obra_recetas_memoria"] = [
            {"id": 1, "org_id": ORG, "clave": task_key("Muro ladrillo hueco del 18", "m²"),
             "plantillas": [["7.1.1", 2.5]], "veces": 1},
        ]
        body = sugerir(client, "MURO LADRILLO HUECO DEL 18", "M2")
        assert body["propuesta"] == {
            "id": "tmpl-7.1.1", "codigo": "7.1.1", "nombre": "REVESTIMIENTO PORCELANATO EN PISOS",
            "unidad": "m2", "categoria": "Revestimientos", "origen": "memoria",
            "porque": "Ya la usaste así en otra obra", "factor": 2.5,
        }
        # The rule's recipe is still offered by its words
        assert body["parecidas"][0]["codigo"] == "5.1.4"

    def test_memory_without_factor(self, client, db):
        db.tables["obra_recetas_memoria"] = [
            {"id": 1, "org_id": ORG, "clave": task_key("Aristas de yeso", "m"),
             "plantillas": [["5.1.4", None]], "veces": 1},
        ]
        propuesta = sugerir(client, "Aristas de yeso", "m")["propuesta"]
        assert (propuesta["codigo"], propuesta["origen"], propuesta["factor"]) == ("5.1.4", "memoria", None)

    def test_no_rule_gives_similar_recipes_by_words(self, client, db):
        body = sugerir(client, "Revestimiento texturado raro")
        assert body["propuesta"] is None
        assert [p["codigo"] for p in body["parecidas"]] == ["7.1.1"]
        parecida = body["parecidas"][0]
        assert set(parecida) == PARECIDA
        assert parecida["id"] == "tmpl-7.1.1"
        assert parecida["porque"] == "Se parece por 'revestimiento'"
        assert 0 < parecida["puntaje"] <= 0.5

    def test_at_most_three_similar_best_first(self, client, db):
        db.tables["item_templates"] += [
            {"id": f"x-{i}", "org_id": ORG, "codigo": f"9.{i}", "nombre": f"PINTURA LATEX {n}",
             "unidad": "m2", "categoria": "Pinturas", "recursos": [], "parametros": []}
            for i, n in enumerate(["INTERIOR", "EXTERIOR", "CIELORRASO", "INTERIOR ANTIHONGOS"])
        ]
        body = sugerir(client, "Pintura latex interior")
        assert body["propuesta"] is None
        assert len(body["parecidas"]) == 3
        assert body["parecidas"][0]["codigo"] == "9.0"
        puntajes = [p["puntaje"] for p in body["parecidas"]]
        assert puntajes == sorted(puntajes, reverse=True)

    def test_rule_with_several_recipes_has_no_proposal(self, client, db):
        body = sugerir(client, "Telgopor 50 mm + contrapiso en azotea")
        assert body["propuesta"] is None
        porque = "Cargar obra usa Aislacion termica con placas eps + Contrapiso de cascote para este trabajo"
        assert [(p["codigo"], p["porque"]) for p in body["parecidas"][:2]] == [
            ("8.3", porque), ("5.2.3", porque),
        ]
        assert len({p["codigo"] for p in body["parecidas"]}) == len(body["parecidas"])

    @pytest.mark.parametrize("descripcion", ["", "   "])
    def test_empty_description(self, client, db, descripcion):
        assert sugerir(client, descripcion) == {"propuesta": None, "parecidas": []}

    def test_without_parameters(self, client, db):
        res = client.get("/templates/sugerir")
        assert res.status_code == 200
        assert res.json() == {"propuesta": None, "parecidas": []}

    def test_is_not_taken_as_a_template_id(self, client, db):
        # /templates/{template_id} is declared after: "sugerir" never reaches it (404)
        assert client.get("/templates/sugerir", params={"descripcion": "Contrapiso"}).status_code == 200

    def test_other_company_recipes_and_memory_are_not_seen(self, client, db):
        db.tables["item_templates"] = _templates(OTRA, "ajena")
        db.tables["obra_recetas_memoria"] = [
            {"id": 1, "org_id": OTRA, "clave": task_key("Revestimiento texturado raro", "m2"),
             "plantillas": [["7.1.1", 1.0]], "veces": 3},
        ]
        assert sugerir(client, "Muro ladrillo hueco del 18") == {"propuesta": None, "parecidas": []}
        assert sugerir(client, "Revestimiento texturado raro") == {"propuesta": None, "parecidas": []}

    def test_own_recipes_with_another_company_alongside(self, client, db):
        db.tables["item_templates"] += _templates(OTRA, "ajena")
        body = sugerir(client, "Muro ladrillo hueco del 18")
        assert body["propuesta"]["id"] == "tmpl-5.1.4"
        assert all(p["id"].startswith("tmpl-") for p in body["parecidas"])
