"""Catalog price lookup and application to budgets."""

from __future__ import annotations

import csv
import io
import math
import re
import unicodedata
import warnings
from typing import get_args
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile

from app.auth import get_current_user, require_admin, require_editor
from app.budget_prices import HISTORY_CHUNK, fetch_all, today
from app.catalog_prices import (
    FUENTE_A_MANO,
    con_iva_proporcional,
    FUENTE_KEYS,
    falta_columna_fuente,
    falta_columna_historial,
    fecha_iso,
    fuente_from_payload,
    fuente_importada,
    history_row,
    price_changed,
    price_from_payload,
    sin_extras_historial,
    sin_fuente,
)
from app.db import get_data_db
from app.routers.analysis import _get_budget, apply_catalog
from app.schemas import CatalogTipo

router = APIRouter()

# ── Tab-name → tipo mapping ───────────────────────────────────────────────────

TAB_TIPO_MAP: dict[str, str] = {
    "materiales": "material",
    "material": "material",
    "mat": "material",
    "mano de obra": "mano_obra",
    "mano_obra": "mano_obra",
    "mo": "mano_obra",
    "equipos": "equipo",
    "equipo": "equipo",
    "eq": "equipo",
    "subcontratos": "subcontrato",
    "subcontrato": "subcontrato",
    "sub": "subcontrato",
}

# Flexible column aliases for price column
_PRICE_ALIASES = {"precio_unitario", "precio_sin_iva", "precio", "costo", "precio_unit", "p_unitario"}
_FECHA_ALIASES = {"fecha_precio", "fecha", "fecha precio", "fecha_act", "actualizado"}
_PROVEEDOR_ALIASES = {"proveedor", "prov", "supplier"}


def record_history(db, entries: list[dict]) -> None:  # type: ignore[no-untyped-def]
    """Insert one catalog_price_history row per saved entry that has a price."""
    rows = [history_row(e) for e in entries if e.get("id") and e.get("precio_sin_iva") is not None]
    insert_history_rows(db, rows)


def insert_history_rows(db, rows: list[dict]) -> list[dict]:  # type: ignore[no-untyped-def]
    """Insert price history rows. Without migration 012 the history has no fuente, fuente_url or
    proveedor columns: they are dropped, no error."""
    if not rows:
        return []
    try:
        return db.table("catalog_price_history").insert(rows).execute().data or []
    except Exception as exc:
        if not falta_columna_historial(exc):
            raise
        return db.table("catalog_price_history").insert([sin_extras_historial(r) for r in rows]).execute().data or []


def insert_entries(db, rows: list[dict]) -> list[dict]:  # type: ignore[no-untyped-def]
    """Insert catalog entries (with their origin) and start their price history.

    Without migration 012 there are no fuente/fuente_url columns: they are dropped, no error.
    """
    if not rows:
        return []
    try:
        inserted = db.table("catalog_entries").insert(rows).execute()
    except Exception as exc:
        if not falta_columna_fuente(exc):
            raise
        inserted = db.table("catalog_entries").insert([sin_fuente(r) for r in rows]).execute()
    record_history(db, inserted.data or [])
    return inserted.data or []


def _update_entry(db, org_id: str, entry_id: str, data: dict):  # type: ignore[no-untyped-def]
    def run(values: dict):  # type: ignore[no-untyped-def]
        return db.table("catalog_entries").update(values).eq("id", entry_id).eq("org_id", org_id).execute()

    try:
        return run(data)
    except Exception as exc:
        if not falta_columna_fuente(exc) or not any(k in data for k in FUENTE_KEYS):
            raise
        return run(sin_fuente(data))


def with_fuente(row: dict) -> dict:
    """An entry or history row with ``fuente`` and ``fuente_url`` (None before migration 012)."""
    return {"fuente": None, "fuente_url": None, **row}


