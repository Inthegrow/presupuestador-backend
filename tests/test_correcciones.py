"""Correcciones de la revisión de Ginkgo: lista con estado, aplicar, deshacer (app/routers/correcciones.py).

Usan su propio archivo de correcciones (no el real, que cambia con la auditoría), salvo
TestArchivoReal, que solo controla que el real cargue y respete el esquema.
"""

from __future__ import annotations

import copy
import json
import os
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app import correcciones as corr
from app.main import create_app
from tests.test_recipes_api import MOCK_USER, ORG, FakeDB, Query

OTRA = "otra-org-uuid"
NOTA_C1 = "Corregido por la revisión de Ginkgo (C1), supuesto por Claude el 7/10/2026, a confirmar por Emilia"

SUPUESTO = {"respuesta": "Sí", "por": "Claude", "fecha": "2026-10-07", "confirma": "Emilia", "razon": "Porque sí."}

LOTE = {
    "lote": "ginkgo-test", "titulo": "Revisión de Ginkgo", "fecha": "2026-10-07",
    "correcciones": [
        {"id": "C1", "titulo": "Membrana cada 10 m²", "por_que": "Un rollo cubre 10 m².", "supuesto": SUPUESTO,
         "fuentes": ["Excel de Sol, Ginkgo, hoja 4.9-3, fila 69"], "efecto_ginkgo": -19732275,
         "cambios": [{"tipo": "renglon", "plantilla": "8.4", "codigo": "C-MEM",
                      "antes": {"formula": "Q"}, "despues": {"formula": "Q/10"}}]},
        {"id": "C2", "titulo": "Fórmula nueva y renglones", "por_que": "Para probar.", "supuesto": SUPUESTO,
         "fuentes": ["Auditoría"], "efecto_ginkgo": None,
         "cambios": [
             {"tipo": "plantilla_nueva", "plantilla": {
                 "codigo": "5.5.6", "nombre": "YESO PROYECTADO", "unidad": "m2", "categoria": "Albañilería",
                 "parametros": [], "desperdicio_pct": None, "recursos": [
                     {"tipo": "material", "codigo": "YES-P", "descripcion": "Bolsa yeso proyectado", "unidad": "u",
                      "formula": "Q/3", "desperdicio_pct": 25},
                     {"tipo": "subcontrato", "codigo": "SUB-YES-PARED-PROY", "descripcion": "Yeso proyectado",
                      "unidad": "m2", "formula": "Q"}]}},
             {"tipo": "renglon_quitar", "plantilla": "6.3", "codigo": "Y-L1X1",
              "antes": {"codigo": "Y-L1X1", "formula": "2"}},
             {"tipo": "renglon_nuevo", "plantilla": "6.3", "renglon": {
                 "tipo": "material", "codigo": "Y-CLAVO", "descripcion": "Clavos", "unidad": "kg", "formula": "Q/20"}},
         ]},
        {"id": "C3", "titulo": "Cajones", "por_que": "El subcontrato estaba a $1.", "supuesto": SUPUESTO,
         "fuentes": ["Excel de Sol, Ginkgo, hoja 00_Sub"], "efecto_ginkgo": 14275457,
         "cambios": [
             {"tipo": "renglon", "plantilla": "6.3", "codigo": "SUB-YES-AGARGANTA",
              "antes": {"formula": "Q"},
              "despues": {"codigo": "SUB-YES-CAJON", "descripcion": "YESO ARMADO- CAJON (x metro lineal)"}},
             {"tipo": "precio", "codigo": "SUB-YES-CAJON", "tipo_recurso": "subcontrato",
              "descripcion": "YESO ARMADO- CAJON (x metro lineal)", "unidad": "m", "antes": None,
              "despues": {"precio_sin_iva": 25000, "proveedor": "EVER", "fecha_precio": "2026-09-18"},
              "fuente": "Excel de Sol, Ginkgo, hoja 00_Sub", "url": None},
             {"tipo": "precio", "codigo": "YES", "tipo_recurso": "material", "descripcion": "Bolsa de yeso",
              "unidad": "u", "antes": None,
              "despues": {"precio_sin_iva": 14000, "proveedor": "EVER", "fecha_precio": "2026-09-18"},
              "fuente": "Excel de Sol, Ginkgo, hoja 00_Mat", "url": None},
         ]},
        {"id": "C4", "titulo": "Yeso proyectado más caro", "por_que": "Precio viejo.", "supuesto": SUPUESTO,
         "fuentes": ["Easy"], "efecto_ginkgo": None,
         "cambios": [{"tipo": "precio", "codigo": "YES-P", "tipo_recurso": "material",
                      "descripcion": "Bolsa yeso proyectado", "unidad": "u", "antes": {"precio_sin_iva": 18000},
                      "despues": {"precio_sin_iva": 19500, "proveedor": "Easy", "fecha_precio": "2026-10-07"},
                      "fuente": "Internet: Easy · Yeso proyectado 30 kg",
                      "url": "https://www.easy.com.ar/yeso-proyectado"}]},
    ],
}


