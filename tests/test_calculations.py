"""Tests for app.calculations — pure cost calculation functions."""

from app.calculations import (
    calc_budget_summary,
    calc_cascade_indirects,
    calc_item_totals,
    calc_resource_subtotal,
    fraction_to_pct,
    pct_or_default,
    recalc_all_items,
)


class TestCalcItemTotals:
    def test_basic_calculation(self):
        item = {"cantidad": 10, "mat_unitario": 100, "mo_unitario": 50}
        result = calc_item_totals(item)
        assert result["mat_total"] == 1000.0
        assert result["mo_total"] == 500.0
        assert result["directo_total"] == 1500.0
        assert result["neto_total"] == 1500.0

    def test_with_indirecto_and_beneficio(self):
        item = {
            "cantidad": 5,
            "mat_unitario": 200,
            "mo_unitario": 100,
            "indirecto_total": 150,
            "beneficio_total": 75,
        }
        result = calc_item_totals(item)
        assert result["mat_total"] == 1000.0
        assert result["mo_total"] == 500.0
        assert result["directo_total"] == 1500.0
        assert result["indirecto_total"] == 150.0
        assert result["beneficio_total"] == 75.0
        assert result["neto_total"] == 1725.0  # 1500 + 150 + 75

    def test_zero_quantity(self):
        item = {"cantidad": 0, "mat_unitario": 100, "mo_unitario": 50}
        result = calc_item_totals(item)
        assert result["mat_total"] == 0.0
        assert result["mo_total"] == 0.0
        assert result["directo_total"] == 0.0
        assert result["neto_total"] == 0.0

    def test_none_values(self):
        item = {"cantidad": None, "mat_unitario": None, "mo_unitario": None}
        result = calc_item_totals(item)
        assert result["mat_total"] == 0.0
        assert result["mo_total"] == 0.0
        assert result["directo_total"] == 0.0
        assert result["neto_total"] == 0.0

    def test_missing_keys(self):
        """Item with no cost-related keys at all."""
        item = {"description": "Seccion header"}
        result = calc_item_totals(item)
        assert result["mat_total"] == 0.0
        assert result["mo_total"] == 0.0
        assert result["directo_total"] == 0.0
        assert result["neto_total"] == 0.0
        # Original keys preserved
        assert result["description"] == "Seccion header"

    def test_preserves_extra_fields(self):
        item = {
            "id": "abc-123",
            "code": "1.1",
            "description": "Hormigon",
            "cantidad": 2,
            "mat_unitario": 300,
            "mo_unitario": 150,
        }
        result = calc_item_totals(item)
        assert result["id"] == "abc-123"
        assert result["code"] == "1.1"
        assert result["description"] == "Hormigon"

    def test_rounding(self):
        item = {"cantidad": 3, "mat_unitario": 10.333, "mo_unitario": 5.777}
        result = calc_item_totals(item)
        assert result["mat_total"] == 31.0  # 3 * 10.333 = 30.999 -> 31.0
        assert result["mo_total"] == 17.33  # 3 * 5.777 = 17.331 -> 17.33
        assert result["directo_total"] == 48.33

    def test_string_numeric_values(self):
        """safe_float should handle string numbers."""
        item = {"cantidad": "10", "mat_unitario": "100.5", "mo_unitario": "50"}
        result = calc_item_totals(item)
        assert result["mat_total"] == 1005.0
        assert result["mo_total"] == 500.0

    def test_only_indirecto_no_directo(self):
        """Edge case: indirecto set but no quantity/unit costs."""
        item = {"indirecto_total": 500, "beneficio_total": 200}
        result = calc_item_totals(item)
        assert result["directo_total"] == 0.0
        assert result["neto_total"] == 700.0


class TestCalcBudgetSummary:
    def test_basic_summary(self):
        items = [
            {"mat_total": 1000, "mo_total": 500, "directo_total": 1500,
             "indirecto_total": 100, "beneficio_total": 50, "neto_total": 1650},
            {"mat_total": 2000, "mo_total": 1000, "directo_total": 3000,
             "indirecto_total": 200, "beneficio_total": 100, "neto_total": 3300},
        ]
        result = calc_budget_summary(items)
        assert result["mat_total"] == 3000.0
        assert result["mo_total"] == 1500.0
        assert result["directo_total"] == 4500.0
        assert result["indirecto_total"] == 300.0
        assert result["beneficio_total"] == 150.0
        assert result["neto_total"] == 4950.0
        assert result["items_count"] == 2

    def test_empty_list(self):
        result = calc_budget_summary([])
        assert result["mat_total"] == 0.0
        assert result["mo_total"] == 0.0
        assert result["directo_total"] == 0.0
        assert result["indirecto_total"] == 0.0
        assert result["beneficio_total"] == 0.0
        assert result["neto_total"] == 0.0
        assert result["items_count"] == 0

    def test_items_with_none_fields(self):
        items = [
            {"mat_total": None, "mo_total": 500, "directo_total": 500,
             "indirecto_total": None, "beneficio_total": None, "neto_total": 500},
            {"mat_total": 1000, "mo_total": None, "directo_total": 1000,
             "indirecto_total": 100, "beneficio_total": 50, "neto_total": 1150},
        ]
        result = calc_budget_summary(items)
        assert result["mat_total"] == 1000.0
        assert result["mo_total"] == 500.0
        assert result["directo_total"] == 1500.0
        assert result["indirecto_total"] == 100.0
        assert result["neto_total"] == 1650.0

    def test_single_item(self):
        items = [
            {"mat_total": 500, "mo_total": 250, "directo_total": 750,
             "indirecto_total": 0, "beneficio_total": 0, "neto_total": 750},
        ]
        result = calc_budget_summary(items)
        assert result["items_count"] == 1
        assert result["neto_total"] == 750.0

    def test_items_with_missing_keys(self):
        """Items that lack some total keys (e.g. header rows)."""
        items = [
            {"description": "Header row"},
            {"mat_total": 1000, "mo_total": 500, "directo_total": 1500,
             "indirecto_total": 0, "beneficio_total": 0, "neto_total": 1500},
        ]
        result = calc_budget_summary(items)
        assert result["mat_total"] == 1000.0
        assert result["items_count"] == 2


