"""Smart recipes: template resources with formulas, parameters and inheritance.

Pure functions (no DB). Used by the templates router (apply / preview) and by
the cascade recalculation.

Template resource (inside item_templates.recursos):
    {"tipo": "material", "codigo": "H30", "formula": "Q * espesor",
     "desperdicio_pct": 10,          # optional: missing = inherit
     "lo_compra_cliente": false,     # shown, but does not add to cost
     "redondear": true, "unidad_compra": 50}   # round the whole-budget total

    {"tipo": "mano_obra", "codigo": "MO-OF", "trabajadores": 3,
     "rendimiento": 10}              # Q units per day -> dias = Q / rendimiento

Old resources (cantidad_por_unidad, trabajadores_por_unidad, dias_por_unidad)
keep working as before.
"""

from __future__ import annotations

import math

from app.formulas import FormulaError, evaluate, is_valid_name, validate

ORIGEN_RECURSO = "recurso"
ORIGEN_PRESUPUESTO = "presupuesto"
ORIGEN_PLANTILLA = "plantilla"
ORIGEN_ORGANIZACION = "organizacion"

_TIPOS = {"material", "mano_obra", "equipo", "subcontrato", "mo_material"}


def _num(value: object) -> float | None:
    """Number or None (empty strings and invalid values are None)."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        return float(str(value).replace(",", ".")) if isinstance(value, str) else float(value)
    except (TypeError, ValueError):
        return None


def _or_default(value: object, default: float) -> float:
    """Number, or default only when missing (an explicit 0 is kept)."""
    number = _num(value)
    return float(default) if number is None else number


def _is_number(value: object) -> bool:
    return _num(value) is not None


# ── Parameters ───────────────────────────────────────────────────────────────


def param_defaults(parametros: object) -> dict[str, float]:
    """Template parameters as {clave: valor}. Accepts a list or a dict."""
    if isinstance(parametros, dict):
        return {k: float(_num(v) or 0) for k, v in parametros.items()}
    result: dict[str, float] = {}
    for p in parametros or []:
        clave = (p or {}).get("clave")
        if clave:
            result[clave] = float(_num(p.get("valor")) or 0)
    return result


def merge_params(defaults: dict[str, float], overrides: dict | None) -> dict[str, float]:
    """Template defaults, replaced by the budget's values. Unknown keys are ignored."""
    merged = dict(defaults)
    for clave, valor in (overrides or {}).items():
        if clave in merged and _num(valor) is not None:
            merged[clave] = float(_num(valor))
    return merged


# ── Validation ───────────────────────────────────────────────────────────────


def validate_template(recursos: list[dict], parametros: list[dict] | None) -> list[str]:
    """Return a list of readable errors (empty = OK)."""
    errors: list[str] = []
    claves: set[str] = set()
    for i, p in enumerate(parametros or [], start=1):
        clave = (p or {}).get("clave", "")
        if not is_valid_name(clave):
            errors.append(
                f"Parámetro {i}: nombre '{clave}' no válido "
                "(solo letras, números y _, sin empezar con número; 'Q' está reservado)"
            )
        elif clave in claves:
            errors.append(f"Parámetro '{clave}' repetido")
        if _num((p or {}).get("valor")) is None:
            errors.append(f"Parámetro '{clave}': el valor tiene que ser un número")
        claves.add(clave)

    allowed = claves | {"Q"}
    for i, r in enumerate(recursos or [], start=1):
        name = r.get("codigo") or r.get("descripcion") or f"#{i}"
        if r.get("tipo", "material") not in _TIPOS:
            errors.append(f"Recurso {name}: tipo '{r.get('tipo')}' no válido")
        for field, label in (("formula", "fórmula"), ("rendimiento", "rendimiento")):
            value = r.get(field)
            if value in (None, "") or _is_number(value):
                continue
            try:
                validate(str(value), allowed)
            except FormulaError as exc:
                errors.append(f"Recurso {name}, {label}: {exc}")
        if r.get("rendimiento") not in (None, "") and _is_number(r.get("rendimiento")):
            if _num(r["rendimiento"]) <= 0:
                errors.append(f"Recurso {name}: el rendimiento tiene que ser mayor que 0")
        if r.get("unidad_compra") not in (None, ""):
            uc = _num(r.get("unidad_compra"))
            if uc is None or uc <= 0:
                errors.append(f"Recurso {name}: la unidad de compra tiene que ser mayor que 0")
        pct = r.get("desperdicio_pct")
        if pct not in (None, "") and _num(pct) is None:
            errors.append(f"Recurso {name}: el desperdicio tiene que ser un número")
    return errors


