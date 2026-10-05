"""Parse the recipes of TERRAC's "Maestro" (one solapa per item) and its CYP tree.

Pure parsing and reporting, no database access: see import_recetas.py for the
command-line script that writes to Supabase.

Each item solapa (4.1.1, 5.1.1, ...) has:
- A title row (row 1, 2 or 3): B = name, H = example quantity ("cantidad
  maestra"), I = unit.
- Sections MATERIALES, MANO DE OBRA - PERSONAS / EQUIPOS / MATERIALES /
  SUBCONTRATOS. Each resource row: A = código, D = cantidad, E = días (labor
  and equipment), F = desperdicio (fraction).

Translation to the system (app/recipes.py):
- The quantity cell (H3) becomes ``Q``.
- Other cells the formulas use (K5 = altura, M4 = ml de vigas) become template
  parameters with their Excel value. If such a cell depends on H3 it is
  inlined instead (L5 = H3/K5 -> ``(Q/altura_m)``).
- A cell of another resource (``=D7``) is inlined with its own formula.
- Labor days ``=H3/15`` become ``rendimiento = 15`` (Q units per day).
  Fixed days (3 oficiales x 20 días for 194 m2) become the equivalent
  rendimiento (194/20 = 9.7 m2 per day) and are marked "revisar".
- Fixed numbers are loaded as they are, marked "revisar".

The workbook must be loaded twice with openpyxl: once with formulas and once
with ``data_only=True`` (cached values, used for parameters and checks).
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime

from app.catalog_prices import normalize_codigo
from app.formulas import FormulaError, evaluate, validate

# Order matters: "MATERIALES" is also the end of "MANO DE OBRA - MATERIALES"
SECTIONS: list[tuple[str, str]] = [
    ("MANO DE OBRA - PERSONAS", "mano_obra"),
    ("MANO DE OBRA - EQUIPOS", "equipo"),
    ("MANO DE OBRA - MATERIALES", "mo_material"),
    ("MANO DE OBRA - SUBCONTRATOS", "subcontrato"),
    ("MATERIALES", "material"),
]

# Catalog where each resource tipo looks up its code
CATALOG_OF_TIPO = {
    "material": "material",
    "mo_material": "material",
    "mano_obra": "mano_obra",
    "equipo": "equipo",
    "subcontrato": "subcontrato",
}

# Excel rounds these up to whole purchase units (ROUNDUP(...;0)); the system
# does it on the budget total instead of per item.
ROUNDED_TIPOS = {"material", "mo_material"}

NOT_RECIPE_SHEETS = {"Condiciones", "00_Mat", "00_MO", "00_Eq", "00_Sub", "CYP"}

# ── Decisions of the meeting with Sol (29/9) ─────────────────────────────────
# Sheet -> item code. AGREGADO is the zócalo: it goes in 7.1.4 (revestimientos).
SHEET_CODE_OVERRIDES = {"AGREGADO": "7.1.4"}
# Sheets not loaded, and why
SKIPPED_SHEETS = {
    "7.1.4.": "Se usó la solapa AGREGADO para el zócalo (decisión con Sol). "
              "Esta solapa tenía solo mano de obra (25 ml/día) y el material sin cantidad.",
}
# Premarcos: labor always, material optional (parameter con_material, 0 = no)
PREMARCOS = {"7.2": "7.2.1", "7.3": "7.3.1"}
# Items removed from the tree (prefix match on the código)
REMOVED_CODES = {"5.6": "5.6 Recuadros se elimina: ya está en revoques (decisión con Sol)."}
# Empty free items (no recipe)
FREE_ITEMS = {
    "7.5": ("7.5.1", "Otras terminaciones (ítem libre)"),
    "9": ("9.1", "Cubierta (ítem libre)"),
}
# Subrubros the system solves with floors (pisos)
PER_FLOOR_CODES = {"4.3", "4.4", "4.5"}

_REF_RE = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)")
_FUNC_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*\s*\(")
_UNITS = {"m²": "m2", "m³": "m3", "unid": "u", "un": "u", "ml": "ml"}


# ── Small helpers ────────────────────────────────────────────────────────────


def _text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip() if value is not None else ""


def _is_formula(value: object) -> bool:
    return isinstance(value, str) and value.startswith("=")


def _num(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def fmt_num(value: float) -> str:
    """Short number text: 20.0 -> '20', 9.7 -> '9.7', 1/3 -> '0.333333'."""
    text = f"{round(value, 6):.6f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def normalize_unit(value: object) -> str:
    text = _text(value)
    return _UNITS.get(text.lower(), text.lower())


def sheet_code(sheet_name: str) -> str:
    """Item code of a solapa: '7.1.4.' -> '7.1.4', 'AGREGADO' -> '7.1.4'."""
    if sheet_name in SHEET_CODE_OVERRIDES:
        return SHEET_CODE_OVERRIDES[sheet_name]
    return sheet_name.strip().rstrip(".")


def slug(text: str, max_len: int = 20) -> str:
    """Parameter name from a label: 'ALTURA (M)' -> 'altura_m'."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    words = re.findall(r"[a-z0-9]+", text.lower())
    out = ""
    for word in words:
        candidate = f"{out}_{word}" if out else word
        if len(candidate) > max_len:
            break
        out = candidate
    if out and out[0].isdigit():
        out = f"p_{out}"
    return out


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def _col_letters(index: int) -> str:
    out = ""
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


