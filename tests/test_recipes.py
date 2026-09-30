"""Tests for smart recipes: parameters, waste inheritance, labor, rounding (Fase 2)."""

from __future__ import annotations

import pytest

from app.calculations import calc_item_from_resources, calc_resource_subtotal
from app.formulas import FormulaError
from app.recipes import (
    apply_purchase_rounding,
    expand_resource,
    has_formula,
    labor_days,
    merge_params,
    param_defaults,
    quantify,
    requantify_row,
    resolve_waste,
    validate_template,
)

PLATEA_PARAMS = [
    {"clave": "espesor", "valor": 0.20, "unidad": "m"},
    {"clave": "ml_vigas", "valor": 0, "unidad": "ml"},
    {"clave": "ancho_viga", "valor": 0.70, "unidad": "m"},
]


class TestParams:
    def test_defaults_from_list(self):
        assert param_defaults(PLATEA_PARAMS) == {"espesor": 0.2, "ml_vigas": 0, "ancho_viga": 0.7}

    def test_defaults_from_dict_and_empty(self):
        assert param_defaults({"a": "0,5"}) == {"a": 0.5}
        assert param_defaults(None) == {}

    def test_merge_overrides_known_only(self):
        merged = merge_params({"espesor": 0.2}, {"espesor": 0.15, "otro": 9})
        assert merged == {"espesor": 0.15}

    def test_merge_ignores_empty(self):
        assert merge_params({"espesor": 0.2}, {"espesor": None}) == {"espesor": 0.2}


class TestValidateTemplate:
    def test_ok(self):
        recursos = [
            {"tipo": "material", "codigo": "H30", "formula": "Q * espesor"},
            {"tipo": "mano_obra", "codigo": "MO", "rendimiento": 10},
        ]
        assert validate_template(recursos, PLATEA_PARAMS) == []

    def test_unknown_variable(self):
        errors = validate_template([{"tipo": "material", "codigo": "H30", "formula": "Q * alto"}], [])
        assert len(errors) == 1 and "H30" in errors[0] and "alto" in errors[0]

    def test_bad_param_names(self):
        errors = validate_template([], [{"clave": "Q", "valor": 1}, {"clave": "2x", "valor": 1}])
        assert len(errors) == 2

    def test_repeated_param(self):
        errors = validate_template([], [{"clave": "a", "valor": 1}, {"clave": "a", "valor": 2}])
        assert any("repetido" in e for e in errors)

    def test_bad_values(self):
        errors = validate_template(
            [
                {"tipo": "mano_obra", "codigo": "MO", "rendimiento": 0},
                {"tipo": "material", "codigo": "C", "unidad_compra": 0},
                {"tipo": "material", "codigo": "D", "desperdicio_pct": "mucho"},
                {"tipo": "otro", "codigo": "E"},
            ],
            [{"clave": "a", "valor": "x"}],
        )
        assert len(errors) == 5

    def test_rendimiento_as_formula(self):
        recursos = [{"tipo": "mano_obra", "rendimiento": "rend * 2"}]
        assert validate_template(recursos, [{"clave": "rend", "valor": 5}]) == []
        assert validate_template(recursos, []) != []


class TestResolveWaste:
    def test_resource_wins(self):
        assert resolve_waste(15, 5, 8, 10) == (15, "recurso")

    def test_budget_over_template_and_org(self):
        assert resolve_waste(None, 5, 8, 10) == (5, "presupuesto")

    def test_template_over_org(self):
        assert resolve_waste(None, None, 8, 10) == (8, "plantilla")

    def test_org_default(self):
        assert resolve_waste(None, None, None, 10) == (10, "organizacion")

    def test_nothing_is_zero(self):
        assert resolve_waste() == (0, "organizacion")

    def test_explicit_zero_counts(self):
        assert resolve_waste(None, 0, 8, 10) == (0, "presupuesto")
        assert resolve_waste("", None, 8, 10) == (8, "plantilla")