class TestRecalcAllItems:
    def test_recalculates_all(self):
        items = [
            {"cantidad": 10, "mat_unitario": 100, "mo_unitario": 50,
             "mat_total": 0, "mo_total": 0, "directo_total": 0, "neto_total": 0},
            {"cantidad": 5, "mat_unitario": 200, "mo_unitario": 80,
             "mat_total": 0, "mo_total": 0, "directo_total": 0, "neto_total": 0},
        ]
        result = recalc_all_items(items)
        assert len(result) == 2
        assert result[0]["mat_total"] == 1000.0
        assert result[0]["mo_total"] == 500.0
        assert result[0]["directo_total"] == 1500.0
        assert result[1]["mat_total"] == 1000.0
        assert result[1]["mo_total"] == 400.0
        assert result[1]["directo_total"] == 1400.0

    def test_empty_list(self):
        assert recalc_all_items([]) == []

    def test_preserves_indirecto(self):
        items = [
            {"cantidad": 10, "mat_unitario": 100, "mo_unitario": 50,
             "indirecto_total": 200, "beneficio_total": 100},
        ]
        result = recalc_all_items(items)
        assert result[0]["indirecto_total"] == 200.0
        assert result[0]["beneficio_total"] == 100.0
        assert result[0]["neto_total"] == 1800.0  # 1500 + 200 + 100

    def test_does_not_mutate_originals(self):
        items = [
            {"cantidad": 10, "mat_unitario": 100, "mo_unitario": 50,
             "mat_total": 0},
        ]
        recalc_all_items(items)
        assert items[0]["mat_total"] == 0  # original unchanged


class TestPctOrDefault:
    def test_missing_uses_default(self):
        assert pct_or_default({}, "beneficio_pct", 10) == 10

    def test_none_and_empty_use_default(self):
        assert pct_or_default({"beneficio_pct": None}, "beneficio_pct", 10) == 10
        assert pct_or_default({"beneficio_pct": ""}, "beneficio_pct", 10) == 10

    def test_explicit_zero_is_respected(self):
        assert pct_or_default({"beneficio_pct": 0}, "beneficio_pct", 10) == 0


ZERO_CONFIG = {
    "imprevistos_pct": 0, "estructura_pct": 0, "jefatura_pct": 0,
    "logistica_pct": 0, "herramientas_pct": 0, "beneficio_pct": 0,
    "ingresos_brutos_pct": 0, "imp_cheque_pct": 0, "iva_pct": 0,
}


class TestCascadeZeroPercentages:

    def test_all_zero_leaves_directo_untouched(self):
        item = calc_cascade_indirects({"directo_total": 1000}, dict(ZERO_CONFIG))
        assert item["indirecto_total"] == 0
        assert item["beneficio_total"] == 0
        assert item["impuestos_total"] == 0
        assert item["iva_total"] == 0
        assert item["total_final"] == 1000

    def test_zero_beneficio_only(self):
        config = {**ZERO_CONFIG, "estructura_pct": 10}
        item = calc_cascade_indirects({"directo_total": 1000}, config)
        assert item["indirecto_total"] == 100
        assert item["beneficio_total"] == 0

    def test_missing_config_uses_defaults(self):
        item = calc_cascade_indirects({"directo_total": 1000}, {})
        # 3 + 15 + 8 + 5 + 3 = 34% indirectos
        assert item["indirecto_total"] == 340


class TestResourceZeroCargas:
    def test_zero_cargas_sociales_is_respected(self):
        r = calc_resource_subtotal({
            "tipo": "mano_obra", "trabajadores": 2, "dias": 5,
            "cargas_sociales_pct": 0, "precio_unitario": 100,
        })
        assert r["cantidad_efectiva"] == 10
        assert r["subtotal"] == 1000

    def test_missing_cargas_defaults_to_25(self):
        r = calc_resource_subtotal({
            "tipo": "mano_obra", "trabajadores": 2, "dias": 5, "precio_unitario": 100,
        })
        assert r["cantidad_efectiva"] == 12.5


class TestFractionToPct:
    def test_fraction_becomes_percent(self):
        assert fraction_to_pct(0.1) == 10
        assert fraction_to_pct(0.25) == 25
        assert fraction_to_pct(1) == 100

    def test_percent_is_kept(self):
        assert fraction_to_pct(15) == 15

    def test_empty_values(self):
        assert fraction_to_pct(None) == 0
        assert fraction_to_pct(0) == 0
