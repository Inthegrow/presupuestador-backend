"""Pure calculation functions for budget cost derivations.

All functions are side-effect free and operate on plain dicts.
Numeric safety is handled via safe_float from app.tree.

Cascade model (Excel-based):
  Resources → Unit Prices → Direct → Cascaded Indirects → Net → Total
"""

from __future__ import annotations

from app.tree import safe_float


def _sf(value: object) -> float:
    """Return safe_float result, defaulting to 0.0 for None."""
    result = safe_float(value)
    return result if result is not None else 0.0


def pct_or_default(source: dict, key: str, default: float) -> float:
    """Read a percentage, falling back to default only when it is missing.

    Unlike ``value or default``, an explicit 0 is respected (e.g. 0% beneficio).
    """
    value = source.get(key)
    if value is None or value == "":
        return float(default)
    return float(value)


def fraction_to_pct(value: object) -> float:
    """Normalize a waste/cargas value to percent (10 = 10%).

    TERRAC's Excel files store 10% as 0.1 while the DB stores 10, so values in
    (0, 1] are treated as fractions. Larger values are assumed to be percents.
    """
    number = _sf(value)
    return number * 100 if 0 < number <= 1 else number


def calc_item_totals(item: dict) -> dict:
    """Derive calculated cost fields from an item dict.

    Expects keys: cantidad, mat_unitario, mo_unitario.
    Optionally reads: indirecto_total, beneficio_total (preserved if present).

    Returns a new dict with all original keys plus derived totals:
        mat_total, mo_total, directo_total, neto_total.
    """
    cantidad = _sf(item.get("cantidad"))
    mat_unitario = _sf(item.get("mat_unitario"))
    mo_unitario = _sf(item.get("mo_unitario"))
    indirecto_total = _sf(item.get("indirecto_total"))
    beneficio_total = _sf(item.get("beneficio_total"))

    mat_total = round(cantidad * mat_unitario, 2)
    mo_total = round(cantidad * mo_unitario, 2)
    directo_total = round(mat_total + mo_total, 2)
    neto_total = round(directo_total + indirecto_total + beneficio_total, 2)

    return {
        **item,
        "mat_total": mat_total,
        "mo_total": mo_total,
        "directo_total": directo_total,
        "indirecto_total": round(indirecto_total, 2),
        "beneficio_total": round(beneficio_total, 2),
        "neto_total": neto_total,
    }


SECCION = "Seccion"

# Fields the cascade writes on a work item (calc_cascade_indirects)
CASCADE_FIELDS = (
    "indirecto_total", "beneficio_total", "impuestos_total", "neto_total", "iva_total", "total_final",
)
# Every number of a work item that follows from its direct cost
PRICE_FIELDS = ("mat_unitario", "mo_unitario", "mat_total", "mo_total", "directo_total", *CASCADE_FIELDS)


def is_section(item: dict) -> bool:
    """Rubro / section rows ("Seccion") are not works: they have no price of their own."""
    return item.get("notas") == SECCION


def is_work_item(item: dict) -> bool:
    return not is_section(item)


def price_item(item: dict, config: dict) -> dict:
    """The only rule for a work's price: its direct cost (already calculated) through
    the cascade of its budget (``config`` = effective_indirects / budget_config).

    Mutates and returns ``item``. Section rows are returned unchanged.
    """
    if is_section(item):
        return item
    return calc_cascade_indirects(item, config)


def sale_totals(item: dict, iva_pct: float = 21) -> tuple[float, float, float]:
    """(neto, iva, total_final) saved on an item.

    Items saved before the cascade wrote IVA have null ``iva_total`` / ``total_final``:
    their IVA is the IVA step of the cascade over their saved neto (never 0).
    """
    neto = _sf(item.get("neto_total"))
    iva_raw = safe_float(item.get("iva_total"))
    iva = round(neto * float(iva_pct) / 100, 2) if iva_raw is None else iva_raw
    total_raw = safe_float(item.get("total_final"))
    total = round(neto + iva, 2) if total_raw is None else total_raw
    return neto, iva, total


