"""Tests for the Fase 5 loader: cómputo de una obra (01_C&P) + recetas del Maestro."""

from __future__ import annotations

from datetime import datetime

import openpyxl
import pytest

from app.formulas import evaluate
from app.obra_import import (
    altura_from,
    build_plan,
    item_notes,
    match_recipe,
    parse_obra,
    report_markdown,
    suggest_recipes,
)
from import_obra import sql_script

TEMPLATES = {
    "5.1.4": {
        "codigo": "5.1.4", "unidad": "m2",
        "parametros": [{"clave": "altura_m", "valor": 2.8}],
        "recursos": [
            {"tipo": "material", "codigo": "LH18", "formula": "Q*16", "desperdicio_pct": 15.0},
            {"tipo": "material", "codigo": "HADN6", "formula": "((Q/altura_m)*4)/12"},
            {"tipo": "mano_obra", "codigo": "MO-OF", "trabajadores": 1.0, "rendimiento": "15",
             "cargas_sociales_pct": 25.0},
        ],
    },
    "4.1.7": {
        "codigo": "4.1.7", "unidad": "m3", "parametros": [],
        "recursos": [
            {"tipo": "material", "codigo": "H30", "formula": "Q", "desperdicio_pct": 10.0},
            {"tipo": "mano_obra", "codigo": "MO-OF", "trabajadores": 1.0, "rendimiento": "2"},
        ],
    },
    "8.3": {"codigo": "8.3", "unidad": "m2", "parametros": [],
            "recursos": [{"tipo": "material", "codigo": "EPS-500", "formula": "Q"}]},
    "5.2.3": {"codigo": "5.2.3", "unidad": "m3", "parametros": [],
              "recursos": [{"tipo": "material", "codigo": "ES", "formula": "Q*0.8"}]},
    "7.1.1": {"codigo": "7.1.1", "unidad": "m2", "parametros": [],
              "recursos": [{"tipo": "material", "codigo": "RP-PORC", "formula": "Q"},
                           {"tipo": "material", "codigo": "RP-KP", "formula": "(Q*8)/25", "revisar": True,
                            "nota": "número fijo"}]},
}


def _workbook() -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "01_C&P"
    ws["A1"] = "EDIFICIO DE PRUEBA"
    rows = [
        # A (código), B, C, D (cantidad), E (mat unit), J (MO unit), N (directo), Z (neto)
        (None, "1- TAREAS PRELIMINARES", None, None, None, None, None, None),
        (datetime(2026, 1, 1), "OBRADOR", "gl", 1, 0, 1000, 1000, 1500),
        (None, "3- ESTRUCTURA", None, None, None, None, None, None),
        (None, "3.1- FUNDACIONES", None, None, None, None, None, None),
        ("3.1-3", "TENSORES 20 cm x 40 cm.", "ml", 100, 0, 0, 0, 0),
        (None, "4. ALBAÑILERIA", None, None, None, None, None, None),
        (None, "4.2- PRIMER PISO", None, None, None, None, None, None),
        ("4.2-1", "MURO DE MAMPOSTERIA EN LADRILLO HUECO DEL 18. h 3m", "m²", 30, 100, 200, 9000, 12000),
        ("4.2-2", "ARISTAS DE YESO EN PAREDES", "m", 10, 5, 5, 100, 150),
        ("4.2-3", "TELGOPOR 50 mm + CONTRAPISO EN AZOTEA ACCESIBLE e: 8cm", "m²", 50, 1, 1, 100, 100),
        ("4.2-4", "COLOCACION DE REVESTIMIENTOS EN PISOS PORCELANATO. NO INCLUYE EL PORCELANATO", None, 20,
         1, 1, 40, 50),
        (None, "4.3- SEGUNDO PISO", None, None, None, None, None, None),
        ("4.2-5", "COLOCACION DE REVESTIMIENTOS EN PISOS PORCELANATO. NO INCLUYE EL PORCELANATO", "m²", 20,
         1, 1, 40, 50),
    ]
    for r, (a, b, c, d, e, j, n, z) in enumerate(rows, start=8):
        ws.cell(r, 1, a)
        ws.cell(r, 2, b)
        ws.cell(r, 3, c)
        ws.cell(r, 4, d)
        ws.cell(r, 5, e)
        ws.cell(r, 10, j)
        ws.cell(r, 14, n)
        ws.cell(r, 26, z)
    return wb


@pytest.fixture()
def parsed() -> dict:
    return parse_obra(_workbook())


@pytest.fixture()
def plan(parsed: dict) -> dict:
    return build_plan(parsed, TEMPLATES)


def _item(plan: dict, codigo: str) -> dict:
    return next(i for i in plan["items"] if i["codigo"] == codigo)