def _plantillas(org: str) -> list[dict]:
    return [
        {"id": f"{org}-84", "org_id": org, "codigo": "8.4", "nombre": "MEMBRANA ASFALTICA + GEOTEXTIL",
         "unidad": "m2", "parametros": [], "editado": False, "recursos": [
             {"tipo": "material", "codigo": "A-MEG", "descripcion": "Membrana", "unidad": "u", "formula": "Q/10",
              "desperdicio_pct": 15},
             {"tipo": "subcontrato", "codigo": "C-MEM", "descripcion": "COLOCACION DE ROLLO DE MEMBRANA",
              "unidad": "u", "formula": "Q", "desperdicio_pct": 15}]},
        {"id": f"{org}-63", "org_id": org, "codigo": "6.3", "nombre": "GARGANTAS / CAJON 20X20", "unidad": "m",
         "parametros": [], "editado": False, "recursos": [
             {"tipo": "material", "codigo": "Y-M4X1", "descripcion": "Maestras", "unidad": "u", "formula": "1",
              "nota": "Número fijo (1)", "revisar": True},
             {"tipo": "material", "codigo": "Y-L1X1", "descripcion": "Listones", "unidad": "u", "formula": "2"},
             {"tipo": "subcontrato", "codigo": "SUB-YES-AGARGANTA", "descripcion": "YESO APLICADO EN CIELORRASO ARMADO",
              "unidad": "m", "formula": "Q", "desperdicio_pct": 10}]},
    ]


def tables(oficial: bool = True) -> dict:
    return {
        "item_templates": _plantillas(ORG) + _plantillas(OTRA),
        "price_catalogs": [
            {"id": "cat-mat", "org_id": ORG, "name": "Maestro TERRAC - Materiales", "oficial": oficial,
             "created_at": "2026-09-01"},
            {"id": "cat-sub", "org_id": ORG, "name": "Maestro TERRAC - Subcontratos", "oficial": oficial,
             "created_at": "2026-09-02"},
            {"id": "cat-lh", "org_id": ORG, "name": "Las Heras", "oficial": False, "created_at": "2026-06-01"},
            {"id": "cat-otra", "org_id": OTRA, "name": "Subcontratos", "oficial": True, "created_at": "2026-09-01"},
        ],
        "catalog_entries": [
            {"id": "e-yes", "org_id": ORG, "catalog_id": "cat-mat", "codigo": "YES", "tipo": "material",
             "descripcion": "Bolsa yeso", "precio_sin_iva": 15000, "fecha_precio": "2026-10-03", "proveedor": "X",
             "fuente": None, "fuente_url": None},
            {"id": "e-yesp", "org_id": ORG, "catalog_id": "cat-mat", "codigo": "YES-P", "tipo": "material",
             "descripcion": "Bolsa yeso proyectado", "precio_sin_iva": 18000, "fecha_precio": "2025-09-02",
             "proveedor": "Y", "fuente": None, "fuente_url": None},
            {"id": "e-lh", "org_id": ORG, "catalog_id": "cat-lh", "codigo": "SUB-YES-CAJON", "tipo": "subcontrato",
             "precio_sin_iva": 1, "fecha_precio": "2026-01-01"},
            {"id": "e-otra", "org_id": OTRA, "catalog_id": "cat-otra", "codigo": "YES-P", "tipo": "material",
             "precio_sin_iva": 18000, "fecha_precio": "2025-09-02"},
        ],
        "catalog_price_history": [],
        "budget_items": [],
        "correcciones_aplicadas": [],
    }