def update_entries(db, org_id: str, changes: list[tuple[dict, dict]]) -> list[dict]:  # type: ignore[no-untyped-def]
    """Save catalog entry updates with the price-date rule and the price history.

    ``changes``: (current row with id, precio_sin_iva and fecha_precio; fields to set).
    Returns the saved rows (the ones the database sent back).
    """
    saved: list[dict] = []
    history: list[dict] = []
    for old, update_data in changes:
        update_data = dict(update_data)
        if ("precio_sin_iva" in update_data and "precio_con_iva" not in update_data
                and price_changed(old, {"precio_sin_iva": update_data["precio_sin_iva"]})):
            # The price with VAT follows the new price (same ratio), or goes empty: never a stale one
            update_data.update(con_iva_proporcional(old, update_data["precio_sin_iva"]))
        confirma = "precio_sin_iva" in update_data and not old.get("fecha_precio")
        if "fecha_precio" not in update_data and (price_changed(old, update_data) or confirma):
            # New price without an explicit date: it is today's price (in Argentina, the date the
            # prices are read at: a price saved at 22 h must be in force that same day). Saving the
            # same value on an undated entry confirms it today too (an undated 0 is "sin precio";
            # a dated 0 is "va en $0": budget_prices.is_price)
            update_data["fecha_precio"] = today().isoformat()

        result = _update_entry(db, org_id, str(old["id"]), update_data)
        saved.extend(result.data or [])
        if price_changed(old, update_data):
            history.append({**old, **update_data, "id": str(old["id"]), "org_id": org_id})
    record_history(db, history)
    return saved


def start_history(db, org_id: str, entries: list[dict]) -> None:  # type: ignore[no-untyped-def]
    """Record the current price of entries that have no history yet (like migration 004).

    Entries saved before every insert recorded its price (ej. old "Importar Excel" lists)
    would otherwise lose their current price when it changes.
    """
    ids = [str(e["id"]) for e in entries if e.get("id") and e.get("precio_sin_iva") is not None]
    known: set[str] = set()
    for start in range(0, len(ids), HISTORY_CHUNK):
        chunk = ids[start:start + HISTORY_CHUNK]
        rows = fetch_all(
            lambda chunk=chunk: db.table("catalog_price_history")
            .select("entry_id")
            .eq("org_id", org_id)
            .in_("entry_id", chunk)
            .order("id")
        )
        known.update(str(h["entry_id"]) for h in rows)
    record_history(db, [{**e, "org_id": org_id} for e in entries if str(e.get("id")) not in known])


def _fecha_or_warning(raw: object, where: str, warnings_list: list[str]) -> str | None:
    """Parse a date from an uploaded file; unreadable dates are reported, not guessed."""
    try:
        return fecha_iso(raw)
    except ValueError:
        warnings_list.append(f"{where}: fecha '{raw}' no reconocida, quedó sin fecha")
        return None


# ── Upload CSV catalog ────────────────────────────────────────────────────

# Columns of a .csv price list: canonical name → accepted headers (normalized: without accents, lower
# case, spaces and hyphens as "_"), in order of preference. Required: código and precio.
CSV_COLUMNAS: dict[str, tuple[str, ...]] = {
    "codigo": ("codigo", "cod", "code"),
    "descripcion": ("descripcion", "detalle", "description"),
    "unidad": ("unidad", "u", "unid", "ud"),
    "precio": ("precio_unitario", "precio_sin_iva", "precio", "precio_unit", "p_unitario", "costo"),
    "fecha": ("fecha", "fecha_precio", "fecha_act", "actualizado"),
    "proveedor": ("proveedor", "prov", "supplier"),
}
CSV_OBLIGATORIAS = ("codigo", "precio")
# How each column is named in the messages
CSV_NOMBRES = {"codigo": "código", "descripcion": "descripción", "unidad": "unidad", "precio": "precio",
               "fecha": "fecha", "proveedor": "proveedor"}
CSV_FALTA = {"codigo": "la columna del código (código o cod)",
             "precio": "la columna del precio (precio_unitario o precio)"}
CSV_SEPARADORES = ",;\t"


def sin_tildes(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c))


def normalizar_encabezado(texto: object) -> str:
    """'Precio sin IVA' → 'precio_sin_iva'; 'Código' → 'codigo'; 'Cód.' → 'cod'."""
    t = sin_tildes(str(texto or "").replace("﻿", "")).strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def columnas_csv(encabezados: list[str]) -> dict[str, int]:
    """Canonical column → index in the row, by the accepted names (first preferred alias wins)."""
    norm = [normalizar_encabezado(h) for h in encabezados]
    cols: dict[str, int] = {}
    for canon, alias in CSV_COLUMNAS.items():
        for a in alias:
            if a in norm:
                cols[canon] = norm.index(a)
                break
    return cols


