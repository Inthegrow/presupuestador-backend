"""Helpers for dated catalog prices and their history (Fase 1)."""

from __future__ import annotations

import re
from datetime import date, datetime

_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d.%m.%Y")


def normalize_codigo(value: object) -> str:
    """Upper-case a code and collapse whitespace: ' h 30 ' -> 'H 30'."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().upper()


def parse_fecha(value: object) -> date | None:
    """Parse a price date from a date, datetime or string. Empty -> None.

    Raises ValueError when there is a value that is not a recognizable date,
    so bad data is reported instead of silently dropped.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    # Accept ISO timestamps like 2026-03-01T00:00:00
    text = text.split("T")[0].split(" ")[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Fecha no reconocida: {value!r}")


def fecha_iso(value: object) -> str | None:
    """parse_fecha, returned as 'YYYY-MM-DD' (what Supabase expects) or None."""
    parsed = parse_fecha(value)
    return parsed.isoformat() if parsed else None


def price_from_payload(data: dict) -> float | None:
    """Read the price sent by the client. Accepts precio_unitario as an alias."""
    for key in ("precio_sin_iva", "precio_unitario"):
        if key in data and data[key] is not None and data[key] != "":
            return float(data[key])
    return None


def history_row(entry: dict) -> dict:
    """Build a catalog_price_history row from a saved catalog entry."""
    return {
        "entry_id": entry["id"],
        "org_id": entry["org_id"],
        "precio_sin_iva": entry.get("precio_sin_iva"),
        "fecha_precio": entry.get("fecha_precio"),
    }


def price_changed(old: dict, new: dict) -> bool:
    """True when an update changes the price or its date."""
    if "precio_sin_iva" in new:
        old_p = old.get("precio_sin_iva")
        new_p = new.get("precio_sin_iva")
        if (old_p is None) != (new_p is None):
            return True
        if old_p is not None and float(old_p) != float(new_p):
            return True
    if "fecha_precio" in new and (old.get("fecha_precio") or None) != (new.get("fecha_precio") or None):
        return True
    return False