class FlakyQuery(Query):
    def execute(self):
        if self.db.falla(self.name, self.action, self.payload):
            raise RuntimeError(f"falla simulada: {self.action} {self.name}")
        return super().execute()


class FlakyDB(FakeDB):
    """FakeDB whose writes fail when ``falla(tabla, accion, payload)`` says so."""

    def __init__(self, tables, falla=None):
        super().__init__(tables)
        self.falla = falla or (lambda *a: False)

    def table(self, name):
        return FlakyQuery(self, name)


@pytest.fixture
def lote_path(tmp_path):
    path = tmp_path / "correcciones.json"
    path.write_text(json.dumps(LOTE, ensure_ascii=False), encoding="utf-8")
    with patch.object(corr, "RUTA", path):
        yield path


@pytest.fixture
def db(lote_path):
    fake = FlakyDB(tables())
    with patch("app.routers.correcciones.get_data_db", return_value=fake):
        yield fake


def _client(user=MOCK_USER):
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def client():
    return _client()


def plantilla(db, codigo, org=ORG):
    return next(t for t in db.tables["item_templates"] if t["codigo"] == codigo and t["org_id"] == org)


def renglon(db, codigo_plantilla, codigo, org=ORG):
    return next((r for r in plantilla(db, codigo_plantilla, org)["recursos"] if r["codigo"] == codigo), None)


def listar(client) -> dict[str, dict]:
    r = client.get("/correcciones")
    assert r.status_code == 200, r.text
    return {c["id"]: c for c in r.json()["correcciones"]}


# ── Lista y estado ───────────────────────────────────────────────────────────


class TestLista:
    def test_todas_para_aplicar_con_nombres(self, client, db):
        r = client.get("/correcciones")
        body = r.json()
        assert body["lote"] == "ginkgo-test" and body["titulo"] == "Revisión de Ginkgo"
        cs = {c["id"]: c for c in body["correcciones"]}
        assert {c["estado"] for c in cs.values()} == {"para_aplicar"}
        c1 = cs["C1"]
        assert c1["supuesto"]["por"] == "Claude" and c1["fuentes"] and c1["efecto_ginkgo"] == -19732275
        assert c1["aplicada"] is None
        cambio = c1["cambios"][0]
        assert cambio["nombre_plantilla"] == "Membrana asfaltica + geotextil"
        assert cambio["nombre_recurso"] == "COLOCACION DE ROLLO DE MEMBRANA"
        assert cambio["estado_cambio"] == "para_aplicar"
        assert cambio["antes"] == {"formula": "Q"} and cambio["despues"] == {"formula": "Q/10"}

    def test_precio_mas_nuevo_se_saltea(self, client, db):
        c3 = listar(client)["C3"]
        assert c3["estado"] == "para_aplicar"
        yes = next(c for c in c3["cambios"] if c.get("codigo") == "YES")
        assert yes["estado_cambio"] == "se_saltea"
        assert "3/10/2026" in yes["detalle"] and "no se toca" in yes["detalle"]
        cajon = next(c for c in c3["cambios"] if c["tipo"] == "precio" and c["codigo"] == "SUB-YES-CAJON")
        # Only the oficial catalogs count: the $1 of Las Heras is not "the list"
        assert cajon["estado_cambio"] == "para_aplicar"
        assert "Maestro TERRAC - Subcontratos" in cajon["detalle"]

    def test_no_coincide_dice_que_encontro(self, client, db):
        renglon(db, "8.4", "C-MEM")["formula"] = "Q*2"
        c1 = listar(client)["C1"]
        assert c1["estado"] == "no_coincide"
        assert "C-MEM" in c1["detalle"] and "«Q*2»" in c1["detalle"] and "«Q»" in c1["detalle"]
        assert c1["cambios"][0]["estado_cambio"] == "no_coincide"
        assert c1["cambios"][0]["encontrado"] == {"formula": "Q*2"}

    def test_ya_corregida_a_mano(self, client, db):
        renglon(db, "8.4", "C-MEM")["formula"] = "Q / 10"
        c1 = listar(client)["C1"]
        assert c1["estado"] == "aplicada" and c1["aplicada"] is None
        assert c1["cambios"][0]["estado_cambio"] == "ya_esta"

    def test_sin_migracion_la_lista_anda(self, client, db):
        db.falla = lambda tabla, *a: tabla == "correcciones_aplicadas"
        assert {c["estado"] for c in listar(client).values()} == {"para_aplicar"}

    def test_archivo_invalido_lista_vacia_con_aviso(self, client, db, lote_path):
        lote_path.write_text(json.dumps({**LOTE, "fecha": "ayer"}), encoding="utf-8")
        body = client.get("/correcciones").json()
        assert body["correcciones"] == [] and "«fecha»" in body["aviso"]
        r = client.post("/correcciones/C1/aplicar")
        assert r.status_code == 409

    def test_no_existe(self, client, db):
        assert client.post("/correcciones/Z9/aplicar").status_code == 404