def detectar_separador(texto: str) -> str:
    """',', ';' or tab. csv.Sniffer first; when it cannot tell (or picks one the header line does not
    have), the one that appears most in the first line."""
    lineas = [ln for ln in texto.splitlines() if ln.strip()]
    primera = lineas[0] if lineas else ""
    try:
        sep = csv.Sniffer().sniff("\n".join(lineas[:50]), delimiters=CSV_SEPARADORES).delimiter
        if sep in primera:
            return sep
    except csv.Error:
        pass
    conteos = {d: primera.count(d) for d in CSV_SEPARADORES}
    mejor = max(conteos, key=lambda d: conteos[d])
    return mejor if conteos[mejor] else ","


def leer_precio(raw: object) -> float | None:
    """A price as Sol writes it: '$ 1.234,50', '1234,5', '1234.5', '1.234' (one thousand two hundred
    thirty-four: a dot followed by exactly 3 digits is the thousands separator). None when unreadable."""
    t = re.sub(r"\s+", "", str(raw or "")).replace("$", "")
    if t.upper().startswith("ARS"):
        t = t[3:]
    if not t:
        return None
    if "," in t and "." in t:
        if t.rfind(",") > t.rfind("."):  # 1.234,50
            t = t.replace(".", "").replace(",", ".")
        else:  # 1,234.50
            t = t.replace(",", "")
    elif "," in t:
        t = t.replace(",", "") if t.count(",") > 1 else t.replace(",", ".")
    elif t.count(".") > 1 or re.fullmatch(r"-?[1-9]\d{0,2}\.\d{3}", t):
        t = t.replace(".", "")  # 1.234.567 / 1.234
    try:
        valor = float(t)
    except ValueError:
        return None
    return valor if math.isfinite(valor) else None


def _renglones(n: int) -> str:
    return "1 renglón" if n == 1 else f"{n} renglones"


def _lista_filas(filas: list[int]) -> str:
    muestra = [str(f) for f in filas[:8]]
    texto = muestra[0] if len(muestra) == 1 else ", ".join(muestra[:-1]) + " y " + muestra[-1]
    return texto + (" y otros" if len(filas) > 8 else "")


def mensaje_faltan(faltan: list[str], encabezados: list[str]) -> str:
    """'Al archivo le falta la columna del precio (precio_unitario o precio). Tiene: código, descripción, unidad.'"""
    if len(faltan) == 1:
        texto = f"Al archivo le falta {CSV_FALTA[faltan[0]]}."
    else:
        texto = ("Al archivo le faltan " + ", ".join(CSV_FALTA[f] for f in faltan[:-1])
                 + " y " + CSV_FALTA[faltan[-1]].replace("la columna del", "la del") + ".")
    tiene = []
    for h in encabezados:
        cols = columnas_csv([h])
        nombre = CSV_NOMBRES[next(iter(cols))] if cols else str(h).replace("﻿", "").strip()
        if nombre and nombre not in tiene:
            tiene.append(nombre)
    return texto + (f" Tiene: {', '.join(tiene)}." if tiene else " No tiene encabezados.")