# ── Sheet reading ────────────────────────────────────────────────────────────


class _Sheet:
    """Formula and value views of one solapa."""

    def __init__(self, ws_formulas, ws_values):  # type: ignore[no-untyped-def]
        self.f = ws_formulas
        self.v = ws_values

    def formula(self, ref: str) -> object:
        return self.f[ref].value

    def value(self, ref: str) -> object:
        return self.v[ref].value if self.v is not None else None


def find_title_row(sheet: _Sheet) -> int | None:
    """First row (1..4) with a text name in B and a number in H."""
    for row in range(1, 5):
        name = sheet.formula(f"B{row}")
        qty = sheet.formula(f"H{row}")
        if isinstance(name, str) and not _is_formula(name) and name.strip() and _num(qty) is not None:
            return row
    return None


def _section_of(text: str) -> str | None:
    upper = _text(text).upper()
    for label, tipo in SECTIONS:
        if upper == label:
            return tipo
    return None


def resource_rows(sheet: _Sheet, start: int) -> list[tuple[int, str]]:
    """(row, tipo) of every resource row, in order."""
    rows = []
    section = None
    for row in range(start + 1, sheet.f.max_row + 1):
        a = sheet.formula(f"A{row}")
        a_text = _text(a)
        tipo = _section_of(a_text) if isinstance(a, str) else None
        if tipo:
            section = tipo
            continue
        if section is None:
            continue
        upper = a_text.upper()
        if upper.startswith("TOTAL") or upper == "CÓDIGO" or upper == "CODIGO":
            continue
        if _is_formula(a):
            continue
        b = sheet.formula(f"B{row}")
        has_literal_b = isinstance(b, str) and not _is_formula(b) and b.strip()
        if a_text or has_literal_b:
            rows.append((row, section))
    return rows


# ── Formula translation ──────────────────────────────────────────────────────


class Unsupported(ValueError):
    """The Excel formula cannot be expressed as a system formula."""


