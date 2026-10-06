"""PDF del presupuesto: el interno (sin cambios) y el del cliente (PLAN_PRECIO_SEGURO 2.2)."""

from __future__ import annotations

import os
import re
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.calculations import calc_budget_summary
from app.routers.excel import _apply_cfg_defaults, client_pdf_data
from tests.test_recipes_api import MOCK_USER, ORG, FakeDB

BUDGET = "00000000-0000-0000-0000-0000000000b1"


def _item(id_, code, desc, parent=None, order=0, **costs):
    return {"id": id_, "budget_id": BUDGET, "org_id": ORG, "code": code, "description": desc,
            "parent_id": parent, "sort_order": order, "notas": None, **costs}


def _section(id_, code, desc, parent=None, order=0):
    return {**_item(id_, code, desc, parent, order), "notas": "Seccion", "cantidad": 0}


def _work(id_, code, desc, parent, order, cantidad, directo, unidad="m2"):
    # Stored indirecto / beneficio as the cascade leaves them: they must never show
    return _item(id_, code, desc, parent, order, unidad=unidad, cantidad=cantidad,
                 mat_unitario=round(directo * 0.6 / cantidad, 2), mo_unitario=round(directo * 0.4 / cantidad, 2),
                 mat_total=directo * 0.6, mo_total=directo * 0.4, directo_total=directo,
                 indirecto_total=round(directo * 0.34, 2), beneficio_total=round(directo * 0.134, 2),
                 neto_total=round(directo * 1.474, 2))


ITEMS = [
    _section("r1", "1", "ALBAÑILERÍA", order=1),
    _work("i1", "1.1", "Muro de ladrillo hueco del 18", "r1", 2, 30, 22189.33),
    _work("i2", "1.2", "Revoque grueso", "r1", 3, 12.5, 3751.07),
    # Cargar obra: rubro → piso → trabajo
    _section("r2", "2", "CONTRAPISOS", order=4),
    _section("p1", "", "Planta baja", parent="r2", order=5),
    _work("i3", "2.1", "Contrapiso de cascote e=8cm", "p1", 6, 80, 101333.33),
    _section("p2", "", "Primer piso", parent="r2", order=7),
    _work("i4", "2.1", "Contrapiso de cascote e=8cm", "p2", 8, 75, 95000.01),
    # Without rubro
    _work("i5", "3", "Limpieza final", None, 9, 1, 777.77, unidad="gl"),
]
CFG = _apply_cfg_defaults({"beneficio_pct": 12.5})


@pytest.fixture
def client():
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


@pytest.fixture
def db():
    fake = FakeDB({
        "budgets": [{"id": BUDGET, "org_id": ORG, "name": "Edificio Ginkgo", "created_at": "2026-10-01T10:00:00",
                     "description": "Cantidades del Excel de la obra; precios con las fórmulas del Maestro",
                     "indirectos": {"beneficio_pct": 12.5}}],
        "budget_items": ITEMS,
        "indirect_config": [{"id": "cfg", "org_id": ORG}],
    })
    with patch("app.routers.excel.get_data_db", return_value=fake):
        yield fake


def _text(pdf: bytes) -> str:
    fitz = pytest.importorskip("fitz")
    doc = fitz.open(stream=pdf, filetype="pdf")
    return "\n".join(page.get_text() for page in doc)


def _cents(value: float) -> int:
    return round(value * 100)