def calc_budget_summary(items: list[dict], iva_pct: float = 21) -> dict:
    """Sum the saved totals of the work items (section rows are not counted).

    Returns a dict with keys:
        mat_total, mo_total, directo_total, indirecto_total, beneficio_total,
        impuestos_total, neto_total, iva_total, total_final, items_count.
    ``iva_pct`` is only used for items saved without IVA (see sale_totals).
    """
    works = [i for i in items if is_work_item(i)]

    def total(key: str) -> float:
        return round(sum(_sf(i.get(key)) for i in works), 2)

    sales = [sale_totals(i, iva_pct) for i in works]
    return {
        "mat_total": total("mat_total"),
        "mo_total": total("mo_total"),
        "directo_total": total("directo_total"),
        "indirecto_total": total("indirecto_total"),
        "beneficio_total": total("beneficio_total"),
        "impuestos_total": total("impuestos_total"),
        "neto_total": round(sum(s[0] for s in sales), 2),
        "iva_total": round(sum(s[1] for s in sales), 2),
        "total_final": round(sum(s[2] for s in sales), 2),
        "items_count": len(works),
    }


def recalc_all_items(items: list[dict]) -> list[dict]:
    """Recalculate totals for every item in a list.

    Returns a new list with derived fields updated.
    """
    return [calc_item_totals(item) for item in items]


# ── Cascade calculation engine ───────────────────────────────────────────────


def calc_resource_subtotal(resource: dict) -> dict:
    """Calculate subtotal for a single resource (mutates in place, also returns it).

    For material / equipo / mo_material / subcontrato:
      cantidad_efectiva = cantidad × (1 + desperdicio_pct/100)
      subtotal = cantidad_efectiva × precio_unitario

    For mano_obra:
      cantidad_efectiva = trabajadores × dias × (1 + cargas_sociales_pct/100)
      subtotal = cantidad_efectiva × precio_unitario (jornal diario)

    Resources marked ``lo_compra_cliente`` keep their quantity but cost 0.
    """
    tipo = resource.get("tipo", "")

    if tipo == "mano_obra":
        trabajadores = float(resource.get("trabajadores") or 0)
        dias = float(resource.get("dias") or 0)
        cargas = pct_or_default(resource, "cargas_sociales_pct", 25)
        precio = float(resource.get("precio_unitario") or 0)

        cantidad_efectiva = round(trabajadores * dias * (1 + cargas / 100), 2)
        subtotal = round(cantidad_efectiva * precio, 2)
    else:
        cantidad = float(resource.get("cantidad") or 0)
        desperdicio = float(resource.get("desperdicio_pct") or 0)
        precio = float(resource.get("precio_unitario") or 0)

        cantidad_efectiva = round(cantidad * (1 + desperdicio / 100), 2)
        subtotal = round(cantidad_efectiva * precio, 2)

    if resource.get("lo_compra_cliente"):
        subtotal = 0.0

    resource["cantidad_efectiva"] = cantidad_efectiva
    resource["subtotal"] = subtotal
    return resource


def calc_item_from_resources(item: dict, resources: list[dict]) -> dict:
    """Calculate item unit prices and direct totals from its resources (mutates item).

    Groups resources by tipo:
      - material            → mat_unitario
      - mano_obra + equipo + mo_material + subcontrato → mo_unitario

    Then: unitario × cantidad = total

    Resources bought by the client (``lo_compra_cliente``) are not added.
    """
    resources = [r for r in resources if not r.get("lo_compra_cliente")]
    mat_sum = sum(float(r.get("subtotal") or 0) for r in resources if r.get("tipo") == "material")
    mo_sum = sum(float(r.get("subtotal") or 0) for r in resources if r.get("tipo") == "mano_obra")
    eq_sum = sum(float(r.get("subtotal") or 0) for r in resources if r.get("tipo") == "equipo")
    mat_ind_sum = sum(float(r.get("subtotal") or 0) for r in resources if r.get("tipo") == "mo_material")
    sub_sum = sum(float(r.get("subtotal") or 0) for r in resources if r.get("tipo") == "subcontrato")

    qty = float(item.get("cantidad") or 1)
    if qty == 0:
        qty = 1  # avoid division by zero

    item["mat_unitario"] = round(mat_sum / qty, 2)
    item["mo_unitario"] = round((mo_sum + eq_sum + mat_ind_sum + sub_sum) / qty, 2)
    item["mat_total"] = round(item["mat_unitario"] * qty, 2)
    item["mo_total"] = round(item["mo_unitario"] * qty, 2)
    item["directo_total"] = round(item["mat_total"] + item["mo_total"], 2)

    return item


