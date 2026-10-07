"""Buscador de precios en internet (app/price_search.py, POST /precios/buscar), con un OpenAI falso (sin red)."""

from __future__ import annotations

import asyncio
import json
import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app import price_search as ps
from app.main import create_app
from tests.test_recipes_api import MOCK_USER

EASY = "https://www.easy.com.ar/cemento-loma-negra-50kg/p"
SODIMAC = "https://www.sodimac.com.ar/sodimac-ar/product/123/cemento"


def opcion(**over) -> dict:
    base = {"comercio": "Easy", "producto": "Cemento Loma Negra 50 kg", "presentacion": "Bolsa de 50 kg",
            "precio": 12100, "con_iva": True, "moneda": "ARS", "unidad_publicada": "bolsa",
            "cantidad_unidades_app": 1, "cuenta": "La app pide bolsa", "url": EASY}
    return {**base, **over}


def respuesta(opciones: list[dict], citas: list[str] = (), fuentes: list[str] = (), aviso=None,
              texto: str | None = None) -> dict:
    """A Responses API answer: one web search call with its sources and the message with citations."""
    return {"output": [
        {"type": "web_search_call", "id": "ws_1", "status": "completed",
         "action": {"type": "search", "query": "cemento", "sources": [{"type": "url", "url": u} for u in fuentes]}},
        {"type": "message", "role": "assistant", "content": [{
            "type": "output_text",
            "text": texto if texto is not None else json.dumps({"opciones": opciones, "aviso": aviso}),
            "annotations": [{"type": "url_citation", "url": u, "title": "x", "start_index": 0, "end_index": 1}
                            for u in citas]}]},
    ]}


class FakeResponses:
    def __init__(self, result=None, error: Exception | None = None, errors: list[Exception] | None = None):
        self.result, self.error, self.errors = result, error, list(errors or [])
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.errors:
            raise self.errors.pop(0)
        if self.error:
            raise self.error
        return self.result


class FakeClient:
    def __init__(self, **kw):
        self.responses = FakeResponses(**kw)


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture(autouse=True)
def sin_archivo(monkeypatch):
    monkeypatch.delenv("FAKE_BUSCADOR_ARCHIVO", raising=False)


def buscar(client, fake, **body):
    with patch.object(ps, "_cliente", return_value=fake):
        return client.post("/precios/buscar", json={"descripcion": "Cemento portland 50 kg", "unidad": "bolsa",
                                                    **body})


class TestBuscar:
    def test_opciones_validas_con_cuenta(self, client):
        fake = FakeClient(result=respuesta(
            [opcion(), opcion(comercio="Sodimac", precio=9900, con_iva=False, url=SODIMAC)],
            citas=[EASY + "?utm_source=openai"], fuentes=[SODIMAC + "/"]))
        r = buscar(client, fake)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["consulta"] == "Cemento portland 50 kg (bolsa)"
        easy, sodimac = body["opciones"]
        assert easy["precio"] == 12100 and easy["con_iva"] is True and easy["moneda"] == "ARS"
        # con IVA → sin IVA (21 %)
        assert easy["precio_unidad_app_sin_iva"] == 10000
        assert easy["cuenta"].startswith("$12.100 bolsa de 50 kg con IVA → $10.000 sin IVA")
        assert easy["url"] == EASY and easy["coincide_unidad"] is True and easy["fecha"]
        assert sodimac["precio_unidad_app_sin_iva"] == 9900 and "sin IVA" in sodimac["cuenta"]
        assert "corralón" in body["aviso"]

    def test_url_inventada_se_descarta(self, client):
        fake = FakeClient(result=respuesta(
            [opcion(), opcion(comercio="Inventado", url="https://www.corralon-trucho.com.ar/cemento")],
            citas=[EASY]))
        body = buscar(client, fake).json()
        assert [o["comercio"] for o in body["opciones"]] == ["Easy"]

    def test_sin_opciones_validas_aviso(self, client):
        fake = FakeClient(result=respuesta([opcion(url="https://inventado.com/x"), opcion(precio=0, url=EASY),
                                            opcion(moneda="USD", url=EASY)], citas=[EASY]))
        body = buscar(client, fake).json()
        assert body["opciones"] == [] and body["aviso"]

    def test_presentacion_distinta_de_la_unidad(self, client):
        fake = FakeClient(result=respuesta([opcion(cantidad_unidades_app=50)], citas=[EASY]))
        [o] = buscar(client, fake, unidad="kg").json()["opciones"]
        assert o["coincide_unidad"] is False and o["precio_unidad_app_sin_iva"] == 200
        assert "= $200 por kg" in o["cuenta"]

    def test_pedido_a_openai(self, client):
        fake = FakeClient(result=respuesta([opcion()], citas=[EASY]))
        buscar(client, fake, tipo="material", codigo="CEM-50")
        [kwargs] = fake.responses.calls
        assert kwargs["model"] == "gpt-4.1"
        assert kwargs["tools"][0]["type"] == "web_search"
        assert kwargs["text"]["format"]["type"] == "json_schema"
        assert kwargs["timeout"] == 60
        assert "Unidad de la app: bolsa" in kwargs["input"] and "CEM-50" in kwargs["input"]

    def test_include_rechazado_reintenta_sin(self, client):
        class BadRequestError(Exception):
            pass
        fake = FakeClient(result=respuesta([opcion()], citas=[EASY]),
                          errors=[BadRequestError("Invalid value for include")])
        assert len(buscar(client, fake).json()["opciones"]) == 1
        assert "include" in fake.responses.calls[0] and "include" not in fake.responses.calls[1]

    def test_sin_clave_503(self, client):
        r = buscar(client, None)
        assert r.status_code == 503
        assert r.json()["detail"]["mensaje"] == "El buscador de precios no está configurado"

    def test_error_502(self, client):
        r = buscar(client, FakeClient(error=RuntimeError("boom")))
        assert r.status_code == 502 and "Probá de nuevo" in r.json()["detail"]["mensaje"]

    def test_tiempo_502(self, client):
        class APITimeoutError(Exception):
            pass
        r = buscar(client, FakeClient(error=APITimeoutError("Request timed out.")))
        assert r.status_code == 502 and "un minuto" in r.json()["detail"]["mensaje"]

    def test_respuesta_ilegible_502(self, client):
        r = buscar(client, FakeClient(result=respuesta([], texto="no encontré nada, perdón")))
        assert r.status_code == 502

    def test_solo_editores(self):
        app = create_app()
        from app.auth import get_current_user
        app.dependency_overrides[get_current_user] = lambda: {**MOCK_USER, "role": "member"}
        r = TestClient(app).post("/precios/buscar", json={"descripcion": "cemento"})
        assert r.status_code == 403

    def test_descripcion_vacia_422(self, client):
        assert buscar(client, FakeClient(), descripcion="  ").status_code == 422

    def test_reemplazar_la_funcion(self, client, monkeypatch):
        async def falsa(descripcion, unidad, tipo=None, codigo=None):
            return {"consulta": descripcion, "opciones": [], "aviso": "falsa"}
        monkeypatch.setattr(ps, "buscar_opciones", falsa)
        assert client.post("/precios/buscar", json={"descripcion": "arena"}).json()["aviso"] == "falsa"