def leer_csv(content: bytes, archivo: str | None, tipo: str) -> tuple[list[dict], int, list[str]]:
    """Rows of a .csv price list: (entries to insert, skipped rows, warnings). Raises HTTPException 400
    when the required columns are missing."""
    try:
        text = content.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")  # Excel en castellano (Windows)
        except UnicodeDecodeError:
            text = content.decode("latin-1")

    sep = None
    primera = text.lstrip("\r\n").split("\n", 1)[0].strip()
    if re.fullmatch(r"(?i)sep=.", primera):  # Excel's "sep=;" first line
        sep = primera[-1]
    sep = sep or detectar_separador(text)

    reader = csv.reader(io.StringIO(text), delimiter=sep)
    encabezados: list[str] | None = None
    for row in reader:
        if not any(c.strip() for c in row):
            continue
        if re.fullmatch(r"(?i)sep=.?", row[0].strip()) and not "".join(row[1:]).strip():
            continue  # Excel's "sep=;" line
        encabezados = row
        break
    if not encabezados:
        raise HTTPException(400, "El archivo está vacío: tiene que tener una primera línea con los nombres de "
                                 "las columnas (código y precio) y un renglón por precio.")

    cols = columnas_csv(encabezados)
    faltan = [c for c in CSV_OBLIGATORIAS if c not in cols]
    if faltan:
        raise HTTPException(400, mensaje_faltan(faltan, encabezados))

    def celda(row: list[str], canon: str) -> str:
        idx = cols.get(canon)
        return row[idx].strip() if idx is not None and idx < len(row) else ""

    fuente = fuente_importada(archivo)
    rows: list[dict] = []
    warnings_list: list[str] = []
    sin_datos: list[int] = []
    precio_ilegible: list[tuple[int, str]] = []
    for row in reader:
        line_no = reader.line_num
        if not any(c.strip() for c in row):
            continue  # blank rows (Excel's ";;;;") are not rows
        codigo, precio_raw = celda(row, "codigo"), celda(row, "precio")
        if not codigo or not precio_raw:
            sin_datos.append(line_no)
            continue
        precio = leer_precio(precio_raw)
        if precio is None:
            precio_ilegible.append((line_no, precio_raw))
            continue
        rows.append({
            "codigo": codigo,
            "descripcion": celda(row, "descripcion"),
            "unidad": celda(row, "unidad"),
            "precio_sin_iva": precio,
            "tipo": tipo,
            "fecha_precio": _fecha_or_warning(celda(row, "fecha"), f"Fila {line_no}", warnings_list),
            "proveedor": celda(row, "proveedor") or None,
            "fuente": fuente,
        })

    avisos: list[str] = []
    if sin_datos:
        n = len(sin_datos)
        avisos.append(f"{_renglones(n)} sin código o sin precio, no se {'cargó' if n == 1 else 'cargaron'} "
                      f"({'renglón' if n == 1 else 'renglones'} {_lista_filas(sin_datos)}).")
    if precio_ilegible:
        n = len(precio_ilegible)
        ejemplos = ", ".join(f"renglón {f}: «{v}»" for f, v in precio_ilegible[:3])
        avisos.append(f"{_renglones(n)} con un precio que no se entiende, no se {'cargó' if n == 1 else 'cargaron'} "
                      f"({ejemplos}{' y otros' if n > 3 else ''}).")
    return rows, len(sin_datos) + len(precio_ilegible), avisos + warnings_list


def tipo_de_lista(valor: str | None) -> str:
    """'material', 'mano_obra', 'equipo' or 'subcontrato' (also 'Mano de obra', 'Materiales'...)."""
    clave = normalizar_encabezado(valor)
    if clave in get_args(CatalogTipo):
        return clave
    tipo = TAB_TIPO_MAP.get(clave.replace("_", " ")) or TAB_TIPO_MAP.get(clave)
    if tipo is None:
        raise HTTPException(422, "Elegí el tipo de la lista: material, mano de obra, equipo o subcontrato.")
    return tipo


@router.post("/upload-csv")
async def upload_csv_catalog(
    file: UploadFile = File(...),
    tipo: str | None = Query(None, description="Tipo: material, mano_obra, equipo, subcontrato"),
    name: str | None = Query(None, description="Nombre del catálogo (si no se indica, el nombre del archivo)"),
    nombre: str | None = Query(None, description="Igual que name"),
    tipo_form: str | None = Form(None, alias="tipo"),
    name_form: str | None = Form(None, alias="name"),
    nombre_form: str | None = Form(None, alias="nombre"),
    user: dict = Depends(require_editor),
):
    """Upload a .csv price list and create a catalog with its entries.

    ``tipo`` and ``name`` (or ``nombre``) come in the URL or in the form. Separator ",", ";" or tab.
    Columns (any case, with or without accents): código/codigo/cod and precio_unitario/precio/precio sin
    IVA are required; descripción/detalle, unidad/u/unid, fecha and proveedor are optional.
    """
    tipo_lista = tipo_de_lista(tipo or tipo_form)
    archivo = file.filename or ""
    if archivo.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Ese archivo es un Excel, no un .csv: subilo con el botón del Excel, o en Excel "
                                 "usá «Guardar como» → CSV.")
    content = await file.read()
    if content[:4] == b"PK\x03\x04":
        raise HTTPException(400, "Ese archivo es un Excel, no un .csv: subilo con el botón del Excel, o en Excel "
                                 "usá «Guardar como» → CSV.")

    rows, salteadas, warnings_list = leer_csv(content, archivo, tipo_lista)
    if not rows:
        detalle = f" {' '.join(warnings_list)}" if warnings_list else ""
        raise HTTPException(400, f"El archivo .csv no tiene renglones para cargar (con código y precio).{detalle}")

    db = get_data_db()
    org_id = user["org_id"]
    nombre_lista = next((n.strip() for n in (name, nombre, name_form, nombre_form) if n and n.strip()), None)
    catalog_name = nombre_lista or (archivo or "catalogo").rsplit(".", 1)[0]
    catalog_result = db.table("price_catalogs").insert({
        "org_id": org_id,
        "name": catalog_name,
        "source_file": file.filename,
    }).execute()
    if not catalog_result.data:
        raise HTTPException(500, "No se pudo crear el catálogo. Probá de nuevo.")
    catalogo = {"org_id": org_id, "name": catalog_name, "source_file": file.filename, "oficial": False,
                **catalog_result.data[0]}
    catalog_id = catalogo["id"]

    insert_entries(db, [{"catalog_id": catalog_id, "org_id": org_id, **row} for row in rows])

    # The catalog row (what the screen adds to its lists) plus the summary of the upload
    return {
        **catalogo,
        "catalogo": catalogo,
        "catalog_id": catalog_id,
        "name": catalog_name,
        "entries_count": len(rows),
        "tipo": tipo_lista,
        "entradas": len(rows),
        "salteadas": salteadas,
        "warnings": warnings_list,
    }


