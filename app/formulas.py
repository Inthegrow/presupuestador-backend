"""Safe evaluator for template formulas.

Only numbers, variables, + - * / and parentheses are accepted. There is no
``eval``: the text is tokenized and parsed by a small recursive-descent parser.

    evaluate("Q * espesor", {"Q": 20, "espesor": 0.2})  -> 4.0

Grammar:
    expr   := term (("+" | "-") term)*
    term   := factor (("*" | "/") factor)*
    factor := ("+" | "-") factor | NUMBER | NAME | "(" expr ")"
"""

from __future__ import annotations

import re

MAX_LENGTH = 300
MAX_DEPTH = 30

# Number: 12, 0.20, 0,20 (Argentine decimal comma), .5
_TOKEN_RE = re.compile(
    r"\s*(?:(?P<num>\d+(?:[.,]\d+)?|[.,]\d+)|(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op>[-+*/()]))"
)
_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

RESERVED = {"Q"}


class FormulaError(ValueError):
    """Invalid formula or failed evaluation. The message is shown to the user."""


def _tokenize(text: str) -> list[tuple[str, str]]:
    if len(text) > MAX_LENGTH:
        raise FormulaError(f"La fórmula es muy larga (máximo {MAX_LENGTH} caracteres)")
    tokens: list[tuple[str, str]] = []
    pos = 0
    text = text.rstrip()
    while pos < len(text):
        match = _TOKEN_RE.match(text, pos)
        if not match or match.end() == pos:
            bad = text[pos:].lstrip()[:1]
            raise FormulaError(f"Carácter no permitido: '{bad}'")
        kind = match.lastgroup
        tokens.append((kind, match.group(kind)))
        pos = match.end()
    return tokens


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]], variables: dict[str, float] | None):
        self.tokens = tokens
        self.pos = 0
        self.variables = variables
        self.names: set[str] = set()
        self.depth = 0

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self) -> tuple[str, str]:
        token = self.peek()
        if token is None:
            raise FormulaError("La fórmula está incompleta")
        self.pos += 1
        return token

    def expr(self) -> float:
        value = self.term()
        while (token := self.peek()) and token[1] in ("+", "-"):
            self.take()
            right = self.term()
            value = value + right if token[1] == "+" else value - right
        return value

    def term(self) -> float:
        value = self.factor()
        while (token := self.peek()) and token[1] in ("*", "/"):
            self.take()
            right = self.factor()
            if token[1] == "*":
                value = value * right
            elif self.variables is None:
                value = 1.0  # validation only: do not divide
            elif right == 0:
                raise FormulaError("División por cero")
            else:
                value = value / right
        return value

    def factor(self) -> float:
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise FormulaError("La fórmula tiene demasiados paréntesis")
        try:
            kind, text = self.take()
            if text in ("+", "-"):
                value = self.factor()
                return -value if text == "-" else value
            if kind == "num":
                return float(text.replace(",", "."))
            if kind == "name":
                self.names.add(text)
                if self.variables is None:
                    return 1.0
                if text not in self.variables:
                    raise FormulaError(f"Variable desconocida: '{text}'")
                return float(self.variables[text])
            if text == "(":
                value = self.expr()
                if self.take()[1] != ")":
                    raise FormulaError("Falta cerrar un paréntesis")
                return value
            raise FormulaError(f"Símbolo inesperado: '{text}'")
        finally:
            self.depth -= 1


def _parse(text: str, variables: dict[str, float] | None) -> tuple[float, set[str]]:
    if text is None or not str(text).strip():
        raise FormulaError("La fórmula está vacía")
    parser = _Parser(_tokenize(str(text)), variables)
    value = parser.expr()
    if parser.peek() is not None:
        raise FormulaError(f"Símbolo inesperado: '{parser.peek()[1]}'")
    return value, parser.names


def variables_in(text: str) -> set[str]:
    """Names used by a formula. Raises FormulaError if the syntax is invalid."""
    return _parse(text, None)[1]


def validate(text: str, allowed: set[str]) -> None:
    """Check syntax and that every variable is in ``allowed``."""
    unknown = sorted(variables_in(text) - set(allowed))
    if unknown:
        raise FormulaError(f"Variable desconocida: '{unknown[0]}'")


def evaluate(text: str, variables: dict[str, float]) -> float:
    """Evaluate a formula with the given variables."""
    return _parse(text, variables)[0]


def is_valid_name(name: str) -> bool:
    return bool(name) and bool(_NAME_RE.match(name)) and name not in RESERVED