class Translator:
    """Translate the Excel formulas of one solapa to system formulas."""

    MAX_DEPTH = 8

    def __init__(self, sheet: _Sheet, title_row: int, resource_row_numbers: set[int]):
        self.sheet = sheet
        self.q_ref = f"H{title_row}"
        self.q_value = _num(sheet.formula(self.q_ref)) or 0.0
        self.resource_rows = resource_row_numbers
        self.parametros: list[dict] = []
        self._param_by_ref: dict[str, str] = {}
        self.notes: list[str] = []  # for the current expression

    # Public API
    def translate(self, raw: object) -> tuple[str, list[str]]:
        """Return (formula, notes). Raises Unsupported."""
        self.notes = []
        text = self._expr(raw, depth=0)
        return text, list(dict.fromkeys(self.notes))

    def param_values(self) -> dict[str, float]:
        return {p["clave"]: p["valor"] for p in self.parametros}

    # Internals
    def _expr(self, raw: object, depth: int) -> str:
        if depth > self.MAX_DEPTH:
            raise Unsupported("demasiadas celdas encadenadas")
        if _num(raw) is not None:
            return fmt_num(float(raw))
        if not _is_formula(raw):
            raise Unsupported(f"valor no numérico: {raw!r}")
        body = str(raw)[1:].strip()
        if "!" in body:
            raise Unsupported("usa otra solapa")
        func = _FUNC_RE.search(body)
        if func:
            raise Unsupported(f"usa una función de Excel ({func.group(0).rstrip('(').strip()})")
        if "^" in body or "%" in body or "&" in body:
            raise Unsupported("usa un operador que el sistema no admite")

        def repl(match: re.Match) -> str:
            return self._ref(match.group(1), int(match.group(2)), depth)

        return _REF_RE.sub(repl, body).replace(" ", "")

    def _ref(self, col: str, row: int, depth: int) -> str:
        ref = f"{col}{row}"
        if ref == self.q_ref:
            return "Q"
        if col == "H" and row <= 4 and self.sheet.formula(ref) in (None, ""):
            # Copy-paste: the formula uses H3 but the quantity is in H1/H2
            self.notes.append(
                f"La fórmula usaba {ref}, que está vacía; la cantidad está en {self.q_ref}. Se tomó como Q."
            )
            return "Q"
        if row in self.resource_rows and _col_index(col) <= 10:
            if col == "D":
                return f"({self._expr(self.sheet.formula(ref), depth + 1)})"
            raise Unsupported(f"usa la celda {ref} (columna {col} de otro recurso: precio o subtotal)")
        if _col_index(col) <= 9 and row <= 4:
            raise Unsupported(f"usa la celda {ref} del título")
        return self._aux(ref, col, row, depth)

    def _aux(self, ref: str, col: str, row: int, depth: int) -> str:
        """Auxiliary cell: inline it if it depends on Q, else make it a parameter."""
        if ref in self._param_by_ref:
            return self._param_by_ref[ref]
        raw = self.sheet.formula(ref)
        if _is_formula(raw):
            saved = self.notes
            n_params, by_ref = len(self.parametros), dict(self._param_by_ref)
            self.notes = []
            inner = self._expr(raw, depth + 1)
            inner_notes = self.notes
            self.notes = saved + inner_notes
            if re.search(r"\bQ\b", inner):
                return f"({inner})"
            fixed = self._fix_example_quantity(ref, raw, inner)
            if fixed:
                return fixed
            # A constant cell: one parameter with its value, not one per cell it uses
            self.parametros, self._param_by_ref = self.parametros[:n_params], by_ref
            self.notes = saved
            value = _num(self.sheet.value(ref))
            if value is None:
                try:
                    value = evaluate(inner, self.param_values())
                except FormulaError as exc:
                    raise Unsupported(f"no se pudo calcular la celda {ref}") from exc
            return self._new_param(ref, col, row, value, origen=str(raw))
        value = _num(raw)
        if value is None:
            if raw in (None, ""):
                self.notes.append(f"La celda {ref} está vacía: se cargó el parámetro en 0.")
                return self._new_param(ref, col, row, 0.0, origen="(vacía)")
            raise Unsupported(f"la celda {ref} no es un número ({raw!r})")
        return self._new_param(ref, col, row, value, origen="valor")

    def _fix_example_quantity(self, ref: str, raw: str, inner: str) -> str | None:
        """'=30/K5' when H3 = 30: the example quantity typed by hand instead of H3."""
        if not self.q_value or self.q_value == 1:
            return None
        q_text = fmt_num(self.q_value)
        pattern = rf"(?<![\w.]){re.escape(q_text)}(?![\w.])"
        if not re.search(pattern, inner):
            return None
        fixed = re.sub(pattern, "Q", inner)
        self.notes.append(
            f"La celda {ref} dice {raw}: {q_text} es la cantidad de ejemplo escrita a mano "
            f"en vez de {self.q_ref}. Se tomó como Q."
        )
        return f"({fixed})"

    def _new_param(self, ref: str, col: str, row: int, value: float, origen: str) -> str:
        label = self._label(col, row)
        base = slug(label) if label else ""
        if not base or base == "q":
            base = f"celda_{ref.lower()}"
        name = base
        used = {p["clave"] for p in self.parametros}
        n = 2
        while name in used:
            name = f"{base}_{n}"
            n += 1
        desc = f"Celda {ref} del Excel"
        if label:
            desc += f": {label}"
        if origen not in ("valor", "(vacía)"):
            desc += f" ({origen})"
        self.parametros.append({"clave": name, "valor": round(value, 6), "unidad": None,
                                "descripcion": desc})
        self._param_by_ref[ref] = name
        return name

    def _label(self, col: str, row: int) -> str:
        """Nearest text: up to 3 cells above, 3 to the left, then 1 to the right."""
        ci = _col_index(col)
        candidates = [f"{col}{r}" for r in range(row - 1, max(row - 4, 0), -1)]
        candidates += [f"{_col_letters(c)}{row}" for c in range(ci - 1, max(ci - 4, 0), -1)]
        candidates.append(f"{_col_letters(ci + 1)}{row}")
        for cand in candidates:
            value = self.sheet.formula(cand)
            if isinstance(value, str) and not _is_formula(value):
                text = _text(value)
                if text and not text.lower().startswith("http") and re.search(r"[A-Za-z]", text):
                    return text
        return ""


def uses_q_or_params(formula: str, params: dict[str, float]) -> bool:
    names = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", formula))
    return "Q" in names or bool(names & set(params))


def _linear_rate(formula: str, params: dict[str, float]) -> float | None:
    """If dias = k * Q, return rendimiento 1/k. Else None."""
    try:
        d0 = evaluate(formula, {**params, "Q": 0.0})
        d1 = evaluate(formula, {**params, "Q": 1.0})
        d2 = evaluate(formula, {**params, "Q": 2.0})
    except FormulaError:
        return None
    if abs(d0) > 1e-9 or d1 <= 0 or abs(d2 - 2 * d1) > 1e-9:
        return None
    return 1.0 / d1


# ── Parse one solapa ─────────────────────────────────────────────────────────


