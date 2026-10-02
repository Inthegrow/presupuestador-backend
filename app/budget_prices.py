"""Fase 4: cada obra con sus números.

- Indirectos por presupuesto: ``budgets.indirectos`` guarda los % de la obra.
  Arrancan con los valores generales (``indirect_config``) y se pueden cambiar
  en esa obra sin tocar las demás. ``{}`` = la obra usa los generales.
- Precios con fecha: elegir el último precio de un recurso a una fecha dada.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.catalog_prices import normalize_codigo, parse_fecha

# Cascade percentages (whole numbers: 15 = 15%). Same defaults as calc_cascade_indirects.
INDIRECT_DEFAULTS: dict[str, float] = {
    "imprevistos_pct": 3,
    "estructura_pct": 15,
    "jefatura_pct": 8,
    "logistica_pct": 5,
    "herramientas_pct": 3,
    "beneficio_pct": 10,
    "ingresos_brutos_pct": 7,
    "imp_cheque_pct": 1.2,
    "iva_pct": 21,
}
INDIRECT_KEYS = tuple(INDIRECT_DEFAULTS)

_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# PostgREST returns at most this many rows per request (Supabase default)
PAGE_SIZE = 1000


def today() -> date:
    """Today in Argentina (the server runs in UTC)."""
    return datetime.now(_TZ).date()


def fetch_all(make_query, page_size: int = PAGE_SIZE) -> list[dict]:
    """Read every row of a query, page by page.

    ``make_query()`` must return a fresh query with a stable order (ej. by id).
    Without paging, the API silently cuts the result at ``page_size`` rows.
    """
    rows: list[dict] = []
    start = 0
    while True:
        batch = make_query().range(start, start + page_size - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        start += page_size


# ── Indirectos ──────────────────────────────────────────────────────────────


def general_indirects(org_config: dict | None) -> dict[str, float]:
    """The organization's values, with defaults for the missing ones."""
    org_config = org_config or {}
    return {
        k: (org_config[k] if org_config.get(k) is not None else default)
        for k, default in INDIRECT_DEFAULTS.items()
    }


def budget_overrides(budget: dict | None) -> dict[str, float]:
    """The budget's own values (only known keys that have a value)."""
    raw = (budget or {}).get("indirectos") or {}
    if not isinstance(raw, dict):
        return {}
    return {k: raw[k] for k in INDIRECT_KEYS if raw.get(k) is not None}


def effective_indirects(org_config: dict | None, budget: dict | None) -> dict[str, float]:
    """Values used for this budget: defaults < generales < obra."""
    return {**general_indirects(org_config), **budget_overrides(budget)}


def load_org_config(db, org_id: str) -> dict:
    """Raw indirect_config row of the organization ({} when there is none)."""
    rows = (
        db.table("indirect_config")
        .select("*")
        .eq("org_id", org_id)
        .limit(1)
        .execute()
        .data or []
    )
    return rows[0] if rows else {}


def save_org_config(db, org_id: str, data: dict) -> dict:
    """Upsert the organization's indirect_config row and return it."""
    existing = load_org_config(db, org_id)
    if existing:
        result = db.table("indirect_config").update(data).eq("org_id", org_id).execute()
    else:
        result = db.table("indirect_config").insert({"org_id": org_id, **data}).execute()
    return result.data[0] if result.data else {**existing, **data}


def initial_indirects(db, org_id: str) -> dict[str, float]:
    """Values a new budget starts with: a copy of the general ones."""
    return general_indirects(load_org_config(db, org_id))


def budget_config(db, org_id: str, budget: dict | None) -> dict:
    """Full config for the cascade of one budget (org row + the obra's %)."""
    org_config = load_org_config(db, org_id)
    return {**org_config, **effective_indirects(org_config, budget)}


# ── Precios a una fecha ─────────────────────────────────────────────────────


def pick_price(entry: dict, history: list[dict], fecha: date) -> tuple[float, str | None] | None:
    """Last price of a catalog entry on or before ``fecha``.

    Candidates are the history rows and the entry's current price. A dated
    price wins over an undated one; with the same date, the newest wins.
    Returns (precio, 'YYYY-MM-DD' or None) or None when there is no price.
    """
    candidates: list[tuple[date, str, float, date | None]] = []

    def add(precio: object, fecha_precio: object, orden: str) -> None:
        if precio is None or precio == "":
            return
        try:
            f = parse_fecha(fecha_precio)
        except ValueError:
            f = None
        if f is not None and f > fecha:
            return
        candidates.append((f or date.min, orden, float(precio), f))

    for h in history:
        add(h.get("precio_sin_iva"), h.get("fecha_precio"), str(h.get("created_at") or ""))
    # The entry holds the current value: among equal dates it is the newest
    add(entry.get("precio_sin_iva"), entry.get("fecha_precio"), "~")

    if not candidates:
        return None
    _, _, precio, f = max(candidates, key=lambda c: (c[0], c[1]))
    return precio, (f.isoformat() if f else None)