class TestQuantify:
    def test_formula_uses_q_and_params(self):
        params = {"espesor": 0.2}
        assert quantify({"formula": "Q * espesor"}, 20, params) == {"cantidad": 4.0}

    def test_one_template_many_thicknesses(self):
        r = {"formula": "Q * espesor"}
        for espesor, expected in ((0.15, 3.0), (0.20, 4.0), (0.30, 6.0)):
            assert quantify(r, 20, {"espesor": espesor})["cantidad"] == pytest.approx(expected)

    def test_fixed_number_formula(self):
        assert quantify({"formula": "3"}, 20, {}) == {"cantidad": 3.0}

    def test_legacy_per_unit(self):
        assert quantify({"cantidad_por_unidad": 0.5}, 20, {}) == {"cantidad": 10.0}

    def test_labor_by_rendimiento(self):
        # 3 workers, 10 m2 per day, 25 m2 -> 2.5 days
        result = quantify({"tipo": "mano_obra", "trabajadores": 3, "rendimiento": 10}, 25, {})
        assert result == {"trabajadores": 3.0, "dias": 2.5}

    def test_labor_rendimiento_formula(self):
        result = quantify({"tipo": "mano_obra", "rendimiento": "base * 2"}, 20, {"base": 5})
        assert result == {"trabajadores": 1.0, "dias": 2.0}

    def test_labor_legacy(self):
        r = {"tipo": "mano_obra", "trabajadores_por_unidad": 0.1, "dias_por_unidad": 2}
        assert quantify(r, 10, {}) == {"trabajadores": 1.0, "dias": 2.0}

    def test_labor_zero_rendimiento(self):
        with pytest.raises(FormulaError):
            labor_days(10, 0, {})

    def test_bad_formula_raises(self):
        with pytest.raises(FormulaError):
            quantify({"formula": "Q * nada"}, 1, {})


class TestExpandResource:
    def test_material_row(self):
        r = {"tipo": "material", "codigo": "H30", "descripcion": "Hormigón", "unidad": "m3",
             "formula": "Q * espesor", "redondear": True, "unidad_compra": 0.5}
        row = expand_resource(r, 20, {"espesor": 0.2}, organizacion_pct=10)
        assert row["cantidad"] == 4.0
        assert row["desperdicio_pct"] == 10
        assert row["desperdicio_origen"] == "organizacion"
        assert row["formula"] == "Q * espesor"
        assert row["redondear"] is True and row["unidad_compra"] == 0.5
        assert row["lo_compra_cliente"] is False

    def test_labor_row(self):
        row = expand_resource({"tipo": "mano_obra", "trabajadores": 2, "rendimiento": 5}, 10, {},
                              organizacion_pct=10)
        assert row["unidad"] == "jornal"
        assert row["trabajadores"] == 2 and row["dias"] == 2
        assert row["desperdicio_pct"] == 0 and row["desperdicio_origen"] is None
        assert row["rendimiento"] == "5"

    def test_template_waste_inherited(self):
        row = expand_resource({"tipo": "material", "formula": "Q"}, 1, {},
                              plantilla_pct=7, organizacion_pct=10)
        assert (row["desperdicio_pct"], row["desperdicio_origen"]) == (7, "plantilla")


class TestRequantify:
    def test_formula_row_follows_q(self):
        row = {"tipo": "material", "formula": "Q * espesor", "cantidad": 4}
        requantify_row(row, 30, {"espesor": 0.2})
        assert row["cantidad"] == pytest.approx(6)

    def test_labor_row_follows_q(self):
        row = {"tipo": "mano_obra", "rendimiento": "10", "dias": 1, "trabajadores": 3}
        requantify_row(row, 50, {})
        assert row["dias"] == 5 and row["trabajadores"] == 3

    def test_fixed_row_untouched(self):
        row = {"tipo": "material", "cantidad": 7}
        requantify_row(row, 50, {})
        assert row["cantidad"] == 7
        assert not has_formula(row)


class TestClientMaterial:
    def test_costs_zero_but_keeps_quantity(self):
        row = {"tipo": "material", "cantidad": 10, "desperdicio_pct": 10,
               "precio_unitario": 100, "lo_compra_cliente": True}
        calc_resource_subtotal(row)
        assert row["cantidad_efectiva"] == 11
        assert row["subtotal"] == 0

    def test_not_added_to_item(self):
        resources = [
            {"tipo": "material", "subtotal": 500},
            {"tipo": "material", "subtotal": 900, "lo_compra_cliente": True},
        ]
        item = calc_item_from_resources({"cantidad": 10}, resources)
        assert item["mat_total"] == 500