def test_parse_tree(parsed: dict) -> None:
    filas = parsed["filas"]
    by_code = {f["codigo"]: f for f in filas}
    assert [f["nivel"] for f in filas[:2]] == ["rubro", "item"]
    # Código guardado como fecha: 01/01/2026 → 1.1
    assert by_code["1.1"]["descripcion"] == "OBRADOR"
    assert by_code["3.1.3"]["parent"] == by_code["3.1"]["orden"]
    assert by_code["3.1"]["parent"] == by_code["3"]["orden"]
    assert by_code["4.2.1"]["excel"]["mat_unit"] == 100


def test_code_outside_its_floor_is_fixed(parsed: dict) -> None:
    by_code = {f["codigo"]: f for f in parsed["filas"]}
    assert "4.2.5" not in by_code
    assert by_code["4.3.5"]["parent"] == by_code["4.3"]["orden"]
    assert any("4.2-5" in p for p in parsed["problemas"])


def test_missing_unit_taken_from_other_floor(parsed: dict) -> None:
    by_code = {f["codigo"]: f for f in parsed["filas"]}
    assert by_code["4.2.4"]["unidad"] == "m²"


def test_match_recipe_and_height() -> None:
    assert match_recipe("Muro de mampostería en ladrillo HUECO DEL 18. h 3m")["plantillas"] == [("5.1.4", 1.0)]
    assert match_recipe("MURO DE CARGA. MAMPOSTERIA EN LADRILLO HUECO DEL 18")["nota"]
    assert match_recipe("ESMALTE EN BARANDAS DE BALCONES") is None
    assert altura_from("MURO ... h 4,4m") == 4.4
    assert altura_from("MURO DE CARGA h 0.2m/1.8m") is None


def test_recipe_uses_obra_height(plan: dict) -> None:
    item = _item(plan, "4.2.1")
    assert item["plantilla"] == "5.1.4"
    assert item["parametros"] == {"altura_m": 3.0}
    hierro = next(r for r in item["recursos"] if r["codigo"] == "HADN6")
    assert hierro["cantidad"] == pytest.approx((30 / 3) * 4 / 12, abs=1e-4)
    mo = next(r for r in item["recursos"] if r["tipo"] == "mano_obra")
    assert mo["dias"] == 2.0
    # Sin desperdicio propio: se hereda en el SQL (plantilla > organización)
    assert hierro["desperdicio_pct"] is None
    assert next(r for r in item["recursos"] if r["codigo"] == "LH18")["desperdicio_pct"] == 15.0


def test_unit_factor_is_kept_in_formula(plan: dict) -> None:
    item = _item(plan, "3.1.3")  # 100 ml de tensor = 8 m³
    h30 = next(r for r in item["recursos"] if r["codigo"] == "H30")
    assert h30["cantidad"] == pytest.approx(8.0)
    # La fórmula guardada sigue funcionando al recalcular con Q en ml
    assert evaluate(h30["formula"], {"Q": 100}) == pytest.approx(8.0)
    mo = next(r for r in item["recursos"] if r["tipo"] == "mano_obra")
    assert mo["dias"] == pytest.approx(4.0)
    assert evaluate(f"Q / ({mo['rendimiento']})", {"Q": 100}) == pytest.approx(4.0)


def test_composite_and_client_material(plan: dict) -> None:
    item = _item(plan, "4.2.3")
    assert item["plantillas"] == ["8.3", "5.2.3"]
    es = next(r for r in item["recursos"] if r["codigo"] == "ES")
    assert es["cantidad"] == pytest.approx(50 * 0.08 * 0.8)

    porc = next(r for r in _item(plan, "4.2.4")["recursos"] if r["codigo"] == "RP-PORC")
    assert porc["lo_compra_cliente"] is True
    assert _item(plan, "4.2.4")["revisar"]


def test_items_without_recipe(plan: dict) -> None:
    codes = [i["codigo"] for i in plan["sin_receta"]]
    assert codes == ["1.1", "4.2.2"]
    assert "Sin receta" in item_notes(_item(plan, "1.1"))
    assert plan["plantillas_faltantes"] == []


def test_missing_template_goes_without_recipe(parsed: dict) -> None:
    templates = {k: v for k, v in TEMPLATES.items() if k != "4.1.7"}
    plan = build_plan(parsed, templates)
    assert plan["plantillas_faltantes"] == ["4.1.7"]
    assert "3.1.3" in [i["codigo"] for i in plan["sin_receta"]]


def test_report(parsed: dict, plan: dict) -> None:
    md = report_markdown(parsed, plan, "obra.xlsx")
    assert "## Ítems sin receta en el Maestro" in md
    assert "ARISTAS DE YESO" in md
    assert "3.1.3" in md  # con receta pero en $0 en el Excel