def parse_recipe_sheet(sheet_name: str, ws_formulas, ws_values, catalog: dict[str, dict]) -> dict:  # type: ignore[no-untyped-def]
    """Parse one item solapa into a template dict with a per-resource review status.

    ``catalog`` maps normalized code -> {"tipos": {...}, "descripcion", "unidad", "count"}.
    """
    sheet = _Sheet(ws_formulas, ws_values)
    codigo = sheet_code(sheet_name)
    result: dict = {
        "codigo": codigo, "hoja": sheet_name, "nombre": "", "unidad": "",
        "cantidad_ejemplo": None, "parametros": [], "recursos": [], "omitidos": [],
        "notas": [],  # things to review
        "info": [],   # informational only
    }
    title_row = find_title_row(sheet)
    if title_row is None:
        result["notas"].append("No se encontró el título con la cantidad (columna H).")
        return result

    result["nombre"] = _text(sheet.formula(f"B{title_row}"))
    result["unidad"] = normalize_unit(sheet.formula(f"I{title_row}"))
    result["cantidad_ejemplo"] = _num(sheet.formula(f"H{title_row}"))
    q_example = result["cantidad_ejemplo"] or 0.0

    rows = resource_rows(sheet, title_row)
    tr = Translator(sheet, title_row, {r for r, _ in rows})

    for row, tipo in rows:
        parsed = _parse_resource(sheet, tr, row, tipo, q_example, catalog)
        if parsed.get("omitido"):
            result["omitidos"].append(parsed["omitido"])
        else:
            result["recursos"].append(parsed)

    result["parametros"] = tr.parametros
    return result


def _cell_formula(tr: Translator, raw: object) -> tuple[str | None, list[str], str | None]:
    """(formula, notes, error). formula None = empty cell."""
    if raw in (None, ""):
        return None, [], None
    try:
        formula, notes = tr.translate(raw)
        validate(formula, set(tr.param_values()) | {"Q"})
        return formula, notes, None
    except (Unsupported, FormulaError) as exc:
        return None, [], str(exc)


def _parse_resource(sheet: _Sheet, tr: Translator, row: int, tipo: str, q_example: float,
                    catalog: dict[str, dict]) -> dict:
    raw_code = sheet.formula(f"A{row}")
    codigo = normalize_codigo(raw_code) if not isinstance(raw_code, (datetime, date)) else ""
    literal_b = sheet.formula(f"B{row}")
    descripcion = _text(literal_b) if isinstance(literal_b, str) and not _is_formula(literal_b) else ""
    unidad = ""
    notas: list[str] = []
    revisar = False
    origen = f"{sheet.f.title}!fila {row}"

    entry = catalog.get(codigo) if codigo else None
    if codigo:
        if entry is None:
            notas.append(f"El código {codigo} no está en los catálogos (00_Mat, 00_MO, 00_Eq, 00_Sub).")
            revisar = True
        else:
            descripcion = entry["descripcion"] or descripcion
            unidad = entry["unidad"] or ""
            if CATALOG_OF_TIPO[tipo] not in entry["tipos"]:
                notas.append(f"El código {codigo} está en otro catálogo ({', '.join(sorted(entry['tipos']))}).")
            if entry["count"] > 1:
                notas.append(f"El código {codigo} está repetido en el catálogo: puede traer otro precio.")
                revisar = True
        if _text(raw_code) != codigo:
            notas.append(f"Código normalizado: '{_text(raw_code)}' → '{codigo}'.")
    else:
        notas.append("Recurso sin código: no va a traer precio del catálogo.")
        revisar = True
        price = _num(sheet.formula(f"H{row}"))
        if price:
            notas.append(f"En el Excel tenía un precio escrito a mano: {fmt_num(price)}.")

    name = codigo or descripcion or f"fila {row}"
    d_raw = sheet.formula(f"D{row}")
    e_raw = sheet.formula(f"E{row}")
    f_val = _num(sheet.formula(f"F{row}"))
    params = tr.param_values

    base = {"tipo": tipo, "codigo": codigo, "descripcion": descripcion, "unidad": unidad,
            "origen": origen}

    if tipo == "mano_obra":
        d_formula, d_notes, d_err = _cell_formula(tr, d_raw)
        e_formula, e_notes, e_err = _cell_formula(tr, e_raw)
        if d_err or e_err:
            return _fallback(base, sheet, row, tipo, q_example, notas, d_err or e_err)
        trab = evaluate(d_formula, {**params(), "Q": q_example}) if d_formula else 0.0
        dias_ex = evaluate(e_formula, {**params(), "Q": q_example}) if e_formula else 0.0
        if not trab or not dias_ex:
            return {"omitido": {"codigo": name, "fila": row, "tipo": tipo,
                                "motivo": "sin trabajadores o sin días"}}
        notas += d_notes + e_notes
        if d_notes or e_notes:
            revisar = True
        if d_formula and uses_q_or_params(d_formula, params()):
            notas.append(f"La cantidad de trabajadores dependía de la cantidad ({d_raw}): "
                         f"se cargó el valor del ejemplo ({fmt_num(trab)}).")
            revisar = True
        rate = _linear_rate(e_formula, params())
        if rate is not None:
            rendimiento = rate
        else:
            rendimiento = q_example / dias_ex if q_example else 0
            revisar = True
            if uses_q_or_params(e_formula, params()):
                notas.append(f"Días con fórmula no proporcional ({e_raw}): se convirtió a "
                             f"rendimiento con la cantidad de ejemplo.")
            else:
                notas.append(
                    f"Días fijos: {fmt_num(dias_ex)} días para {fmt_num(q_example)} unidades del "
                    f"ejemplo. Se cargó como rendimiento de {fmt_num(rendimiento)} por día."
                )
        if rendimiento <= 0:
            return _fallback(base, sheet, row, tipo, q_example, notas, "rendimiento no válido")
        return {**base, "trabajadores": round(trab, 6), "rendimiento": fmt_num(rendimiento),
                "cargas_sociales_pct": round((f_val or 0) * 100, 4),
                "revisar": revisar, "notas": notas}

    d_formula, d_notes, d_err = _cell_formula(tr, d_raw)
    if d_err:
        return _fallback(base, sheet, row, tipo, q_example, notas, d_err)
    formula = d_formula
    extra_notes = d_notes
    if tipo == "equipo" and e_raw not in (None, ""):
        e_formula, e_notes, e_err = _cell_formula(tr, e_raw)
        if e_err:
            return _fallback(base, sheet, row, tipo, q_example, notas, e_err)
        extra_notes += e_notes
        if formula in (None, "1"):
            formula = e_formula
        elif e_formula not in (None, "1"):
            formula = f"({formula})*({e_formula})"
    if formula is None:
        return {"omitido": {"codigo": name, "fila": row, "tipo": tipo, "motivo": "sin cantidad"}}
    try:
        example = evaluate(formula, {**params(), "Q": q_example})
    except FormulaError as exc:
        return _fallback(base, sheet, row, tipo, q_example, notas, str(exc))
    if example == 0 and not uses_q_or_params(formula, params()):
        return {"omitido": {"codigo": name, "fila": row, "tipo": tipo, "motivo": "cantidad 0"}}
    notas += extra_notes
    if extra_notes:
        revisar = True
    if not uses_q_or_params(formula, params()):
        notas.append(f"Número fijo ({fmt_num(example)}): no cambia con la cantidad del ítem.")
        revisar = True

    cached = _num(sheet.value(f"D{row}"))
    if tipo != "equipo" and cached is not None and abs(cached - example) > max(1e-6, abs(cached) * 1e-4):
        notas.append(f"Con la cantidad de ejemplo da {fmt_num(example)} y en el Excel {fmt_num(cached)}.")
        revisar = True

    res = {**base, "formula": formula,
           "desperdicio_pct": round(f_val * 100, 4) if f_val is not None else None,
           "revisar": revisar, "notas": notas}
    if tipo in ROUNDED_TIPOS:
        res.update({"redondear": True, "unidad_compra": 1})
    return res