def calc_cascade_indirects(item: dict, config: dict) -> dict:
    """Apply cascaded indirect costs following the Excel model (mutates item).

    Cascade order:
      Directo
      + Imprevistos % (sobre directo)
      + Estructura %  (sobre directo)
      + Jefatura %    (sobre directo)
      + Logística %   (sobre directo)
      + Herramientas % (sobre directo)
      = Subtotal 02

      + Beneficio % (sobre Subtotal 02!)   ← KEY: not over directo
      = Subtotal 03

      + Ingresos Brutos % (sobre Subtotal 03)
      + Imp. Cheque %     (sobre Subtotal 03)
      = Neto (pre-IVA)

      + IVA % (sobre Neto)
      = Total Final

    Config values are stored as WHOLE NUMBERS (15 = 15%), divided by 100 here.
    Default values apply when a field is missing or null in DB.
    """
    directo = float(item.get("directo_total") or 0)

    # Step 1: Indirect costs (all over directo)
    imprevistos = pct_or_default(config, "imprevistos_pct", 3)
    estructura = pct_or_default(config, "estructura_pct", 15)
    jefatura = pct_or_default(config, "jefatura_pct", 8)
    logistica = pct_or_default(config, "logistica_pct", 5)
    herramientas = pct_or_default(config, "herramientas_pct", 3)

    pct_indirecto = (imprevistos + estructura + jefatura + logistica + herramientas) / 100
    indirecto = round(directo * pct_indirecto, 2)
    subtotal_02 = directo + indirecto

    # Step 2: Beneficio over Subtotal 02 (NOT over directo)
    beneficio_pct = pct_or_default(config, "beneficio_pct", 10)
    beneficio = round(subtotal_02 * beneficio_pct / 100, 2)
    subtotal_03 = subtotal_02 + beneficio

    # Step 3: Taxes over Subtotal 03
    iibb = pct_or_default(config, "ingresos_brutos_pct", 7)
    cheque = pct_or_default(config, "imp_cheque_pct", 1.2)
    impuestos = round(subtotal_03 * (iibb + cheque) / 100, 2)
    neto = subtotal_03 + impuestos

    # Step 4: IVA over Neto
    iva_pct = pct_or_default(config, "iva_pct", 21)
    iva = round(neto * iva_pct / 100, 2)
    total_final = neto + iva

    item["indirecto_total"] = indirecto
    item["beneficio_total"] = beneficio
    item["impuestos_total"] = impuestos
    item["neto_total"] = round(neto, 2)
    item["iva_total"] = iva
    item["total_final"] = round(total_final, 2)

    return item


def cascade_factors(config: dict) -> dict:
    """What the screens show about a cascade config, so none of them adds it up on its own.

    indirecto_pct: the 5 indirect concepts (imprevistos, estructura, jefatura, logística,
    herramientas), with the defaults of calc_cascade_indirects.
    coeficiente: price without IVA per 1 of direct cost (indirects → beneficio → taxes).
    """
    indirecto_pct = sum(
        pct_or_default(config, key, default)
        for key, default in (
            ("imprevistos_pct", 3), ("estructura_pct", 15), ("jefatura_pct", 8),
            ("logistica_pct", 5), ("herramientas_pct", 3),
        )
    )
    beneficio = pct_or_default(config, "beneficio_pct", 10)
    impuestos = pct_or_default(config, "ingresos_brutos_pct", 7) + pct_or_default(config, "imp_cheque_pct", 1.2)
    coeficiente = (1 + indirecto_pct / 100) * (1 + beneficio / 100) * (1 + impuestos / 100)
    return {"indirecto_pct": round(indirecto_pct, 4), "coeficiente": round(coeficiente, 4)}