def _dated(entry: dict) -> date | None:
    try:
        return parse_fecha(entry.get("fecha_precio"))
    except ValueError:
        return None


def find_entry(
    resource: dict,
    by_id: dict[str, dict],
    by_codigo: dict[str, list[dict]],
    *,
    fecha: date | None = None,
    history: dict[str, list[dict]] | None = None,
) -> tuple[dict | None, str | None]:
    """Catalog entry of a resource: by catalog_entry_id, else by code.

    The same code may live in several catalogs (the Maestro plus the catalogs
    imported with each old obra). Among the candidates of the same tipo, the
    tie is broken by what is in force at ``fecha`` (today when omitted):
      1. an entry with a price in force at ``fecha`` (pick_price over its history)
         beats one without; among them, the newest price date wins;
      2. an entry whose price is *dated* but has no value yet (the Maestro keeps
         it, the price is pending) still beats one that never had a date: the
         app must ask for the price rather than use an unmaintained value;
      3. then the most recently created catalog (``_catalogo_creado``);
      4. an exact tie is reported as 'duplicado'.

    Returns (entry, problem). problem is None, 'sin_precio' or 'duplicado'.
    """
    entry_id = resource.get("catalog_entry_id")
    if entry_id and str(entry_id) in by_id:
        return by_id[str(entry_id)], None
    codigo = normalize_codigo(resource.get("codigo"))
    if not codigo:
        return None, None
    matches = by_codigo.get(codigo, [])
    if not matches:
        return None, "sin_precio"
    # Recipes also use 'mo_material' (nails, wire, discs); catalogs only know 'material'
    tipo = "material" if resource.get("tipo") == "mo_material" else resource.get("tipo")
    same_tipo = [e for e in matches if e.get("tipo") == tipo]
    candidates = same_tipo or (matches if len(matches) == 1 else [])
    if len(candidates) == 1:
        return candidates[0], None
    if not candidates:
        return None, "duplicado"

    at = fecha or today()
    hist = history or {}

    def rank(e: dict) -> tuple:
        found = pick_price(e, hist.get(str(e.get("id")), []), at)
        vigente = found is not None and found[0] > 0
        fecha_vigente = parse_fecha(found[1]) if vigente and found[1] else None
        # An undated value is "in force" but unmaintained: a maintained (dated) entry
        # outranks it even when its price is still pending or not yet in force.
        mantenida = _dated(e) is not None or fecha_vigente is not None
        return (
            mantenida,
            vigente and fecha_vigente is not None,
            fecha_vigente or date.min,
            vigente,
            str(e.get("_catalogo_creado") or ""),
        )

    ordered = sorted(candidates, key=rank, reverse=True)
    if rank(ordered[0]) != rank(ordered[1]):
        return ordered[0], None
    return None, "duplicado"


def catalog_created_at(db, org_id: str) -> dict[str, str]:
    """{catalog_id: created_at} of the org's price catalogs (tie-break in find_entry)."""
    rows = db.table("price_catalogs").select("id,created_at").eq("org_id", org_id).execute().data or []
    return {c["id"]: str(c.get("created_at") or "") for c in rows}


def load_price_lookup(db, org_id: str, fecha: date):
    """Build ``price_for(resource)`` for the org's catalogs at ``fecha``.

    price_for returns (precio, fecha_precio, entry_id) or None, and records
    resources without a price in ``problemas`` (list of dicts).
    """
    entries = fetch_all(
        lambda: db.table("catalog_entries").select("*").eq("org_id", org_id).order("id")
    )
    created = catalog_created_at(db, org_id)
    by_id = {str(e["id"]): {**e, "_catalogo_creado": created.get(e.get("catalog_id"))} for e in entries}
    by_codigo: dict[str, list[dict]] = {}
    for e in by_id.values():
        codigo = normalize_codigo(e.get("codigo"))
        if codigo:
            by_codigo.setdefault(codigo, []).append(e)

    history: dict[str, list[dict]] = {}
    ids = list(by_id)
    for start in range(0, len(ids), 200):
        chunk = ids[start:start + 200]
        rows = fetch_all(
            lambda chunk=chunk: db.table("catalog_price_history")
            .select("*")
            .eq("org_id", org_id)
            .in_("entry_id", chunk)
            .order("id")
        )
        for h in rows:
            history.setdefault(str(h["entry_id"]), []).append(h)

    problemas: list[dict] = []

    def price_for(resource: dict) -> tuple[float, str | None, str] | None:
        entry, problem = find_entry(resource, by_id, by_codigo, fecha=fecha, history=history)
        found = pick_price(entry, history.get(str(entry["id"]), []), fecha) if entry else None
        if found is None:
            if entry is not None:
                problem = "sin_precio"
            if problem:
                problemas.append({
                    "codigo": resource.get("codigo"),
                    "descripcion": resource.get("descripcion"),
                    "motivo": problem,
                })
            return None
        return found[0], found[1], str(entry["id"])

    return price_for, problemas