class TestPurchaseRounding:
    def _row(self, item_id, efectiva, precio=100, **kw):
        return {"item_id": item_id, "tipo": "material", "codigo": "CEM", "descripcion": "Cemento",
                "unidad": "bolsa", "cantidad_efectiva": efectiva, "precio_unitario": precio,
                "subtotal": round(efectiva * precio, 2), "redondear": True, "unidad_compra": 1, **kw}

    def test_rounds_budget_total_not_each_item(self):
        # 3 items need 0.4 bags each: 1.2 bags -> buy 2 (not 3)
        rows = [self._row(f"i{n}", 0.4) for n in range(3)]
        summary = apply_purchase_rounding(rows)
        assert len(summary) == 1
        assert summary[0]["cantidad_necesaria"] == pytest.approx(1.2)
        assert summary[0]["envases"] == 2
        assert summary[0]["cantidad_compra"] == 2
        assert summary[0]["costo_extra"] == pytest.approx(80)
        assert sum(r["cantidad_efectiva"] for r in rows) == pytest.approx(2)
        assert sum(r["subtotal"] for r in rows) == pytest.approx(200)

    def test_extra_split_by_share(self):
        rows = [self._row("a", 0.3), self._row("b", 0.9)]
        apply_purchase_rounding(rows)
        assert rows[0]["cantidad_redondeo"] == pytest.approx(0.2)
        assert rows[1]["cantidad_redondeo"] == pytest.approx(0.6)

    def test_purchase_unit_size(self):
        # 130 kg of cement in 50 kg bags -> 150 kg (3 bags)
        rows = [self._row("a", 80, precio=2, unidad_compra=50), self._row("b", 50, precio=2, unidad_compra=50)]
        summary = apply_purchase_rounding(rows)
        assert summary[0]["envases"] == 3
        assert summary[0]["cantidad_compra"] == 150
        assert sum(r["cantidad_efectiva"] for r in rows) == pytest.approx(150)

    def test_exact_amount_no_extra(self):
        rows = [self._row("a", 1.0), self._row("b", 1.0)]
        summary = apply_purchase_rounding(rows)
        assert summary[0]["extra"] == 0
        assert rows[0]["cantidad_efectiva"] == 1.0

    def test_float_noise_does_not_add_a_bag(self):
        rows = [self._row("a", 0.1), self._row("b", 0.2), self._row("c", 0.7)]
        summary = apply_purchase_rounding(rows)
        assert summary[0]["envases"] == 1

    def test_only_marked_and_not_client(self):
        rows = [
            self._row("a", 0.5, redondear=False),
            self._row("b", 0.5, lo_compra_cliente=True),
            {**self._row("c", 0.5), "tipo": "mano_obra"},
        ]
        assert apply_purchase_rounding(rows) == []
        assert all(r["cantidad_efectiva"] == 0.5 for r in rows)

    def test_different_materials_apart(self):
        rows = [self._row("a", 0.5), {**self._row("b", 0.5), "codigo": "CAL"}]
        summary = apply_purchase_rounding(rows)
        assert len(summary) == 2

    def test_same_code_different_units_apart(self):
        # 4 kg + 4 l in packs of 10: 10 kg and 10 l, never one group of 8 -> 10
        rows = [
            self._row("a", 4, unidad="kg", unidad_compra=10),
            self._row("b", 4, unidad="l", unidad_compra=10),
        ]
        summary = apply_purchase_rounding(rows)
        assert len(summary) == 2
        assert {s["unidad"]: s["cantidad_compra"] for s in summary} == {"kg": 10, "l": 10}
        assert rows[0]["cantidad_efectiva"] == 10 and rows[1]["cantidad_efectiva"] == 10

    def test_unit_case_and_spaces_do_not_split(self):
        rows = [self._row("a", 0.4, unidad="Bolsa"), self._row("b", 0.4, unidad=" bolsa ")]
        summary = apply_purchase_rounding(rows)
        assert len(summary) == 1 and summary[0]["envases"] == 1

    def test_extra_cost_uses_each_row_price(self):
        # Same material, different prices: extra cost = sum of real increases
        # 0.4 + 0.4 = 0.8 -> 1 bag; extra 0.2 split 0.1 / 0.1
        rows = [self._row("a", 0.4, precio=100), self._row("b", 0.4, precio=300)]
        before = sum(r["subtotal"] for r in rows)
        summary = apply_purchase_rounding(rows)
        after = sum(r["subtotal"] for r in rows)
        assert summary[0]["costo_extra"] == pytest.approx(after - before)
        assert summary[0]["costo_extra"] == pytest.approx(0.1 * 100 + 0.1 * 300)
        # the old way (first row's price for the whole extra) would say 20

    def test_rerun_does_not_accumulate(self):
        rows = [self._row("a", 0.4)]
        apply_purchase_rounding(rows)
        # a recalculation starts again from the base quantity
        rows[0]["cantidad_efectiva"] = 0.4
        apply_purchase_rounding(rows)
        assert rows[0]["cantidad_efectiva"] == 1