# ── Upload Excel catalog (multi-tab) ─────────────────────────────────────────


def _parse_excel_rows(ws, warnings_list: list[str] | None = None) -> list[dict]:  # type: ignore[no-untyped-def]
    """Extract rows from an openpyxl worksheet using flexible column aliases."""
    if warnings_list is None:
        warnings_list = []
    data_rows = list(ws.iter_rows(values_only=True))
    if not data_rows:
        return []

    # Find header row (first row with at least one non-None value)
    header_idx = 0
    headers: list[str] = []
    for idx, row in enumerate(data_rows):
        if any(v is not None for v in row):
            headers = [str(v).strip().lower() if v is not None else "" for v in row]
            header_idx = idx
            break

    if not headers:
        return []

    # Map normalized header → column index (first occurrence wins)
    field_map: dict[str, int] = {}
    for col_idx, h in enumerate(headers):
        if h and h not in field_map:
            field_map[h] = col_idx

    def find_col(candidates: set[str]) -> int | None:
        for c in candidates:
            if c in field_map:
                return field_map[c]
        return None

    codigo_col = find_col({"codigo", "cod", "code"})
    descripcion_col = find_col({"descripcion", "descripción", "description", "nombre", "name"})
    unidad_col = find_col({"unidad", "unit", "ud"})
    precio_col = find_col(_PRICE_ALIASES)
    fecha_col = find_col(_FECHA_ALIASES)
    proveedor_col = find_col(_PROVEEDOR_ALIASES)

    if descripcion_col is None or precio_col is None:
        return []

    def _cell(row: tuple, idx: int | None) -> str:
        if idx is None or idx >= len(row):
            return ""
        v = row[idx]
        return str(v).strip() if v is not None else ""

    rows: list[dict] = []
    for row_no, row in enumerate(data_rows[header_idx + 1:], start=header_idx + 2):
        if not any(v is not None for v in row):
            continue  # skip blank rows

        codigo = _cell(row, codigo_col) if codigo_col is not None else ""
        descripcion = _cell(row, descripcion_col)
        unidad = _cell(row, unidad_col) if unidad_col is not None else ""
        precio_raw = _cell(row, precio_col)

        if not descripcion or not precio_raw:
            continue

        try:
            precio_clean = (
                precio_raw.replace(".", "").replace(",", ".")
                if "," in precio_raw
                else precio_raw
            )
            precio = float(precio_clean)
        except (ValueError, AttributeError):
            continue

        fecha_raw = row[fecha_col] if fecha_col is not None and fecha_col < len(row) else None
        proveedor = _cell(row, proveedor_col) if proveedor_col is not None else ""

        rows.append({
            "codigo": codigo,
            "descripcion": descripcion,
            "unidad": unidad,
            "precio_sin_iva": precio,
            "fecha_precio": _fecha_or_warning(fecha_raw, f"{ws.title} fila {row_no}", warnings_list),
            "proveedor": proveedor or None,
        })

    return rows