def _fallback(base: dict, sheet: _Sheet, row: int, tipo: str, q_example: float,
              notas: list[str], error: str) -> dict:
    """Unsupported formula: load the Excel value as a fixed number, marked revisar."""
    notas = notas + [f"No se pudo traducir la fórmula ({error}): se cargó el valor del Excel como número fijo."]
    f_val = _num(sheet.formula(f"F{row}"))
    if tipo == "mano_obra":
        trab = _num(sheet.value(f"D{row}")) or 0.0
        dias = _num(sheet.value(f"E{row}")) or 0.0
        rend = q_example / dias if dias and q_example else 1.0
        return {**base, "trabajadores": trab, "rendimiento": fmt_num(rend),
                "cargas_sociales_pct": round((f_val or 0) * 100, 4), "revisar": True, "notas": notas}
    value = _num(sheet.value(f"D{row}")) or 0.0
    res = {**base, "formula": fmt_num(value),
           "desperdicio_pct": round(f_val * 100, 4) if f_val is not None else None,
           "revisar": True, "notas": notas}
    if tipo in ROUNDED_TIPOS:
        res.update({"redondear": True, "unidad_compra": 1})
    return res


# ── Catalog index ────────────────────────────────────────────────────────────


def catalog_index(entries_by_tipo: dict[str, list[dict]]) -> dict[str, dict]:
    """Code -> first description/unit, the catalogs it is in, and how many rows."""
    index: dict[str, dict] = {}
    for tipo, entries in entries_by_tipo.items():
        for e in entries:
            info = index.setdefault(e["codigo"], {"tipos": set(), "descripcion": e.get("descripcion"),
                                                  "unidad": e.get("unidad"), "count": 0})
            info["tipos"].add(tipo)
            info["count"] += 1
    return index


# ── CYP tree ─────────────────────────────────────────────────────────────────

_HEADER_RE = re.compile(r"^(\d+)\s*(?:-\s*(\d+))?\s*[-\s]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ].*)$")
_ITEM_CODE_RE = re.compile(r"^\d+(\.\d+)+\.?$")
_LEADING_CODE_RE = re.compile(r"^\d+(\.\d+)*(-\d+)?\s+")


def _parent_code(code: str, known: dict[str, dict]) -> str | None:
    parts = code.split(".")
    for i in range(len(parts) - 1, 0, -1):
        cand = ".".join(parts[:i])
        if cand in known:
            return cand
    return None


