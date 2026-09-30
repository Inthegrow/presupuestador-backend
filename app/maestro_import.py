"""Parse TERRAC's "Maestro" price lists (solapas 00_Mat, 00_MO, 00_Eq, 00_Sub).

Pure parsing and reporting, no database access: see import_maestro.py for the
command-line script that writes to Supabase.

Layout of the Maestro sheets (checked on MODELO DE PRESUPUESTACION RESUMEN):
- A = código, B = descripción, C = unidad.
- Each section starts with a header row whose column A says "CODIGO"; its
  column B holds the section name, and the rest names the price columns.
- 00_MO / 00_Eq / 00_Sub have explicit PRECIO SIN IVA, FECHA and REFERENCIA
  (proveedor) columns. In 00_Mat the fecha and proveedor move between F..J
  depending on the section and are not labeled.

Nothing is invented: a missing price or date stays empty and is reported.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime

from app.catalog_prices import normalize_codigo

SHEET_TIPOS: dict[str, str] = {
    "00_Mat": "material",
    "00_MO": "mano_obra",
    "00_Eq": "equipo",
    "00_Sub": "subcontrato",
}

TIPO_LABELS: dict[str, str] = {
    "material": "Materiales",
    "mano_obra": "Mano de obra",
    "equipo": "Equipos",
    "subcontrato": "Subcontratos",
}

# 0-based columns scanned in 00_Mat for unlabeled fecha (F..J) and proveedor (F..I)
_FECHA_SCAN = range(5, 10)
_PROVEEDOR_SCAN = range(5, 9)


def parse_price(value: object) -> float | None:
    """Parse a price cell: numbers, or Argentine strings like '$  1.300.000,00'.

    Returns None when empty. Raises ValueError when the text is not a number.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace("$", "").replace("\xa0", "").replace(" ", "").strip()
    if not text:
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    return float(text)


def _cell(row: tuple, idx: int | None) -> object:
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip() if value is not None else ""


def _is_date(value: object) -> bool:
    return isinstance(value, (datetime, date))


def _as_date(value: object) -> date:
    return value.date() if isinstance(value, datetime) else value  # type: ignore[return-value]


def _section_columns(header: tuple) -> dict:
    """Map a section header row to column indexes."""
    labels = [_text(v).upper() for v in header]
    cols: dict = {"sin_iva": None, "con_iva": None, "fecha": None, "proveedor": None, "skip": set()}
    for idx, label in enumerate(labels):
        if idx < 3 or not label:
            continue
        if "SIN IVA" in label and cols["sin_iva"] is None:
            cols["sin_iva"] = idx
        elif "CON IVA" in label and "DESCUENTO" not in label and cols["con_iva"] is None:
            cols["con_iva"] = idx
        elif label.startswith("FECHA") and cols["fecha"] is None:
            cols["fecha"] = idx
        elif label in {"REFERENCIA", "PROVEEDOR"} and cols["proveedor"] is None:
            cols["proveedor"] = idx
        elif "RENDIMIENTO" in label:
            cols["skip"].add(idx)
    return cols


def _detect_fecha_col(section_rows: list[tuple]) -> int | None:
    """For an unlabeled section, the column in F..J holding the most dates."""
    counts = {idx: sum(1 for r in section_rows if _is_date(_cell(r, idx))) for idx in _FECHA_SCAN}
    best = max(counts, key=lambda idx: counts[idx])
    return best if counts[best] else None


def _find_fecha(row: tuple, cols: dict) -> tuple[date | None, object]:
    """Return (fecha, raw_value_if_unreadable). Only labeled columns report bad values."""
    col = cols["fecha"] if cols["fecha"] is not None else cols["fecha_detectada"]
    if col is None:
        return None, None
    raw = _cell(row, col)
    if _is_date(raw):
        return _as_date(raw), None
    if cols["fecha"] is not None and _text(raw):
        return None, raw
    return None, None


def _find_proveedor(row: tuple, cols: dict) -> str:
    if cols["proveedor"] is not None:
        return _text(_cell(row, cols["proveedor"]))
    if cols["fecha"] is not None:
        return ""  # sheet with labeled columns and no proveedor column
    for idx in _PROVEEDOR_SCAN:
        if idx == cols["fecha_detectada"] or idx in cols["skip"] or idx in (cols["sin_iva"], cols["con_iva"]):
            continue
        raw = _cell(row, idx)
        if isinstance(raw, str):
            text = _text(raw)
            if text and not text.lower().startswith(("http://", "https://", "www.")):
                return text
    return ""