@router.post("/upload-excel")
async def upload_excel_catalog(
    file: UploadFile = File(...),
    name: str = Query(None, description="Comienzo del nombre de los catálogos (si no se indica, el nombre del archivo)"),
    user: dict = Depends(require_editor),
):
    """Upload an Excel file (.xlsx/.xls) with up to 4 tabs and create one catalog per tab.

    Tab name matching (case-insensitive):
    - Materiales / Material / Mat → tipo material
    - Mano de obra / mano_obra / MO → tipo mano_obra
    - Equipos / Equipo / Eq → tipo equipo
    - Subcontratos / Subcontrato / Sub → tipo subcontrato

    Each tab must have columns: codigo, descripcion, unidad + a price column
    (flexible aliases accepted: precio_unitario, precio_sin_iva, precio, costo, etc.)
    """
    if file.filename and not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "El archivo tiene que ser un Excel (.xlsx o .xls)")

    try:
        import openpyxl  # type: ignore[import]
    except ImportError:
        raise HTTPException(500, "El servidor no puede leer archivos Excel (falta openpyxl)")

    content = await file.read()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(400, f"No se pudo leer el archivo Excel: {exc}")

    db = get_data_db()
    org_id = user["org_id"]
    base_name = name or (file.filename or "catalogo").rsplit(".", 1)[0]

    catalogs_created = 0
    entries_summary: dict[str, int] = {}
    warnings_list: list[str] = []

    for sheet_name in wb.sheetnames:
        tipo = TAB_TIPO_MAP.get(sheet_name.strip().lower())
        if tipo is None:
            warnings_list.append(f"Solapa '{sheet_name}' no se cargó: el nombre no es uno de los conocidos")
            continue

        ws = wb[sheet_name]
        try:
            rows = _parse_excel_rows(ws, warnings_list)
        except Exception as exc:
            warnings_list.append(f"Solapa '{sheet_name}' no se pudo leer: {exc}")
            continue

        if not rows:
            warnings_list.append(f"Solapa '{sheet_name}' no se cargó: no tiene filas válidas")
            continue

        # Create catalog
        catalog_name = f"{base_name} - {sheet_name}"
        catalog_result = db.table("price_catalogs").insert({
            "org_id": org_id,
            "name": catalog_name,
            "source_file": file.filename,
        }).execute()

        if not catalog_result.data:
            warnings_list.append(f"No se pudo crear el catálogo de la solapa '{sheet_name}'")
            continue

        catalog_id = catalog_result.data[0]["id"]

        # Insert entries with tipo
        entries = [
            {
                "catalog_id": catalog_id,
                "org_id": org_id,
                "tipo": tipo,
                **row,
                "fuente": fuente_importada(file.filename),
            }
            for row in rows
        ]
        insert_entries(db, entries)

        catalogs_created += 1
        entries_summary[tipo] = entries_summary.get(tipo, 0) + len(entries)

    wb.close()

    if catalogs_created == 0:
        raise HTTPException(
            400,
            "No se creó ningún catálogo. Revisá que las solapas se llamen: "
            "Materiales, Mano de obra, Equipos, Subcontratos (o variantes como Mat, MO, Eq, Sub).",
        )

    return {
        "catalogs_created": catalogs_created,
        "entries": entries_summary,
        "warnings": warnings_list,
        "source_file": file.filename,
    }


# ── List catalogs ───────────────────────────────────────────────────────────