def parse_cyp(ws_formulas, recipe_names: dict[str, str] | None = None) -> tuple[list[dict], list[str]]:  # type: ignore[no-untyped-def]
    """CYP sheet -> ordered tree nodes and notes.

    Node: {codigo, nombre, unidad, nivel (rubro/subrubro/item), parent, libre}.
    ``recipe_names`` (code -> solapa title) fills names that are formulas.
    """
    recipe_names = recipe_names or {}
    nodes: dict[str, dict] = {}
    notes: list[str] = []
    last_header: str | None = None

    def add(code: str, nombre: str, nivel: str, unidad: str = "", libre: bool = False) -> None:
        if any(code == r or code.startswith(r + ".") for r in REMOVED_CODES):
            notes.append(REMOVED_CODES[next(r for r in REMOVED_CODES if code == r or code.startswith(r + "."))])
            return
        if code in nodes:
            return
        nodes[code] = {"codigo": code, "nombre": nombre, "nivel": nivel, "unidad": unidad,
                       "parent": _parent_code(code, nodes), "libre": libre}

    for row in ws_formulas.iter_rows(min_row=1, max_row=ws_formulas.max_row, max_col=3):
        a, b, c = (cell.value for cell in row[:3])
        a_text = _text(a) if not isinstance(a, (datetime, date)) else ""
        b_text = _text(b) if isinstance(b, str) and not _is_formula(b) else ""

        if a_text and _ITEM_CODE_RE.match(a_text):
            code = a_text.rstrip(".")
            nombre = _LEADING_CODE_RE.sub("", b_text) if b_text else recipe_names.get(code, "")
            unidad = normalize_unit(c) if isinstance(c, str) and not _is_formula(c) else ""
            if code.split(".")[0] + "." + code.split(".")[1] in PER_FLOOR_CODES:
                continue
            add(code, nombre, "item", unidad)
            continue

        header = _HEADER_RE.match(a_text) if a_text else None
        if header and not b_text:
            rubro, sub, name = header.group(1), header.group(2), header.group(3).strip()
            code = f"{rubro}.{sub}" if sub else rubro
            last_header = code
            if code in PER_FLOOR_CODES:
                notes.append(f"{code} {name}: no se cargó. El Excel dice 'replicar'; "
                             "el sistema lo resuelve con los pisos.")
                continue
            add(code, name.capitalize() if name.isupper() else name,
                "subrubro" if sub else "rubro")
            continue

        if not a_text and b_text and last_header in FREE_ITEMS:
            code, nombre = FREE_ITEMS[last_header]
            add(code, nombre, "item", libre=True)

    # Premarcos under 7.2 / 7.3
    for sheet_code_, item_code in PREMARCOS.items():
        parent = sheet_code_
        if parent in nodes and item_code not in nodes:
            add(item_code, recipe_names.get(item_code, f"Premarcos {nodes[parent]['nombre'].lower()}"), "item")

    ordered = sorted(nodes.values(), key=lambda n: [int(p) for p in n["codigo"].split(".")])
    for i, node in enumerate(ordered):
        node["orden"] = i
    return ordered, list(dict.fromkeys(notes))


# ── Whole workbook ───────────────────────────────────────────────────────────


def _premarco_template(tmpl: dict, item_code: str) -> dict:
    tmpl = {**tmpl, "codigo": item_code}
    tmpl["parametros"] = tmpl["parametros"] + [{
        "clave": "con_material", "valor": 0, "unidad": None,
        "descripcion": "1 = incluye el material del premarco, 0 = solo mano de obra",
    }]
    tmpl["recursos"] = tmpl["recursos"] + [{
        "tipo": "material", "codigo": "", "descripcion": "Premarco (material opcional)",
        "unidad": "u", "formula": "Q*con_material", "desperdicio_pct": None,
        "origen": "decisión con Sol", "revisar": True,
        "notas": ["Material opcional (con_material = 1). No hay código de premarco en 00_Mat: "
                  "falta el código y el precio."],
    }]
    tmpl["info"] = tmpl["info"] + [
        "Premarcos: la mano de obra va siempre; el material es opcional con el parámetro con_material."
    ]
    return tmpl


def _signature(tmpl: dict) -> tuple:
    return tuple(
        (r["tipo"], r["codigo"], r.get("formula"), r.get("rendimiento"), r.get("trabajadores"))
        for r in tmpl["recursos"]
    )