# ── Aplicar ──────────────────────────────────────────────────────────────────


class TestAplicar:
    def test_cambia_solo_el_renglon_y_registra(self, client, db):
        r = client.post("/correcciones/C1/aplicar")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["estado"] == "aplicada" and body["aplicada"]["por"] == MOCK_USER["email"]
        assert "Cargar obra" in body["aviso"]
        cmem = renglon(db, "8.4", "C-MEM")
        assert cmem["formula"] == "Q/10" and cmem["desperdicio_pct"] == 15
        assert cmem["correccion"] == {"lote": "ginkgo-test", "id": "C1", "texto": NOTA_C1}
        assert "correccion" not in renglon(db, "8.4", "A-MEG")
        assert plantilla(db, "8.4")["editado"] is True
        # The other company is not touched
        assert renglon(db, "8.4", "C-MEM", OTRA)["formula"] == "Q"
        assert plantilla(db, "8.4", OTRA)["editado"] is False
        [registro] = db.tables["correcciones_aplicadas"]
        assert registro["org_id"] == ORG and registro["lote"] == "ginkgo-test" and registro["estado"] == "aplicada"
        assert registro["antes"]["plantillas"][0]["recursos"][1]["formula"] == "Q"
        assert registro["despues"]["plantillas"][0]["recursos"][1]["formula"] == "Q/10"
        c1 = listar(client)["C1"]
        assert c1["estado"] == "aplicada" and c1["cambios"][0]["estado_cambio"] == "aplicado"
        assert c1["aplicada"]["fecha"]

    def test_dos_veces_409(self, client, db):
        assert client.post("/correcciones/C1/aplicar").status_code == 200
        r = client.post("/correcciones/C1/aplicar")
        assert r.status_code == 409 and "ya está aplicada" in r.json()["detail"]

    def test_no_coincide_409_sin_escribir(self, client, db):
        renglon(db, "8.4", "C-MEM")["formula"] = "Q*2"
        antes = copy.deepcopy(db.tables)
        r = client.post("/correcciones/C1/aplicar")
        assert r.status_code == 409
        detail = r.json()["detail"]
        assert detail["codigo"] == "NO_COINCIDE" and "«Q*2»" in detail["mensaje"]
        assert db.tables == antes

    def test_formula_nueva_y_renglones(self, client, db):
        assert client.post("/correcciones/C2/aplicar").status_code == 200
        nueva = plantilla(db, "5.5.6")
        assert nueva["editado"] is True and nueva["unidad"] == "m2"
        assert [r["codigo"] for r in nueva["recursos"]] == ["YES-P", "SUB-YES-PARED-PROY"]
        assert all(r["correccion"]["id"] == "C2" for r in nueva["recursos"])
        assert [r["codigo"] for r in plantilla(db, "6.3")["recursos"]] == ["Y-M4X1", "SUB-YES-AGARGANTA", "Y-CLAVO"]
        assert renglon(db, "6.3", "Y-CLAVO")["correccion"]["id"] == "C2"
        assert not [t for t in db.tables["item_templates"] if t["codigo"] == "5.5.6" and t["org_id"] == OTRA]

    def test_precios_con_fuente_e_historial(self, client, db):
        r = client.post("/correcciones/C3/aplicar")
        assert r.status_code == 200, r.text
        assert r.json()["estado"] == "en_parte"
        assert "3/10/2026" in r.json()["detalle"]
        assert renglon(db, "6.3", "SUB-YES-CAJON")["descripcion"] == "YESO ARMADO- CAJON (x metro lineal)"
        assert renglon(db, "6.3", "SUB-YES-AGARGANTA") is None
        [nueva] = [e for e in db.tables["catalog_entries"]
                   if e["codigo"] == "SUB-YES-CAJON" and e["catalog_id"] == "cat-sub"]
        assert nueva == {**nueva, "org_id": ORG, "precio_sin_iva": 25000.0, "fecha_precio": "2026-09-18",
                         "proveedor": "EVER", "fuente": "Excel de Sol, Ginkgo, hoja 00_Sub", "fuente_url": None,
                         "tipo": "subcontrato", "unidad": "m"}
        [hist] = [h for h in db.tables["catalog_price_history"] if h["entry_id"] == nueva["id"]]
        assert hist["fuente"] == "Excel de Sol, Ginkgo, hoja 00_Sub" and hist["precio_sin_iva"] == 25000
        # YES has a newer price (3/10): not touched
        yes = next(e for e in db.tables["catalog_entries"] if e["id"] == "e-yes")
        assert yes["precio_sin_iva"] == 15000 and yes["fuente"] is None
        c3 = listar(client)["C3"]
        assert c3["estado"] == "en_parte"
        assert next(c for c in c3["cambios"] if c.get("codigo") == "YES")["estado_cambio"] == "salteado"

    def test_precio_con_iva_sigue_y_deshacer_lo_restaura(self, client, db):
        yesp = next(e for e in db.tables["catalog_entries"] if e["id"] == "e-yesp")
        yesp["precio_con_iva"] = 21780  # 18000 + 21 %
        assert client.post("/correcciones/C4/aplicar").status_code == 200
        assert yesp["precio_con_iva"] == 23595  # 19500 + 21 %
        assert client.post("/correcciones/C4/deshacer").status_code == 200
        assert yesp["precio_con_iva"] == 21780 and yesp["precio_sin_iva"] == 18000

    def test_actualiza_precio_viejo(self, client, db):
        assert client.post("/correcciones/C4/aplicar").status_code == 200
        yesp = next(e for e in db.tables["catalog_entries"] if e["id"] == "e-yesp")
        assert yesp["precio_sin_iva"] == 19500 and yesp["fecha_precio"] == "2026-10-07"
        assert yesp["proveedor"] == "Easy" and yesp["fuente_url"] == "https://www.easy.com.ar/yeso-proyectado"
        [hist] = db.tables["catalog_price_history"]
        assert hist["entry_id"] == "e-yesp" and hist["fuente_url"] == "https://www.easy.com.ar/yeso-proyectado"
        assert hist["proveedor"] == "Easy"
        otra = next(e for e in db.tables["catalog_entries"] if e["id"] == "e-otra")
        assert otra["precio_sin_iva"] == 18000

    def test_sin_lista_oficial_409(self, client, lote_path):
        fake = FlakyDB(tables(oficial=False))
        with patch("app.routers.correcciones.get_data_db", return_value=fake):
            r = client.post("/correcciones/C3/aplicar")
        assert r.status_code == 409 and r.json()["detail"]["codigo"] == "SIN_LISTA_OFICIAL"
        assert renglon(fake, "6.3", "SUB-YES-AGARGANTA") is not None

    def test_sin_migracion_409(self, client, db):
        db.falla = lambda tabla, *a: tabla == "correcciones_aplicadas"
        r = client.post("/correcciones/C1/aplicar")
        assert r.status_code == 409 and r.json()["detail"]["codigo"] == "FALTA_MIGRACION"
        assert "012" in r.json()["detail"]["mensaje"]
        assert renglon(db, "8.4", "C-MEM")["formula"] == "Q"

    def test_formula_invalida_422(self, client, db, lote_path):
        malo = copy.deepcopy(LOTE)
        malo["correcciones"][0]["cambios"][0]["despues"] = {"formula": "Q*espesor"}
        lote_path.write_text(json.dumps(malo), encoding="utf-8")
        r = client.post("/correcciones/C1/aplicar")
        assert r.status_code == 422 and "8.4" in r.json()["detail"][0]
        assert renglon(db, "8.4", "C-MEM")["formula"] == "Q"

    def test_falla_a_mitad_restaura(self, client, db):
        antes = copy.deepcopy(db.tables)
        db.falla = lambda tabla, accion, payload: tabla == "correcciones_aplicadas" and accion == "insert"
        r = client.post("/correcciones/C3/aplicar")
        assert r.status_code == 500
        assert r.json()["detail"]["codigo"] == "NO_SE_APLICO"
        assert db.tables == antes

    def test_falla_al_restaurar_a_medias(self, client, db):
        def falla(tabla, accion, payload):
            if tabla == "correcciones_aplicadas" and accion == "insert":
                return True
            # the restore of the formula fails too
            return tabla == "item_templates" and accion == "update" and payload.get("recursos", [{}])[-1].get(
                "codigo") == "SUB-YES-AGARGANTA"
        db.falla = falla
        r = client.post("/correcciones/C3/aplicar")
        assert r.status_code == 500 and r.json()["detail"]["codigo"] == "A_MEDIAS"
        assert "Volvé a aplicarla o deshacela" in r.json()["detail"]["mensaje"]

    def test_solo_editores(self, db):
        client = _client({**MOCK_USER, "role": "member"})
        assert client.post("/correcciones/C1/aplicar").status_code == 403
        assert client.get("/correcciones").status_code == 200