def parse_sheet(sheet_name: str, rows: list[tuple], tipo: str) -> tuple[list[dict], dict]:
    """Parse one Maestro sheet into catalog entries plus the problems found.

    ``rows`` are worksheet rows as tuples (``ws.iter_rows(values_only=True)``);
    row numbers in the report are 1-based like in Excel.
    """
    entries: list[dict] = []
    issues: dict[str, list[dict]] = defaultdict(list)
    by_code: dict[str, list[dict]] = defaultdict(list)
    cols: dict | None = None
    section = ""

    rows = [tuple(r or ()) for r in rows]
    headers = [i for i, r in enumerate(rows) if _text(_cell(r, 0)).upper() == "CODIGO"]

    for row_no, row in enumerate(rows, start=1):
        codigo_raw = _cell(row, 0)
        if row_no - 1 in headers:
            cols = _section_columns(row)
            section = _text(_cell(row, 1))
            nxt = next((h for h in headers if h > row_no - 1), len(rows))
            cols["fecha_detectada"] = _detect_fecha_col(rows[row_no:nxt])
            continue
        if cols is None:
            continue  # title rows above the first header
        if not any(_text(v) for v in row):
            continue  # blank separator

        descripcion = _text(_cell(row, 1))
        codigo = normalize_codigo(codigo_raw)
        where = {"hoja": sheet_name, "fila": row_no, "seccion": section, "descripcion": descripcion}

        if not codigo:
            issues["sin_codigo"].append(where)
            continue

        precio_sin_iva = precio_con_iva = None
        for key, col in (("sin_iva", cols["sin_iva"]), ("con_iva", cols["con_iva"])):
            raw = _cell(row, col)
            try:
                value = parse_price(raw)
            except ValueError:
                issues["precio_ilegible"].append({**where, "codigo": codigo, "valor": _text(raw)})
                value = None
            if key == "sin_iva":
                precio_sin_iva = value
            else:
                precio_con_iva = value

        if precio_sin_iva is None and precio_con_iva is not None and cols["sin_iva"] is None:
            # Section labeled only "PRECIO CON IVA": do not guess the price without IVA
            issues["solo_con_iva"].append({**where, "codigo": codigo, "precio_con_iva": precio_con_iva})

        fecha, fecha_bad = _find_fecha(row, cols)
        if fecha_bad is not None:
            issues["fecha_ilegible"].append({**where, "codigo": codigo, "valor": _text(fecha_bad)})

        entry = {
            "tipo": tipo,
            "codigo": codigo,
            "descripcion": descripcion,
            "unidad": _text(_cell(row, 2)),
            "precio_sin_iva": precio_sin_iva,
            "precio_con_iva": precio_con_iva,
            "fecha_precio": fecha.isoformat() if fecha else None,
            "proveedor": _find_proveedor(row, cols) or None,
        }
        entries.append(entry)
        info = {**where, "codigo": codigo}
        by_code[codigo].append({**info, "precio_sin_iva": precio_sin_iva})

        if _text(codigo_raw) != codigo:
            issues["codigo_normalizado"].append({**info, "original": _text(codigo_raw)})
        if precio_sin_iva is None and precio_con_iva is None:
            issues["sin_precio"].append(info)
        if fecha is None:
            issues["sin_fecha"].append({**info, "precio_sin_iva": precio_sin_iva})

    for codigo, found in by_code.items():
        if len(found) > 1:
            issues["duplicados"].append({"hoja": sheet_name, "codigo": codigo, "filas": found})

    return entries, dict(issues)


def parse_workbook(wb) -> tuple[dict[str, list[dict]], dict]:  # type: ignore[no-untyped-def]
    """Parse the 4 Maestro sheets of an openpyxl workbook (loaded with data_only=True).

    Returns (entries by tipo, report).
    """
    entries_by_tipo: dict[str, list[dict]] = {}
    report: dict = {"hojas": {}, "faltantes": [], "duplicados_entre_hojas": []}

    for sheet_name, tipo in SHEET_TIPOS.items():
        if sheet_name not in wb.sheetnames:
            report["faltantes"].append(sheet_name)
            continue
        rows = list(wb[sheet_name].iter_rows(values_only=True))
        entries, issues = parse_sheet(sheet_name, rows, tipo)
        entries_by_tipo[tipo] = entries
        report["hojas"][sheet_name] = {"tipo": tipo, "entradas": len(entries), **issues}

    # First price of each code per sheet, to spot codes repeated across sheets
    seen: dict[str, list[tuple[str, float | None]]] = defaultdict(list)
    for sheet_name, tipo in SHEET_TIPOS.items():
        first: dict[str, float | None] = {}
        for e in entries_by_tipo.get(tipo, []):
            first.setdefault(e["codigo"], e["precio_sin_iva"])
        for code, precio in first.items():
            seen[code].append((sheet_name, precio))
    for code, where in sorted(seen.items()):
        if len(where) > 1:
            report["duplicados_entre_hojas"].append({"codigo": code, "hojas": where})

    return entries_by_tipo, report


