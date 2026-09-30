"""Tests for the safe formula evaluator (Fase 2)."""

from __future__ import annotations

import pytest

from app.formulas import FormulaError, evaluate, is_valid_name, validate, variables_in


class TestEvaluate:
    @pytest.mark.parametrize("text,expected", [
        ("Q * espesor", 4.0),
        ("Q / 100", 0.2),
        ("espesor * ancho_viga * ml_vigas", 0.2 * 0.7 * 12),
        ("2 + 3 * 4", 14),
        ("(2 + 3) * 4", 20),
        ("10 - 4 - 3", 3),
        ("100 / 10 / 2", 5),
        ("-Q + 30", 10),
        ("--2", 2),
        ("+3", 3),
        ("Q*(1+espesor)", 24),
        ("0,5 * Q", 10),  # decimal comma
        (".5 * 2", 1),
        ("  Q  ", 20),
        ("7", 7),
    ])
    def test_values(self, text, expected):
        variables = {"Q": 20, "espesor": 0.2, "ancho_viga": 0.7, "ml_vigas": 12}
        assert evaluate(text, variables) == pytest.approx(expected)

    def test_division_by_zero(self):
        with pytest.raises(FormulaError, match="cero"):
            evaluate("Q / x", {"Q": 1, "x": 0})

    def test_unknown_variable(self):
        with pytest.raises(FormulaError, match="desconocida: 'espesor'"):
            evaluate("Q * espesor", {"Q": 1})

    @pytest.mark.parametrize("text", ["", "   ", None])
    def test_empty(self, text):
        with pytest.raises(FormulaError):
            evaluate(text, {"Q": 1})

    @pytest.mark.parametrize("text", [
        "Q *", "(Q + 1", "Q + 1)", "Q Q", "3 4", "*2", "()",
    ])
    def test_bad_syntax(self, text):
        with pytest.raises(FormulaError):
            evaluate(text, {"Q": 1})


class TestNoCodeExecution:
    """Anything that is not arithmetic must be rejected, never executed."""

    @pytest.mark.parametrize("text", [
        "__import__('os').system('ls')",
        "open('x')",
        "Q.__class__",
        "Q ** 2",
        "Q % 2",
        "[1, 2]",
        "{'a': 1}",
        "lambda: 1",
        "Q; 1",
        "Q if 1 else 2",
        "'texto'",
        "Q == 1",
        "abs(Q)",
        "1e999",
    ])
    def test_rejected(self, text):
        with pytest.raises(FormulaError):
            evaluate(text, {"Q": 1, "abs": 1, "e999": 1, "lambda": 1})

    def test_too_long(self):
        with pytest.raises(FormulaError, match="larga"):
            evaluate("1+" * 200 + "1", {})

    def test_too_deep(self):
        with pytest.raises(FormulaError, match="paréntesis"):
            evaluate("(" * 40 + "1" + ")" * 40, {})


class TestValidate:
    def test_variables_in(self):
        assert variables_in("Q * espesor + ancho / 2") == {"Q", "espesor", "ancho"}

    def test_validate_ok(self):
        validate("Q * espesor", {"Q", "espesor"})

    def test_validate_does_not_divide(self):
        # Validation must not fail on "/ x" even if x could be 0 at runtime
        validate("Q / x", {"Q", "x"})

    def test_validate_unknown(self):
        with pytest.raises(FormulaError, match="espesor"):
            validate("Q * espesor", {"Q"})

    def test_is_valid_name(self):
        assert is_valid_name("espesor")
        assert is_valid_name("ml_vigas2")
        assert not is_valid_name("Q")
        assert not is_valid_name("2x")
        assert not is_valid_name("con espacio")
        assert not is_valid_name("")