@router.get("")
async def list_catalogs(user: dict = Depends(get_current_user)):
    """List all price catalogs for the org."""
    db = get_data_db()
    result = (
        db.table("price_catalogs")
        .select("*")
        .eq("org_id", user["org_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


# ── Catálogo oficial ─────────────────────────────────────────────────────────


@router.patch("/{catalog_id}")
async def update_catalog(
    catalog_id: UUID,
    data: dict = Body(...),
    user: dict = Depends(require_admin),
):
    """Mark a catalog as oficial (the app prices with it) or only for reference.

    Body: {"oficial": true|false}. Returns the updated catalog row.
    """
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)

    oficial = data.get("oficial") if isinstance(data, dict) else None
    if not isinstance(oficial, bool):
        raise HTTPException(400, "Indicá si el catálogo es oficial: true o false")

    catalog = (
        db.table("price_catalogs")
        .select("*")
        .eq("id", cid)
        .eq("org_id", org_id)
        .limit(1)
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catálogo no encontrado")

    result = (
        db.table("price_catalogs")
        .update({"oficial": oficial})
        .eq("id", cid)
        .eq("org_id", org_id)
        .execute()
    )
    return result.data[0] if result.data else {**catalog.data[0], "oficial": oficial}


# ── List catalog entries ────────────────────────────────────────────────────


@router.get("/{catalog_id}/entries")
async def list_catalog_entries(
    catalog_id: UUID,
    tipo: str | None = Query(None, description="Filtrar por tipo: material, mano_obra, equipo, subcontrato"),
    user: dict = Depends(get_current_user),
):
    """List entries in a catalog, with optional tipo filter."""
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)

    # Verify catalog belongs to org
    catalog = (
        db.table("price_catalogs")
        .select("id")
        .eq("id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catálogo no encontrado")

    q = (
        db.table("catalog_entries")
        .select("*")
        .eq("catalog_id", cid)
        .eq("org_id", org_id)
    )
    if tipo:
        q = q.eq("tipo", tipo)

    result = q.order("codigo").execute()
    return [with_fuente(e) for e in result.data or []]


# ── Search catalog entries ──────────────────────────────────────────────────


@router.get("/{catalog_id}/search")
async def search_catalog_entries(
    catalog_id: UUID,
    q: str = Query(..., min_length=1, description="Texto a buscar en la descripción"),
    user: dict = Depends(get_current_user),
):
    """Search catalog entries by description (case-insensitive)."""
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)

    # Verify catalog belongs to org
    catalog = (
        db.table("price_catalogs")
        .select("id")
        .eq("id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catálogo no encontrado")

    result = (
        db.table("catalog_entries")
        .select("*")
        .eq("catalog_id", cid)
        .eq("org_id", org_id)
        .ilike("descripcion", f"%{q}%")
        .execute()
    )
    return result.data or []


# ── Delete catalog ───────────────────────────────────────────────────────────


@router.delete("/{catalog_id}")
async def delete_catalog(
    catalog_id: UUID,
    user: dict = Depends(require_admin),
):
    """Delete a price catalog and all its entries."""
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)

    # Verify catalog belongs to org
    catalog = (
        db.table("price_catalogs")
        .select("id")
        .eq("id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catálogo no encontrado")

    # Delete entries first, then catalog
    db.table("catalog_entries").delete().eq("catalog_id", cid).eq("org_id", org_id).execute()
    db.table("price_catalogs").delete().eq("id", cid).eq("org_id", org_id).execute()

    return {"deleted": True, "catalog_id": cid}


# ── Create catalog entry ─────────────────────────────────────────────────────


@router.post("/{catalog_id}/entries")
async def create_catalog_entry(
    catalog_id: UUID,
    data: dict = Body(...),
    user: dict = Depends(require_editor),
):
    """Create a new entry in a catalog."""
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)

    # Verify catalog belongs to org
    catalog = (
        db.table("price_catalogs")
        .select("id")
        .eq("id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catálogo no encontrado")

    try:
        precio = price_from_payload(data)
        fecha = fecha_iso(data.get("fecha_precio"))
        fuente = fuente_from_payload(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    entry = {
        "catalog_id": cid,
        "org_id": org_id,
        "codigo": data.get("codigo", ""),
        "descripcion": data.get("descripcion", ""),
        "unidad": data.get("unidad", ""),
        "precio_sin_iva": precio if precio is not None else 0,
        "tipo": data.get("tipo", "material"),
        # A price typed in by hand is dated today unless the user says otherwise. Without a
        # price it stays undated: a dated 0 means "va en $0" (budget_prices.is_price)
        "fecha_precio": fecha or (today().isoformat() if precio is not None else None),
        "proveedor": data.get("proveedor") or None,
        # Where the price came from: what the screen says (ej. the price search), else "Cargado a mano"
        "fuente": fuente.get("fuente") or FUENTE_A_MANO,
        "fuente_url": fuente.get("fuente_url"),
    }
    created = insert_entries(db, [entry])
    if not created:
        raise HTTPException(500, "No se pudo crear el precio. Probá de nuevo.")
    return with_fuente(created[0])


# ── Update catalog entry ─────────────────────────────────────────────────────


@router.patch("/{catalog_id}/entries/{entry_id}")
async def update_catalog_entry(
    catalog_id: UUID,
    entry_id: UUID,
    data: dict = Body(...),
    user: dict = Depends(require_editor),
):
    """Update an existing catalog entry."""
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)
    eid = str(entry_id)

    # Verify entry belongs to catalog and org
    # select("*"): the history row is built from the whole entry. Without migration 012 the
    # origin is dropped when saving (_update_entry), with no error
    entry = (
        db.table("catalog_entries")
        .select("*")
        .eq("id", eid)
        .eq("catalog_id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not entry.data:
        raise HTTPException(404, "Entrada no encontrada")

    # Only allow updating known fields
    allowed = {"codigo", "descripcion", "unidad", "tipo", "proveedor"}
    update_data = {k: v for k, v in data.items() if k in allowed}
    try:
        precio = price_from_payload(data)
        if precio is not None:
            update_data["precio_sin_iva"] = precio
        if "fecha_precio" in data:
            update_data["fecha_precio"] = fecha_iso(data["fecha_precio"])
        update_data.update(fuente_from_payload(data))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not update_data:
        raise HTTPException(400, "No hay datos válidos para actualizar")
    if "fuente" not in update_data and price_changed(entry.data, update_data):
        # A new price typed by hand: the old origin (ej. "Internet: Easy") no longer applies
        update_data["fuente"] = FUENTE_A_MANO
        update_data["fuente_url"] = None

    saved = update_entries(db, org_id, [({**entry.data, "id": eid}, update_data)])
    return with_fuente(saved[0]) if saved else {"updated": True}


# ── Price history of an entry ────────────────────────────────────────────────


@router.get("/{catalog_id}/entries/{entry_id}/history")
async def get_entry_price_history(
    catalog_id: UUID,
    entry_id: UUID,
    user: dict = Depends(get_current_user),
):
    """List the price history of a catalog entry, newest first."""
    db = get_data_db()
    org_id = user["org_id"]
    eid = str(entry_id)

    entry = (
        db.table("catalog_entries")
        .select("*")
        .eq("id", eid)
        .eq("catalog_id", str(catalog_id))
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not entry.data:
        raise HTTPException(404, "Entrada no encontrada")

    result = (
        db.table("catalog_price_history")
        .select("*")
        .eq("entry_id", eid)
        .eq("org_id", org_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [historial_con_proveedor(with_fuente(h), entry.data) for h in result.data or []]


def historial_con_proveedor(row: dict, entry: dict) -> dict:
    """A history row with ``proveedor``: the row's own (saved since migration 012). Older rows have
    none: the entry's provider is only known for the value the entry has now (same price and date);
    the others get null rather than a provider that may not be theirs."""
    if row.get("proveedor") is not None:
        return row
    actual = (price_changed(entry, {"precio_sin_iva": row.get("precio_sin_iva"),
                                    "fecha_precio": row.get("fecha_precio")}) is False
              and entry.get("precio_sin_iva") is not None)
    return {**row, "proveedor": entry.get("proveedor") if actual else None}


# ── Delete catalog entry ─────────────────────────────────────────────────────


@router.delete("/{catalog_id}/entries/{entry_id}")
async def delete_catalog_entry(
    catalog_id: UUID,
    entry_id: UUID,
    user: dict = Depends(require_editor),
):
    """Delete a single entry from a catalog."""
    db = get_data_db()
    org_id = user["org_id"]
    cid = str(catalog_id)
    eid = str(entry_id)

    # Verify entry belongs to catalog and org
    entry = (
        db.table("catalog_entries")
        .select("id")
        .eq("id", eid)
        .eq("catalog_id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not entry.data:
        raise HTTPException(404, "Entrada no encontrada")

    db.table("catalog_entries").delete().eq("id", eid).eq("org_id", org_id).execute()
    return {"deleted": True, "entry_id": eid}


# ── Apply catalog prices to budget ──────────────────────────────────────────


@router.post("/apply/{budget_id}/{catalog_id}")
async def apply_catalog_to_budget(
    budget_id: UUID,
    catalog_id: UUID,
    user: dict = Depends(require_editor),
):
    """Apply catalog prices to budget item_resources by matching codigo.

    For each item_resource in the budget, look up its price from the catalog
    (match by codigo) and update precio_unitario. Recalculate subtotals.
    """
    db = get_data_db()
    org_id = user["org_id"]
    bid = str(budget_id)
    cid = str(catalog_id)

    budget = _get_budget(db, bid, org_id)

    # Verify catalog belongs to org
    catalog = (
        db.table("price_catalogs")
        .select("id")
        .eq("id", cid)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not catalog.data:
        raise HTTPException(404, "Catálogo no encontrado")

    # Same recalculation as "Actualizar precios" (every resource tipo, what the client
    # buys at $0, the cascade of the budget)
    result = apply_catalog(db, org_id, budget, cid)
    if not result["matched"] and not result["unmatched"]:
        raise HTTPException(404, "Los trabajos del presupuesto no tienen recursos")
    return {
        "items_matched": result["matched"],
        "items_unmatched": result["unmatched"],
        "total_updated": result["total_updated"],
    }