class TestArchivoFalso:
    @pytest.fixture
    def archivo(self, tmp_path, monkeypatch):
        path = tmp_path / "buscador.json"
        path.write_text(json.dumps({
            "opciones": [opcion(), {"comercio": "Sin link", "precio": 5, "url": None}],
            "por_descripcion": {"arena": {"opciones": []}, "falla": {"error": "Se cortó la búsqueda"},
                                "sin configurar": {"no_configurado": True}},
        }), encoding="utf-8")
        monkeypatch.setenv("FAKE_BUSCADOR_ARCHIVO", str(path))
        return path

    def test_opciones_del_archivo_sin_clave(self, client, archivo):
        r = buscar(client, None)
        assert r.status_code == 200
        assert [o["comercio"] for o in r.json()["opciones"]] == ["Easy"]

    def test_bloques_por_descripcion(self, client, archivo):
        assert buscar(client, None, descripcion="Arena gruesa").json()["opciones"] == []
        r = buscar(client, None, descripcion="esto falla")
        assert r.status_code == 502 and r.json()["detail"]["mensaje"] == "Se cortó la búsqueda"
        assert buscar(client, None, descripcion="buscador sin configurar").status_code == 503


class TestPiezas:
    @pytest.mark.parametrize("a, b", [
        ("https://www.easy.com.ar/x/?utm_source=openai", "https://easy.com.ar/x"),
        ("http://easy.com.ar/x#precio", "https://easy.com.ar/x/"),
        ("https://Easy.com.ar/x?id=3&utm_medium=a", "https://easy.com.ar/x?id=3"),
    ])
    def test_normalizar_url(self, a, b):
        assert ps.normalizar_url(a) == ps.normalizar_url(b)

    def test_url_distinta(self):
        assert ps.normalizar_url("https://easy.com.ar/x?id=3") != ps.normalizar_url("https://easy.com.ar/x?id=4")
        assert ps.normalizar_url("javascript:alert(1)") is None

    def test_url_limpia(self):
        assert ps.url_limpia("https://easy.com.ar/x?utm_source=openai#a") == "https://easy.com.ar/x"

    def test_fuentes_de_objetos(self):
        class Obj:
            def __init__(self, **kw):
                self.__dict__.update(kw)
        resp = Obj(output=[Obj(type="web_search_call", action=Obj(type="open_page", url="https://a.com/p")),
                         Obj(type="message", content=[Obj(type="output_text", text="{}", annotations=[
                             Obj(type="url_citation", url="https://b.com/q")])])])
        assert ps.fuentes_de(resp) == {"https://a.com/p", "https://b.com/q"}

    def test_parsear_tolerante(self):
        assert ps.parsear('```json\n{"opciones": []}\n```') == {"opciones": [], }
        assert ps.parsear('Acá tenés: {"opciones": [], "aviso": null} listo') == {"opciones": [], "aviso": None}

    def test_pesos(self):
        assert ps.pesos(12990) == "$12.990"
        assert ps.pesos(10735.54) == "$10.736"
        assert ps.pesos(214.7) == "$214,70"

    def test_precio_con_coma(self):
        o = ps.armar_opcion(opcion(precio="12.100,00"), "bolsa", "2026-10-07")
        assert o["precio"] == 12100 and o["precio_unidad_app_sin_iva"] == 10000

    def test_timeout_real(self, monkeypatch):
        async def lenta(*a, **k):
            await asyncio.sleep(1)
        monkeypatch.setattr(ps, "TIMEOUT_S", -4.9)  # wait_for(timeout=0.1)
        monkeypatch.setattr(ps, "_llamar", lenta)
        with patch.object(ps, "_cliente", return_value=object()):
            with pytest.raises(ps.BuscadorError, match="un minuto"):
                asyncio.run(ps.buscar_opciones("cemento", "bolsa"))