# ── Deshacer ─────────────────────────────────────────────────────────────────


class TestDeshacer:
    def test_vuelve_todo_como_estaba(self, client, db):
        antes = copy.deepcopy(db.tables)
        for cid in ("C1", "C2", "C3", "C4"):
            assert client.post(f"/correcciones/{cid}/aplicar").status_code == 200, cid
        for cid in ("C4", "C3", "C2", "C1"):
            r = client.post(f"/correcciones/{cid}/deshacer")
            assert r.status_code == 200, r.text
            assert r.json()["estado"] == "para_aplicar"
        registros = db.tables.pop("correcciones_aplicadas")
        assert {r["estado"] for r in registros} == {"deshecha"} and all(r["deshecha_at"] for r in registros)
        antes.pop("correcciones_aplicadas")
        assert db.tables == antes
        assert {c["estado"] for c in listar(client).values()} == {"para_aplicar"}

    def test_se_puede_volver_a_aplicar(self, client, db):
        assert client.post("/correcciones/C1/aplicar").status_code == 200
        assert client.post("/correcciones/C1/deshacer").status_code == 200
        assert client.post("/correcciones/C1/aplicar").status_code == 200
        assert renglon(db, "8.4", "C-MEM")["formula"] == "Q/10"

    def test_editada_despues_409(self, client, db):
        assert client.post("/correcciones/C1/aplicar").status_code == 200
        renglon(db, "8.4", "C-MEM")["formula"] = "Q/5"
        r = client.post("/correcciones/C1/deshacer")
        assert r.status_code == 409
        mensaje = r.json()["detail"]["mensaje"]
        assert "8.4" in mensaje and "«Q/10»" in mensaje and "«Q/5»" in mensaje
        assert renglon(db, "8.4", "C-MEM")["formula"] == "Q/5"
        assert db.tables["correcciones_aplicadas"][0]["estado"] == "aplicada"

    def test_precio_cambiado_despues_409(self, client, db):
        assert client.post("/correcciones/C4/aplicar").status_code == 200
        next(e for e in db.tables["catalog_entries"] if e["id"] == "e-yesp")["precio_sin_iva"] = 21000
        r = client.post("/correcciones/C4/deshacer")
        assert r.status_code == 409 and "YES-P" in r.json()["detail"]["mensaje"]

    def test_formula_creada_en_uso_409(self, client, db):
        assert client.post("/correcciones/C2/aplicar").status_code == 200
        db.tables["budget_items"].append({"id": "i1", "org_id": ORG, "template_id": plantilla(db, "5.5.6")["id"]})
        r = client.post("/correcciones/C2/deshacer")
        assert r.status_code == 409 and "5.5.6" in r.json()["detail"]["mensaje"]
        assert plantilla(db, "5.5.6")

    def test_no_aplicada_409(self, client, db):
        r = client.post("/correcciones/C1/deshacer")
        assert r.status_code == 409

    def test_falla_al_deshacer_restaura(self, client, db):
        assert client.post("/correcciones/C3/aplicar").status_code == 200
        antes = copy.deepcopy(db.tables)
        db.falla = lambda tabla, accion, payload: tabla == "correcciones_aplicadas" and accion == "update"
        r = client.post("/correcciones/C3/deshacer")
        assert r.status_code == 500 and r.json()["detail"]["codigo"] == "NO_SE_APLICO"
        # Same data (the restored rows may come back in another order)
        for tabla, filas in antes.items():
            key = lambda r: str(r.get("id"))  # noqa: E731
            assert sorted(db.tables[tabla], key=key) == sorted(filas, key=key), tabla


    def test_falla_al_borrar_la_entrada_conserva_el_historial(self, client, db):
        # Codex PR #45: the history was deleted before the entry and not put back if deleting the entry failed
        assert client.post("/correcciones/C3/aplicar").status_code == 200
        antes = copy.deepcopy(db.tables)
        assert antes["catalog_price_history"], "la corrección guardó historial"
        db.falla = lambda tabla, accion, payload: tabla == "catalog_entries" and accion == "delete"
        r = client.post("/correcciones/C3/deshacer")
        assert r.status_code == 500 and r.json()["detail"]["codigo"] == "NO_SE_APLICO"
        for tabla, filas in antes.items():
            key = lambda r: str(r.get("id"))  # noqa: E731
            assert sorted(db.tables[tabla], key=key) == sorted(filas, key=key), tabla
        # and undoing again works
        db.falla = lambda *a: False
        assert client.post("/correcciones/C3/deshacer").status_code == 200