def parse_maestro(wb_formulas, wb_values, entries_by_tipo: dict[str, list[dict]]) -> dict:  # type: ignore[no-untyped-def]
    """Parse every recipe solapa and the CYP tree.

    Returns {"plantillas": [...], "arbol": [...], "notas": [...], "hojas_omitidas": {...}}.
    """
    catalog = catalog_index(entries_by_tipo)
    templates: dict[str, dict] = {}
    skipped: dict[str, str] = {}
    for name in wb_formulas.sheetnames:
        if name in NOT_RECIPE_SHEETS:
            continue
        if name in SKIPPED_SHEETS:
            skipped[name] = SKIPPED_SHEETS[name]
            continue
        code = sheet_code(name)
        if any(code == r or code.startswith(r + ".") for r in REMOVED_CODES):
            skipped[name] = REMOVED_CODES[next(r for r in REMOVED_CODES if code == r or code.startswith(r + "."))]
            continue
        ws_v = wb_values[name] if wb_values is not None and name in wb_values.sheetnames else None
        tmpl = parse_recipe_sheet(name, wb_formulas[name], ws_v, catalog)
        if name in SHEET_CODE_OVERRIDES:
            tmpl["info"].append(f"Viene de la solapa {name} (decisión con Sol: el zócalo va en {code}).")
        if code in PREMARCOS:
            tmpl = _premarco_template(tmpl, PREMARCOS[code])
            code = tmpl["codigo"]
        templates[code] = tmpl

    # Same recipe copied into two solapas
    by_sig: dict[tuple, list[str]] = defaultdict(list)
    for code, tmpl in templates.items():
        if tmpl["recursos"]:
            by_sig[_signature(tmpl)].append(code)
    for codes in by_sig.values():
        for code in codes[1:]:
            templates[code]["notas"].append(f"Tiene la misma fórmula que {codes[0]}: ¿es una copia?")

    notes: list[str] = []
    tree: list[dict] = []
    if "CYP" in wb_formulas.sheetnames:
        tree, notes = parse_cyp(wb_formulas["CYP"], {c: t["nombre"] for c, t in templates.items()})
    else:
        notes.append("No se encontró la solapa CYP: no se cargó el árbol.")

    tree_codes = {n["codigo"]: n for n in tree}
    for code, tmpl in templates.items():
        node = tree_codes.get(code)
        if node is None:
            tmpl["notas"].append("No está en el árbol CYP.")
            continue
        node["plantilla"] = code
        if node["nombre"] and _text(node["nombre"]).upper() != _text(tmpl["nombre"]).upper():
            missing = _missing_words(node["nombre"], tmpl["nombre"])
            if missing:
                tmpl["info"].append(
                    f"El título de la solapa ('{tmpl['nombre']}') no coincide con el CYP "
                    f"('{node['nombre']}'). Se usó el nombre del CYP."
                )
            tmpl["nombre_solapa"] = tmpl["nombre"]
            tmpl["nombre"] = node["nombre"]
        if not node["unidad"]:
            node["unidad"] = tmpl["unidad"]
        elif tmpl["unidad"] and node["unidad"] != tmpl["unidad"]:
            tmpl["notas"].append(f"Unidad distinta: CYP '{node['unidad']}', solapa '{tmpl['unidad']}'.")

    for tmpl in templates.values():
        rubro = tmpl["codigo"].split(".")[0]
        tmpl["categoria"] = tree_codes[rubro]["nombre"] if rubro in tree_codes else rubro

    return {
        "plantillas": sorted(templates.values(), key=lambda t: [int(p) for p in t["codigo"].split(".")]),
        "arbol": tree,
        "notas": notes,
        "hojas_omitidas": skipped,
    }


def _missing_words(expected: str, actual: str) -> list[str]:
    def words(text: str) -> set[str]:
        text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
        return {w for w in re.findall(r"[A-Z]+", text) if len(w) >= 4}
    return sorted(words(expected) - words(actual))


# ── Template payload for item_templates ──────────────────────────────────────

_RESOURCE_KEYS = ("tipo", "codigo", "descripcion", "unidad", "formula", "desperdicio_pct",
                  "trabajadores", "rendimiento", "cargas_sociales_pct", "redondear",
                  "unidad_compra", "revisar", "notas", "origen")


def template_payload(tmpl: dict) -> dict:
    """item_templates row (without org_id / id)."""
    recursos = []
    for r in tmpl["recursos"]:
        rec = {k: r[k] for k in _RESOURCE_KEYS if k in r and r[k] is not None}
        rec["nota"] = " ".join(rec.pop("notas", []))
        recursos.append(rec)
    desc = f"Importado del Maestro TERRAC (solapa {tmpl['hoja']})."
    if tmpl.get("cantidad_ejemplo") is not None:
        desc += f" Cantidad de ejemplo del Excel: {fmt_num(tmpl['cantidad_ejemplo'])} {tmpl['unidad']}."
    return {
        "codigo": tmpl["codigo"],
        "nombre": tmpl["nombre"],
        "descripcion": desc,
        "unidad": tmpl["unidad"],
        "categoria": tmpl.get("categoria"),
        "parametros": tmpl["parametros"],
        "recursos": recursos,
        "origen": "maestro_terrac",
    }


def template_status(tmpl: dict) -> str:
    if not tmpl["recursos"]:
        return "vacia"
    if any(r.get("revisar") for r in tmpl["recursos"]) or tmpl["notas"]:
        return "revisar"
    return "ok"


# ── Report ───────────────────────────────────────────────────────────────────

_TIPO_LABEL = {"material": "Material", "mano_obra": "Mano de obra", "equipo": "Equipo",
               "mo_material": "MO - material", "subcontrato": "Subcontrato"}


def _resource_text(r: dict) -> str:
    if r["tipo"] == "mano_obra":
        return f"{fmt_num(r['trabajadores'])} pers., rendimiento {r['rendimiento']}/día"
    return f"`{r['formula']}`"