# ── Waste inheritance ────────────────────────────────────────────────────────


def resolve_waste(
    recurso_pct: object = None,
    presupuesto_pct: object = None,
    plantilla_pct: object = None,
    organizacion_pct: object = None,
) -> tuple[float, str]:
    """Pick the most specific waste %: recurso > presupuesto > plantilla > organización.

    An explicit 0 counts as a value (it is not "missing").
    """
    for value, origen in (
        (recurso_pct, ORIGEN_RECURSO),
        (presupuesto_pct, ORIGEN_PRESUPUESTO),
        (plantilla_pct, ORIGEN_PLANTILLA),
        (organizacion_pct, ORIGEN_ORGANIZACION),
    ):
        if _num(value) is not None:
            return float(_num(value)), origen
    return 0.0, ORIGEN_ORGANIZACION


# ── Quantities ───────────────────────────────────────────────────────────────


def _value(expr: object, variables: dict[str, float]) -> float:
    """A fixed number or a formula."""
    if _is_number(expr):
        return float(_num(expr))
    return evaluate(str(expr), variables)


def labor_days(qty: float, rendimiento: object, variables: dict[str, float]) -> float:
    """dias = Q / rendimiento (rendimiento = units per day)."""
    rend = _value(rendimiento, variables)
    if rend <= 0:
        raise FormulaError("El rendimiento tiene que ser mayor que 0")
    return qty / rend


def quantify(resource: dict, qty: float, params: dict[str, float]) -> dict:
    """Quantity fields for a resource: cantidad (or trabajadores/dias for labor)."""
    variables = {**params, "Q": float(qty)}
    tipo = resource.get("tipo", "material")

    if tipo == "mano_obra":
        if resource.get("rendimiento") not in (None, ""):
            trabajadores = _num(resource.get("trabajadores"))
            return {
                "trabajadores": trabajadores if trabajadores is not None else 1.0,
                "dias": round(labor_days(qty, resource["rendimiento"], variables), 4),
            }
        return {
            "trabajadores": float(_num(resource.get("trabajadores_por_unidad")) or 0) * qty,
            "dias": float(_num(resource.get("dias_por_unidad")) or 0),
        }

    if resource.get("formula") not in (None, ""):
        cantidad = _value(resource["formula"], variables)
    else:
        cantidad = float(_num(resource.get("cantidad_por_unidad")) or 0) * qty
    return {"cantidad": round(cantidad, 4)}


def expand_resource(
    resource: dict,
    qty: float,
    params: dict[str, float],
    *,
    presupuesto_pct: object = None,
    plantilla_pct: object = None,
    organizacion_pct: object = None,
) -> dict:
    """Template resource -> item_resources fields (without price)."""
    tipo = resource.get("tipo", "material")
    pct, origen = resolve_waste(
        resource.get("desperdicio_pct"), presupuesto_pct, plantilla_pct, organizacion_pct
    )
    row = {
        "tipo": tipo,
        "codigo": resource.get("codigo", ""),
        "descripcion": resource.get("descripcion", ""),
        "unidad": "jornal" if tipo == "mano_obra" else resource.get("unidad", ""),
        "cantidad": 0,
        "trabajadores": 0,
        "dias": 0,
        "cargas_sociales_pct": _or_default(resource.get("cargas_sociales_pct"), 25),
        "desperdicio_pct": 0 if tipo == "mano_obra" else pct,
        "desperdicio_origen": None if tipo == "mano_obra" else origen,
        "formula": resource.get("formula") or None,
        "rendimiento": str(resource["rendimiento"]) if resource.get("rendimiento") not in (None, "") else None,
        "lo_compra_cliente": bool(resource.get("lo_compra_cliente")),
        "redondear": bool(resource.get("redondear")),
        "unidad_compra": _or_default(resource.get("unidad_compra"), 1),
        "cantidad_redondeo": 0,
    }
    row.update(quantify(resource, qty, params))
    return row