class TestClientData:
    def test_prices_add_up_to_the_saved_net(self):
        # PLAN_UN_SOLO_TOTAL T8: the client PDF shows the saved price, it never recalculates it
        data = client_pdf_data(ITEMS, CFG)
        works = [i for i in ITEMS if i["notas"] != "Seccion"]
        filas = [f for r in data["rubros"] for f in r["filas"]]
        assert len(filas) == 5
        assert _cents(data["total_sin_iva"]) == sum(_cents(i["neto_total"]) for i in works)
        assert data["total_sin_iva"] == calc_budget_summary(ITEMS)["neto_total"]
        assert sum(_cents(f["total"]) for f in filas) == _cents(data["total_sin_iva"])
        assert sum(_cents(r["subtotal"]) for r in data["rubros"]) == _cents(data["total_sin_iva"])
        assert data["iva_pct"] == 21
        # Saved without IVA (old items): the IVA step over each saved neto
        assert _cents(data["iva"]) == sum(_cents(round(i["neto_total"] * 0.21, 2)) for i in works)
        assert _cents(data["total_con_iva"]) == _cents(data["total_sin_iva"]) + _cents(data["iva"])

    def test_price_is_the_saved_net(self):
        data = client_pdf_data(ITEMS, CFG)
        filas = {f["descripcion"] + str(f["cantidad"]): f for r in data["rubros"] for f in r["filas"]}
        muro = filas["Muro de ladrillo hueco del 1830.0"]
        assert muro["total"] == round(22189.33 * 1.474, 2)
        assert muro["precio_unitario"] == round(muro["total"] / 30, 2)

    def test_saved_iva_and_total_are_used(self):
        items = [{**i, "iva_total": 100.0, "total_final": round(i["neto_total"] + 100, 2)}
                 if i["notas"] != "Seccion" else i for i in ITEMS]
        data = client_pdf_data(items, CFG)
        assert data["iva"] == 500
        assert _cents(data["total_con_iva"]) == _cents(data["total_sin_iva"]) + 50000

    def test_rubros_pisos_and_loose_works(self):
        data = client_pdf_data(ITEMS, CFG)
        assert [r["titulo"] for r in data["rubros"]] == ["1  ALBAÑILERÍA", "2  CONTRAPISOS", "Otros trabajos"]
        contrapisos = data["rubros"][1]["filas"]
        assert [f["piso"] for f in contrapisos] == ["Planta baja", "Primer piso"]
        assert data["rubros"][0]["filas"][0]["piso"] is None

    def test_only_sale_fields(self):
        data = client_pdf_data(ITEMS, CFG)
        assert set(data) == {"rubros", "total_sin_iva", "iva_pct", "iva", "total_con_iva"}
        for fila in (f for r in data["rubros"] for f in r["filas"]):
            assert set(fila) == {"code", "descripcion", "unidad", "cantidad", "precio_unitario", "total", "piso"}

    def test_without_rubros_one_group_without_title(self):
        loose = [i for i in ITEMS if i["id"] in ("i1", "i5")]
        loose = [{**i, "parent_id": None} for i in loose]
        data = client_pdf_data(loose, CFG)
        assert [r["titulo"] for r in data["rubros"]] == [None]

    def test_no_direct_cost(self):
        data = client_pdf_data([_section("r1", "1", "Vacío")], CFG)
        assert data["total_sin_iva"] == 0 and data["rubros"] == []


class TestClientPdf:
    def test_is_a_pdf_without_internal_costs(self, client, db):
        r = client.get(f"/budgets/{BUDGET}/export/pdf?vista=cliente")
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/pdf"
        assert r.content.startswith(b"%PDF")
        text = _text(r.content)
        for word in ("Directo", "directo", "Indirecto", "Beneficio", "Imprevistos", "Materiales",
                     "Mano de Obra", "MAT", "Cascada", "Ingresos Brutos", "Maestro"):
            assert word not in text, word
        assert text.count("%") == 1 and "IVA (21%)" in text
        for label in ("Edificio Ginkgo", "Fecha: 2026-10-01", "ALBAÑILERÍA", "Planta baja", "Otros trabajos",
                      "Total sin IVA", "Total con IVA", "Precio unitario"):
            assert label in text, label

    def test_work_prices_add_up_to_the_total(self, client, db):
        text = _text(client.get(f"/budgets/{BUDGET}/export/pdf?vista=cliente").content)
        data = client_pdf_data(ITEMS, _apply_cfg_defaults({"beneficio_pct": 12.5}))

        def ars(value: float) -> str:
            return "$ " + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

        # The PDF shows each work's total, and those totals add up to the "Total sin IVA" it shows
        totales = [f["total"] for r in data["rubros"] for f in r["filas"]]
        for total in totales:
            assert ars(total) in text
        assert re.search(r"Total sin IVA\s+" + re.escape(ars(data["total_sin_iva"])), text)
        assert sum(_cents(t) for t in totales) == _cents(data["total_sin_iva"])
        assert re.search(r"Total con IVA\s+" + re.escape(ars(data["total_con_iva"])), text)

    def test_bad_vista(self, client, db):
        assert client.get(f"/budgets/{BUDGET}/export/pdf?vista=otra").status_code == 422


class TestInternalPdf:
    @pytest.mark.parametrize("query", ["", "?vista=interna"])
    def test_still_the_internal_one(self, client, db, query):
        r = client.get(f"/budgets/{BUDGET}/export/pdf{query}")
        assert r.status_code == 200
        assert 'filename="Edificio_Ginkgo_presupuesto.pdf"' in r.headers["content-disposition"]
        text = _text(r.content)
        for label in ("Costo Directo", "Indirectos + Beneficio", "Cascada de Costos", "Beneficio",
                      "Cantidades del Excel de la obra"):
            assert label in text, label