def report_markdown(parsed: dict, source: str = "") -> str:
    """Simple report, item by item: what loaded fine and what to review."""
    plantillas = parsed["plantillas"]
    by_code = {t["codigo"]: t for t in plantillas}
    n_rec = sum(len(t["recursos"]) for t in plantillas)
    n_rev = sum(1 for t in plantillas for r in t["recursos"] if r.get("revisar"))
    status = {t["codigo"]: template_status(t) for t in plantillas}

    lines = ["# Informe de carga del Maestro TERRAC: fórmulas y árbol", ""]
    if source:
        lines += [f"Archivo: `{source}`", ""]
    lines += [
        "## Resumen", "",
        f"- **{len(plantillas)} plantillas** con **{n_rec} recursos**: "
        f"{n_rec - n_rev} bien y **{n_rev} para revisar**.",
        f"- Plantillas sin nada para revisar: {sum(1 for s in status.values() if s == 'ok')}. "
        f"Con algo para revisar: {sum(1 for s in status.values() if s == 'revisar')}.",
        f"- **Árbol CYP**: {len(parsed['arbol'])} filas (rubros, subrubros e ítems). "
        f"Ítems con plantilla: {sum(1 for n in parsed['arbol'] if n.get('plantilla'))}.",
        "",
        "Cómo se tradujo:",
        "- La cantidad del ítem (celda H3) es **Q**.",
        "- Las celdas auxiliares (altura, ml de vigas…) son **parámetros** con el valor del Excel: "
        "se cambian en cada presupuesto.",
        "- Mano de obra: los días `=H3/15` son **rendimiento 15 por día**. El % de la columna "
        "Desperdicio de la MO se cargó como cargas sociales.",
        "- Los materiales se redondean a unidades enteras **sobre el total de la obra**, "
        "no por ítem.",
        "- **Revisar** = número fijo del ejemplo, código que no está en el catálogo, "
        "o cantidad que no se pudo traducir.",
        "",
        "## Decisiones de la reunión con Sol", "",
        "- 7.2 y 7.3 premarcos: la mano de obra va siempre; el material es opcional "
        "(parámetro `con_material`: 1 = sí, 0 = no; por defecto 0).",
        "- Zócalo (solapa AGREGADO) va en **7.1.4**.",
        "- 5.6 Recuadros se elimina (ya está en revoques). No estaba en este Excel.",
        "- Cubiertas (9.1) y Otras terminaciones (7.5.1) quedan como ítems libres, vacíos.",
        "",
    ]
    if parsed["hojas_omitidas"]:
        lines += ["Solapas que no se cargaron:", ""]
        lines += [f"- `{s}`: {why}" for s, why in parsed["hojas_omitidas"].items()]
        lines.append("")
    if parsed["notas"]:
        lines += ["Notas del árbol:", ""]
        lines += [f"- {n}" for n in parsed["notas"]]
        lines.append("")

    lines += ["## Ítem por ítem", "",
              "✅ = bien · ⚠️ = hay algo para revisar · ⬜ = sin fórmula", ""]
    for node in parsed["arbol"]:
        code = node["codigo"]
        if node["nivel"] != "item":
            level = "###" if node["nivel"] == "rubro" else "####"
            lines += [f"{level} {code} {node['nombre']}", ""]
            continue
        tmpl = by_code.get(node.get("plantilla") or "")
        if tmpl is None:
            why = "ítem libre, vacío" if node.get("libre") else "sin solapa en el Excel"
            lines.append(f"- ⬜ **{code} {node['nombre']}**: {why}.")
            continue
        st = status[code]
        icon = {"ok": "✅", "revisar": "⚠️", "vacia": "⬜"}[st]
        ok_count = sum(1 for r in tmpl["recursos"] if not r.get("revisar"))
        head = f"- {icon} **{code} {tmpl['nombre']}** ({tmpl['unidad']}): {len(tmpl['recursos'])} recursos"
        if st == "vacia":
            head = f"- {icon} **{code} {tmpl['nombre']}**: la solapa no tiene recursos con cantidad"
        elif st == "revisar":
            head += f", {ok_count} bien"
        lines.append(head + ".")
        if tmpl["parametros"]:
            params = ", ".join(f"`{p['clave']}` = {fmt_num(p['valor'])}" for p in tmpl["parametros"])
            lines.append(f"  - Parámetros: {params}.")
        for note in tmpl["info"]:
            lines.append(f"  - ℹ️ {note}")
        for note in tmpl["notas"]:
            lines.append(f"  - Revisar: {note}")
        for r in tmpl["recursos"]:
            if r.get("revisar"):
                name = r["codigo"] or r["descripcion"]
                lines.append(f"  - Revisar {_TIPO_LABEL[r['tipo']].lower()} **{name}** "
                             f"({_resource_text(r)}): {' '.join(r['notas'])}")
    lines.append("")

    # Resources skipped because they had no quantity
    skipped = [(t["codigo"], o) for t in plantillas for o in t["omitidos"]]
    if skipped:
        lines += ["## Filas sin cantidad (no se cargaron)", "",
                  "Tienen código pero la cantidad o los días están vacíos o en 0.", ""]
        grouped: dict[str, list[str]] = defaultdict(list)
        for code, o in skipped:
            grouped[code].append(o["codigo"])
        for code, names in grouped.items():
            lines.append(f"- {code}: {', '.join(names)}")
        lines.append("")
    return "\n".join(lines)