def _fmt_price(value: float | None) -> str:
    if value is None:
        return "—"
    return f"${value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def report_markdown(report: dict, source: str = "") -> str:
    """Render the import report as Markdown (in Spanish, for TERRAC)."""
    lines = ["# Informe de importación del Maestro de precios", ""]
    if source:
        lines += [f"Archivo: `{source}`", ""]
    lines += ["No se inventaron datos: los precios o fechas que faltan quedan vacíos y figuran acá.", ""]

    lines += ["## Resumen", "", "| Hoja | Entradas | Sin fecha | Sin precio | Códigos duplicados | Sin código |",
              "|---|---|---|---|---|---|"]
    for sheet, info in report["hojas"].items():
        lines.append(
            f"| {sheet} | {info['entradas']} | {len(info.get('sin_fecha', []))} | "
            f"{len(info.get('sin_precio', []))} | {len(info.get('duplicados', []))} | "
            f"{len(info.get('sin_codigo', []))} |"
        )
    if report["faltantes"]:
        lines += ["", f"**Hojas que no se encontraron:** {', '.join(report['faltantes'])}"]

    def section(title: str, note: str, header: str, rows: list[str]) -> None:
        if not rows:
            return
        lines.extend(["", f"## {title}", ""])
        if note:
            lines.extend([note, ""])
        lines.extend([header, "|" + "---|" * (header.count("|") - 1)])
        lines.extend(rows)

    dup_rows = []
    for sheet, info in report["hojas"].items():
        for d in info.get("duplicados", []):
            detalle = "; ".join(
                f"fila {f['fila']}: {f['descripcion']} ({_fmt_price(f['precio_sin_iva'])})" for f in d["filas"]
            )
            dup_rows.append(f"| {sheet} | {d['codigo']} | {detalle} |")
    section("Códigos duplicados en la misma hoja",
            "Se importaron todas las filas. Hay que dejar un solo código por producto en el Excel "
            "(si son productos distintos, cambiarle el código a uno).",
            "| Hoja | Código | Filas |", dup_rows)

    cross = [
        f"| {d['codigo']} | " + "; ".join(f"{s} ({_fmt_price(p)})" for s, p in d["hojas"]) + " |"
        for d in report["duplicados_entre_hojas"]
    ]
    section("Códigos repetidos entre hojas", "", "| Código | Hojas |", cross)

    def per_row(key: str, extra=lambda i: "") -> list[str]:  # type: ignore[no-untyped-def]
        out = []
        for sheet, info in report["hojas"].items():
            for i in info.get(key, []):
                out.append(
                    f"| {sheet} | {i['fila']} | {i.get('codigo', '')} | {i['descripcion']} | {extra(i)} |"
                )
        return out

    section("Precios sin fecha", "", "| Hoja | Fila | Código | Descripción | Precio sin IVA |",
            per_row("sin_fecha", lambda i: _fmt_price(i.get("precio_sin_iva"))))
    section("Productos sin precio", "", "| Hoja | Fila | Código | Descripción | |", per_row("sin_precio"))
    section("Solo precio con IVA",
            "La columna de esta sección dice \"PRECIO CON IVA\". Se cargó como precio con IVA y el precio "
            "sin IVA quedó vacío hasta confirmar cuál es.",
            "| Hoja | Fila | Código | Descripción | Precio con IVA |",
            per_row("solo_con_iva", lambda i: _fmt_price(i.get("precio_con_iva"))))
    section("Filas sin código (no se importaron)", "", "| Hoja | Fila | Código | Descripción | |",
            per_row("sin_codigo"))
    section("Precios que no se pudieron leer", "", "| Hoja | Fila | Código | Descripción | Valor |",
            per_row("precio_ilegible", lambda i: i.get("valor", "")))
    section("Fechas que no se pudieron leer", "", "| Hoja | Fila | Código | Descripción | Valor |",
            per_row("fecha_ilegible", lambda i: i.get("valor", "")))
    section("Códigos normalizados (mayúsculas y espacios)", "",
            "| Hoja | Fila | Código | Descripción | Original |",
            per_row("codigo_normalizado", lambda i: i.get("original", "")))

    return "\n".join(lines) + "\n"