# ── Archivo ──────────────────────────────────────────────────────────────────


class TestValidador:
    def test_fixture_valido(self):
        assert corr.validar(LOTE) == []

    def test_mensajes_dicen_que_correccion_y_que_cambio(self):
        malo = copy.deepcopy(LOTE)
        malo["correcciones"][0]["cambios"][0].pop("despues")
        malo["correcciones"][2]["cambios"][1]["despues"]["precio_sin_iva"] = 0
        malo["correcciones"][2]["cambios"][1]["url"] = "ftp://x"
        malo["correcciones"][1]["supuesto"] = {**SUPUESTO, "confirma": ""}
        malo["correcciones"][3]["id"] = "C1"
        errores = corr.validar(malo)
        assert "Corrección C1, cambio 1 (renglon): falta «despues» (lo que cambia del renglón)" in errores
        assert any(e.startswith("Corrección C3, cambio 2 (precio): «despues.precio_sin_iva»") for e in errores)
        assert any(e.startswith("Corrección C3, cambio 2 (precio): «url»") for e in errores)
        assert "Corrección C2: al supuesto le falta «confirma»" in errores
        assert "Corrección C1: «id» repetido" in errores

    def test_formula_nueva_mal_escrita(self):
        malo = copy.deepcopy(LOTE)
        malo["correcciones"][1]["cambios"][0]["plantilla"]["recursos"][0]["formula"] = "Q/"
        errores = corr.validar(malo)
        assert len(errores) == 1 and errores[0].startswith("Corrección C2, cambio 1 (plantilla_nueva): Recurso YES-P")

    def test_tipo_desconocido(self):
        malo = copy.deepcopy(LOTE)
        malo["correcciones"][0]["cambios"][0]["tipo"] = "otro"
        assert corr.validar(malo)[0].startswith("Corrección C1, cambio 1: «tipo» no válido")

    def test_json_roto(self, tmp_path):
        path = tmp_path / "x.json"
        path.write_text("{", encoding="utf-8")
        with pytest.raises(corr.LoteInvalido) as exc:
            corr.cargar(path)
        assert "no es un JSON válido" in exc.value.errores[0]

    def test_nota(self):
        assert corr.nota_correccion(LOTE, LOTE["correcciones"][0])["texto"] == NOTA_C1


class TestArchivoReal:
    def test_carga_y_respeta_el_esquema(self):
        data = corr.cargar()  # app/data/correcciones_ginkgo.json
        assert data["correcciones"]
        assert corr.validar(data) == []
        for c in data["correcciones"]:
            assert c["supuesto"]["por"] and c["supuesto"]["confirma"]
            assert c["fuentes"]