def requantify_row(row: dict, qty: float, params: dict[str, float]) -> dict:
    """Re-evaluate the formula / rendimiento stored on an item_resources row (mutates it).

    Rows without formula or rendimiento keep their quantities.
    """
    tipo = row.get("tipo")
    if tipo == "mano_obra" and row.get("rendimiento") not in (None, ""):
        row["dias"] = round(labor_days(qty, row["rendimiento"], {**params, "Q": float(qty)}), 4)
    elif tipo != "mano_obra" and row.get("formula") not in (None, ""):
        row["cantidad"] = round(_value(row["formula"], {**params, "Q": float(qty)}), 4)
    return row


def has_formula(row: dict) -> bool:
    return row.get("formula") not in (None, "") or row.get("rendimiento") not in (None, "")


# ── Purchase rounding (whole budget) ─────────────────────────────────────────


def _rounding_key(row: dict) -> tuple:
    """Rows are summed together only if they are the same material in the same unit."""
    name = (row.get("codigo") or row.get("descripcion") or "").strip().lower()
    unidad = (row.get("unidad") or "").strip().lower()
    return (row.get("tipo"), name, unidad, float(_num(row.get("unidad_compra")) or 1))


def apply_purchase_rounding(rows: list[dict]) -> list[dict]:
    """Round up to whole purchase units over the budget total (mutates rows).

    Only rows with ``redondear`` and not bought by the client. Same material in
    several items is summed first, then rounded once. The extra is split among
    the rows in proportion to their quantity (``cantidad_redondeo``) so item
    totals still add up to the budget total.

    Expects cantidad_efectiva and subtotal already calculated (without rounding).
    Returns one summary line per rounded material.
    """
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        row["cantidad_redondeo"] = 0
        if row.get("redondear") and not row.get("lo_compra_cliente") and row.get("tipo") != "mano_obra":
            groups.setdefault(_rounding_key(row), []).append(row)

    summary = []
    for (_tipo, _name, _unidad, unidad_compra), group in groups.items():
        necesaria = sum(float(r.get("cantidad_efectiva") or 0) for r in group)
        if necesaria <= 0:
            continue
        envases = math.ceil(round(necesaria / unidad_compra, 6))
        compra = envases * unidad_compra
        extra = compra - necesaria

        repartido = 0.0
        costo_extra = 0.0
        for i, r in enumerate(group):
            base = float(r.get("cantidad_efectiva") or 0)
            if i == len(group) - 1:
                share = extra - repartido
            else:
                share = round(extra * base / necesaria, 4)
                repartido += share
            r["cantidad_redondeo"] = round(share, 4)
            r["cantidad_efectiva"] = round(base + share, 4)
            before = float(r.get("subtotal") or 0)
            r["subtotal"] = round(r["cantidad_efectiva"] * float(r.get("precio_unitario") or 0), 2)
            # Real increase of each row, with its own price
            costo_extra += r["subtotal"] - before

        summary.append({
            "codigo": group[0].get("codigo"),
            "descripcion": group[0].get("descripcion"),
            "unidad": group[0].get("unidad"),
            "unidad_compra": unidad_compra,
            "cantidad_necesaria": round(necesaria, 4),
            "cantidad_compra": round(compra, 4),
            "envases": envases,
            "extra": round(extra, 4),
            "costo_extra": round(costo_extra, 2),
            "items": len({r.get("item_id") for r in group}),
        })
    return summary