def test_sql_script(plan: dict) -> None:
    sql = sql_script(plan, "OBRA (Fase 5)", "obra.xlsx")
    assert "RAISE EXCEPTION 'Faltan plantillas del Maestro" in sql
    assert "ya existe" in sql
    assert "ARRAY['4.1.7', '5.1.4', '5.2.3', '7.1.1', '8.3']::text[]" in sql
    # Fase 4: indirectos de la obra, fecha de precios y fecha del precio de cada recurso
    assert "Falta correr migrations/008" in sql
    assert "status, indirectos, precios_al)" in sql
    assert "'estructura_pct', coalesce((x.c->>'estructura_pct')::numeric, 15)" in sql
    assert "cantidad_redondeo, precio_fecha)" in sql
    # Auditoría: precio vigente a la fecha del presupuesto (regla de la Fase 4), el mismo
    # para el control y para la carga; sin precio válido se frena, salvo que se fuerce.
    # El comportamiento se prueba contra Postgres en tests/test_obra_import_pg.py.
    assert "x.fecha IS NULL OR x.fecha <= v_fecha" in sql
    assert "JOIN obra_precios op ON op.n = r.n" in sql
    assert "v_permitir_sin_precio boolean := false" in sql
    assert "RAISE EXCEPTION 'Recursos sin precio valido" in sql
    assert "Recalcular obra" in sql
    assert sql.count("$obra$") == 2
    pglast = pytest.importorskip("pglast")
    assert len(pglast.parse_sql(sql)) == 2


def test_price_problems_in_report(parsed: dict, plan: dict) -> None:
    from datetime import date

    from app.obra_import import price_problems

    entries = [
        {"tipo": "material", "codigo": "LH18", "precio_sin_iva": 500, "fecha_precio": None},
        {"tipo": "material", "codigo": "HADN6", "precio_sin_iva": 0, "fecha_precio": None},       # sin precio
        {"tipo": "material", "codigo": "H30", "precio_sin_iva": 100, "fecha_precio": "2099-01-01"},  # futuro
        {"tipo": "material", "codigo": "ES", "precio_sin_iva": 10, "fecha_precio": None},
        {"tipo": "material", "codigo": "es", "precio_sin_iva": 12, "fecha_precio": None},          # duplicado
    ]
    probs = {p["codigo"]: p for p in price_problems(plan, entries, date(2026, 9, 30))}
    assert probs["HADN6"]["motivo"] == "sin precio"
    assert probs["H30"]["motivo"] == "sin precio"
    assert probs["ES"]["motivo"] == "código duplicado en el catálogo"
    assert probs["MO-OF"]["motivo"] == "no está en el catálogo"
    assert "LH18" not in probs
    assert "RP-PORC" not in probs  # lo compra el cliente: no hace falta precio
    md = report_markdown(parsed, plan, "obra.xlsx", list(probs.values()))
    assert "## Recursos sin precio válido (la carga se frena)" in md
    assert "`HADN6`" in md


SUGGEST = {
    "5.1.4": {"nombre": "LADRILLO CERAMICO HUECO DEL 18", "unidad": "m2"},
    "5.1.5": {"nombre": "LADRILLO CERAMICO HUECO DEL 12", "unidad": "m2"},
    "5.1.7": {"nombre": "LADRILLO COMUN", "unidad": "m2"},
    "4.2.6": {"nombre": "escaleras", "unidad": "gl",
              "descripcion": "Importado del Maestro TERRAC (solapa 4.2.6). Cantidad de ejemplo del Excel: 18 gl."},
    "6.1": {"nombre": "CIELORRASO", "unidad": "m2", "descripcion": "Aplicado de yeso"},
}


def test_suggest_recipes() -> None:
    found = suggest_recipes("Muro de mampostería en ladrillo hueco del 18", SUGGEST)
    assert [c for c, _, _ in found] == ["5.1.4", "5.1.5", "5.1.7"]
    assert found[0][1] >= 0.6
    assert found[0][2] == "Se parece por 'ladrillo', 'hueco', '18'"
    assert found[1][1] < found[0][1]  # the number counts


def test_suggest_recipes_needs_words() -> None:
    assert suggest_recipes("Obrador", SUGGEST) == []
    assert suggest_recipes("Bolsas de 18", SUGGEST) == []  # a number alone is not enough
    # One shared word is too generic to propose the recipe by itself
    [(codigo, score, _)] = suggest_recipes("ESMALTE EN ESCALERA COMPLETA", SUGGEST)
    assert (codigo, score) == ("4.2.6", 0.5)
    # Typos and plurals, and the recipe's own description (not the import boilerplate)
    assert suggest_recipes("CIELORASOS APLICADOS EN YESO", SUGGEST)[0][:2] == ("6.1", 1.0)
