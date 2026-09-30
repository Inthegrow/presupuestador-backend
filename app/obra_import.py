"""Fase 5: cargar el cómputo de una obra real (hoja 01_C&P) usando las recetas del Maestro.

Del Excel de la obra se toman solo la estructura (rubros, pisos, ítems) y las
cantidades. El precio de cada ítem con receta lo calcula el sistema con la
plantilla del Maestro; los ítems sin receta se cargan con el precio unitario
del Excel, para que el total se pueda comparar.

Funciones puras (sin base de datos). La carga la hace import_obra.py con un SQL.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime

from app.formulas import FormulaError
from app.recipes import expand_resource, merge_params, param_defaults
from app.tree import normalize_date_code, normalize_item_code

SHEET = "01_C&P"
FIRST_ROW = 8

# Columnas de 01_C&P (1 = A)
COL_ITEM, COL_DESC, COL_UNIDAD, COL_CANTIDAD = 1, 2, 3, 4
COL_MAT_UNIT = 5    # E: materiales por unidad
COL_MO_UNIT = 10    # J: M.O. por unidad (jornales + equipos + materiales + subcontratos)
COL_DIR_TOTAL = 14  # N: directo general
COL_NETO_TOTAL = 26  # Z: total neto

# ── Cruce ítem de la obra → receta del Maestro ───────────────────────────────
#
# Por descripción (sin acentos, en mayúsculas); gana la primera que coincide.
#   plantillas: [(código del Maestro, factor)]. factor = unidades de la receta
#               por unidad de la obra (ej. ml de tensor → m³: 0,20 × 0,40).
#               Más de una = ítem compuesto (se suman los recursos).
#   cliente:    códigos de recursos que no se cobran ("no incluye el porcelanato").
#   nota:       lo que hay que revisar con Emilia y Sol.
MAPEO: list[dict] = [
    {"patron": r"^BASES AISLADAS", "plantillas": [("4.1.3", 1.0)],
     "nota": "1 m³ por base: en la solapa 3.1-1 de la obra son 35 m³ para 35 bases, llenadas junto con los troncos."},
    {"patron": r"^TRONCOS", "plantillas": [("4.1.4", 0.32)],
     "nota": "0,80 × 0,40 × 1 m = 0,32 m³ por tronco. En la obra el hormigón de los troncos va con las bases: revisar que no se cuente dos veces."},
    {"patron": r"^TENSORES", "plantillas": [("4.1.7", 0.08)],
     "nota": "0,20 × 0,40 = 0,08 m³ por ml."},
    {"patron": r"TABIQUE DE HORMIGON ARMADO EN PLANTA BAJA", "plantillas": [("4.2.4", 2.816)],
     "nota": "17,6 m² × 0,16 m = 2,816 m³ por tramo."},
    {"patron": r"TABIQUE DE HORMIGON ARMADO EN NUCLEO", "plantillas": [("4.2.4", 6.72)],
     "nota": "42 m² × 0,16 m = 6,72 m³ por tramo."},
    {"patron": r"MURO DE CARGA.*LADRILLO HUECO DEL 18", "plantillas": [("5.1.4", 1.0)],
     "nota": "Muro de carga: ¿es hueco del 18 (5.1.4) o portante del 18 (5.1.1)?"},
    {"patron": r"LADRILLO HUECO DEL 18", "plantillas": [("5.1.4", 1.0)]},
    {"patron": r"LADRILLO HUECO DEL 12", "plantillas": [("5.1.5", 1.0)]},
    {"patron": r"LADRILLO HUECO DEL 8\b", "plantillas": [("5.1.6", 1.0)]},
    {"patron": r"^YESO PROYECTADO", "plantillas": [("5.5.5", 1.0)]},
    {"patron": r"^REVOQUE EXTERIOR CON HIDROFUGO CON SILLETA", "plantillas": [("5.5.3", 1.0)],
     "nota": "La silleta no está en la receta: el Excel de la obra cobra este ítem bastante más caro."},
    {"patron": r"^REVOQUE EXTERIOR CON HIDROFUGO", "plantillas": [("5.5.3", 1.0)]},
    {"patron": r"^REVOQUE (INTERIOR )?GRUESO FRATAZADO \+ HIDROFUGO", "plantillas": [("5.5.4", 1.0)],
     "nota": "La receta de grueso interior no lleva hidrófugo."},
    {"patron": r"^REVOQUE INTERIOR$", "plantillas": [("5.5.4", 1.0)],
     "nota": "¿Lleva también fino interior (5.5.2)?"},
    {"patron": r"^TELGOPOR 50 ?MM \+ CONTRAPISO.*E ?[:=] ?4 ?CM", "plantillas": [("8.3", 1.0), ("5.2.3", 0.04)],
     "nota": "Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 4 cm."},
    {"patron": r"^TELGOPOR 50 ?MM \+ CONTRAPISO", "plantillas": [("8.3", 1.0), ("5.2.3", 0.08)],
     "nota": "Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 8 cm."},
    {"patron": r"^CONTRAPISO/ ?CARPETA EN BALCONES", "plantillas": [("5.4.1", 1.0)],
     "nota": "En el Excel de la obra lleva el precio de la carpeta. ¿Va con hidrófugo (5.4.2)?"},
    {"patron": r"^CONTRAPISO", "plantillas": [("5.2.3", 0.10)],
     "nota": "Contrapiso de cascote de 10 cm: 0,10 m³ por m²."},
    {"patron": r"^CARPETA", "plantillas": [("5.4.1", 1.0)],
     "nota": "La receta no tiene espesor: es la misma para 3 y 4 cm."},
    {"patron": r"REVESTIMIENTOS EN PISOS", "plantillas": [("7.1.1", 1.0)], "cliente": ["RP-PORC"],
     "nota": "No incluye el porcelanato: queda como material que compra el cliente."},
    {"patron": r"REVESTIMIENTOS EN PAREDES", "plantillas": [("7.1.5", 1.0)], "cliente": ["RP-PORC"],
     "nota": "No incluye el porcelanato: queda como material que compra el cliente."},
    {"patron": r"^AZOTADO HIDROFUGO \+ PINTURA ASFALTICA", "plantillas": [("8.1", 1.0)]},
    {"patron": r"^PINTURA ASFALTICA \+ MEMBRANA ASFALTICA \+ GEOTEXTIL", "plantillas": [("8.2", 1.0), ("8.4", 1.0)],
     "nota": "Compuesto: pintura asfáltica (8.2) + membrana con geotextil (8.4)."},
    {"patron": r"CIELORRASOS DE YESO SUSPENDIDO", "plantillas": [("6.5", 1.0)],
     "nota": "Cielorraso suspendido de placa. En baños y cocinas, ¿placa verde (6.6)?"},
    {"patron": r"CIELORRASOS APLICADOS EN YESO", "plantillas": [("6.1", 1.0)]},
    {"patron": r"^BUNA PERIMETRAL", "plantillas": [("6.2", 1.0)]},
    {"patron": r"^CAJONES", "plantillas": [("6.3", 1.0)]},
    {"patron": r"PINTURA EN CIELORRASOS", "plantillas": [("7.4.1", 1.0)]},
    {"patron": r"PINTURA EN PAREDES", "plantillas": [("7.4.2", 1.0)]},
]

# Ítems sin receta: la receta del Maestro más parecida, si hay alguna
CANDIDATOS: list[tuple[str, str]] = [
    (r"^OBRADOR", "1.1 (sin solapa en el Maestro)"),
    (r"^BANOS QUIMICOS", "1.2 (sin solapa en el Maestro)"),
    (r"^INSTALACIONES PROVISORIAS", "1.3 (sin solapa en el Maestro)"),
    (r"^LIMPIEZA PERIODICA", "1.4 (sin solapa en el Maestro)"),
    (r"^AYUDA DE GREMIOS", "1.6 (sin solapa en el Maestro)"),
    (r"^LIMPIEZA FINAL", "1.7 (sin solapa en el Maestro)"),
    (r"^CERCO DE OBRA", "1.10 (sin solapa en el Maestro)"),
    (r"SEGURIDAD E HIGIEN", "1.12 (sin solapa en el Maestro)"),
    (r"EXCAVACI", "rubro 2 (sin solapa en el Maestro)"),
    (r"^ESTRUCTURA EN HORMIGON ARMADO", "4.2.1 losas / 4.2.2 columnas / 4.2.3 vigas, en m³: falta separar el m² en volúmenes"),
    (r"^VIGAS", "4.2.3 vigas, en m³: falta la sección de la viga"),
    (r"^ESCALERA", "4.2.6 escaleras (gl): no está claro si es por tramo o completa"),
    (r"^COLOCACION DE PUERTAS", "7.3.1 es solo el premarco, no la colocación"),
    (r"^ARISTAS", "no hay receta de aristas de yeso"),
    (r"TEXTURADO", "no hay receta de revestimiento texturado"),
    (r"MEMBRANA LIQUIDA", "no hay receta de membrana líquida"),
]


def plain(text: object) -> str:
    """Upper case, without accents and repeated spaces (for matching)."""
    s = unicodedata.normalize("NFKD", str(text or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.upper().split())


def match_recipe(descripcion: str) -> dict | None:
    key = plain(descripcion)
    for rule in MAPEO:
        if re.search(rule["patron"], key):
            return rule
    return None


def candidate(descripcion: str) -> str:
    key = plain(descripcion)
    for patron, texto in CANDIDATOS:
        if re.search(patron, key):
            return texto
    return "no hay receta parecida en el Maestro"


def altura_from(descripcion: str) -> float | None:
    """Wall height from the description: 'h 3m' → 3, 'h 4,4m' → 4.4 ('h 0.2m/1.8m' → None)."""
    m = re.search(r"\bH\s*(\d+(?:[.,]\d+)?)\s*M\b(?!\s*/)", plain(descripcion))
    return float(m.group(1).replace(",", ".")) if m else None


# ── Lectura del Excel de la obra ─────────────────────────────────────────────


def _num(value: object) -> float | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip().replace(",", "."))
    except ValueError:
        return None


def _code(value: object) -> str:
    """Item code: dates (1.1 guardado como 01/01/2026) and 4.2-1 → 4.2.1."""
    if isinstance(value, datetime):
        return normalize_date_code(value) or ""
    return normalize_item_code(value)


_SECTION_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[-.]?\s+(.*)$")


def parse_obra(wb, sheet: str = SHEET) -> dict:  # type: ignore[no-untyped-def]
    """Rubros, pisos (subrubros) e ítems de la hoja 01_C&P, en orden.

    Returns {"titulo", "filas": [...], "problemas": [...]}. Each fila:
    {"orden", "nivel" (rubro/subrubro/item), "codigo", "parent" (orden del padre),
     "descripcion", "unidad", "cantidad", "excel": {mat_unit, mo_unit, directo, neto},
     "fila" (Excel row), "notas": []}
    """
    ws = wb[sheet]
    filas: list[dict] = []
    problemas: list[str] = []
    rubro = subrubro = None

    for r in range(FIRST_ROW, ws.max_row + 1):
        raw_code = ws.cell(r, COL_ITEM).value
        desc = " ".join(str(ws.cell(r, COL_DESC).value or "").split())
        cantidad = _num(ws.cell(r, COL_CANTIDAD).value)
        if not desc:
            continue

        if cantidad is None and raw_code in (None, ""):
            m = _SECTION_RE.match(desc)
            if not m:
                problemas.append(f"Fila {r}: título sin código ('{desc}'), no se cargó.")
                continue
            code, name = m.group(1).rstrip("."), m.group(2).strip()
            nivel = "subrubro" if "." in code else "rubro"
            fila = {"orden": len(filas), "nivel": nivel, "codigo": code, "descripcion": name,
                    "unidad": None, "cantidad": None, "excel": None, "fila": r, "notas": []}
            if nivel == "rubro":
                fila["parent"] = None
                rubro, subrubro = fila, None
            else:
                fila["parent"] = rubro["orden"] if rubro else None
                subrubro = fila
            filas.append(fila)
            continue

        code = _code(raw_code)
        notas: list[str] = []
        parent = subrubro or rubro
        if parent and code and not code.startswith(parent["codigo"] + "."):
            fixed = parent["codigo"] + "." + code.split(".", 2)[-1] if code.count(".") >= 2 else code
            if fixed != code:
                notas.append(f"El Excel dice {raw_code} pero está en {parent['codigo']}: se cargó como {fixed}.")
                problemas.append(f"Fila {r}: código {raw_code} dentro de {parent['codigo']} → {fixed}.")
                code = fixed
        if cantidad is None:
            problemas.append(f"Fila {r}: '{desc[:50]}' sin cantidad, se cargó con 0.")
            cantidad = 0.0

        unidad = " ".join(str(ws.cell(r, COL_UNIDAD).value or "").split()) or None
        filas.append({
            "orden": len(filas), "nivel": "item", "codigo": code or None,
            "parent": parent["orden"] if parent else None,
            "descripcion": desc, "unidad": unidad, "cantidad": cantidad,
            "excel": {
                "mat_unit": _num(ws.cell(r, COL_MAT_UNIT).value) or 0.0,
                "mo_unit": _num(ws.cell(r, COL_MO_UNIT).value) or 0.0,
                "directo": _num(ws.cell(r, COL_DIR_TOTAL).value) or 0.0,
                "neto": _num(ws.cell(r, COL_NETO_TOTAL).value) or 0.0,
            },
            "fila": r, "notas": notas,
        })

    _fill_units(filas, problemas)
    return {"titulo": str(ws.cell(1, 1).value or "").strip(), "filas": filas, "problemas": problemas}


def _fill_units(filas: list[dict], problemas: list[str]) -> None:
    """Items without unit take the unit of the same item on another floor."""
    units: dict[str, set[str]] = {}
    for f in filas:
        if f["nivel"] == "item" and f["unidad"]:
            units.setdefault(plain(f["descripcion"]), set()).add(f["unidad"])
    for f in filas:
        if f["nivel"] != "item":
            continue
        known = units.get(plain(f["descripcion"]), set())
        if not f["unidad"] and len(known) == 1:
            f["unidad"] = next(iter(known))
            f["notas"].append(f"Sin unidad en el Excel: se tomó {f['unidad']} de los otros pisos.")
            problemas.append(f"Fila {f['fila']}: sin unidad, se tomó {f['unidad']}.")
        elif len(known) > 1:
            msg = f"La misma tarea figura con unidades distintas en los pisos: {', '.join(sorted(known))}."
            if msg not in f["notas"]:
                f["notas"].append(msg)


# ── Plan de carga ────────────────────────────────────────────────────────────


def _scale(expr: object, factor: float) -> object:
    """Q → (Q*factor) in a formula, so the item keeps the obra unit and can be recalculated."""
    if factor == 1 or expr in (None, ""):
        return expr
    return re.sub(r"\bQ\b", f"(Q*{factor:g})", str(expr))


def _scale_rendimiento(rend: object, factor: float) -> object:
    """dias = Q*factor/rend = Q/(rend/factor)."""
    if factor == 1 or rend in (None, ""):
        return rend
    return f"({rend})/{factor:g}"


def expand_item(fila: dict, rule: dict, templates: dict[str, dict]) -> tuple[list[dict], dict, list[str]]:
    """Resources of one item from its recipe(s), without price.

    The waste of resources without their own % is resolved later in SQL
    (plantilla > organización), like the system does when applying a template.
    """
    qty = float(fila["cantidad"] or 0)
    rows: list[dict] = []
    params: dict[str, float] = {}
    notas: list[str] = []
    cliente = set(rule.get("cliente") or [])

    for codigo, factor in rule["plantillas"]:
        tmpl = templates[codigo]
        tparams = param_defaults(tmpl.get("parametros"))
        altura = altura_from(fila["descripcion"])
        if "altura_m" in tparams and altura:
            tparams = merge_params(tparams, {"altura_m": altura})
        params.update(tparams)
        for res in tmpl.get("recursos") or []:
            scaled = dict(res)
            scaled["formula"] = _scale(res.get("formula"), factor)
            scaled["rendimiento"] = _scale_rendimiento(res.get("rendimiento"), factor)
            if res.get("codigo") in cliente:
                scaled["lo_compra_cliente"] = True
            try:
                row = expand_resource(scaled, qty, params)
            except FormulaError as exc:
                raise FormulaError(f"{fila['codigo']} ({codigo}): {exc}") from exc
            # Own waste only if the recipe has it; if not, it is inherited in SQL
            row["desperdicio_pct"] = None if row["tipo"] == "mano_obra" else res.get("desperdicio_pct")
            row["plantilla"] = codigo
            rows.append(row)
            if res.get("revisar"):
                notas.append(f"{codigo} {res.get('codigo')}: {res.get('nota') or 'revisar'}")
    return rows, params, notas


def build_plan(parsed: dict, templates: dict[str, dict]) -> dict:
    """Items to load, each with its recipe resources or with the Excel price."""
    items: list[dict] = []
    sin_receta: list[dict] = []
    faltan: set[str] = set()

    for fila in parsed["filas"]:
        item = dict(fila, plantilla=None, parametros={}, recursos=[], revisar=[])
        if fila["nivel"] == "item":
            rule = match_recipe(fila["descripcion"])
            missing = [c for c, _ in (rule or {}).get("plantillas", []) if c not in templates]
            faltan.update(missing)
            if rule and not missing:
                rows, params, revisar = expand_item(fila, rule, templates)
                item.update(plantilla=rule["plantillas"][0][0], parametros=params, recursos=rows,
                            plantillas=[c for c, _ in rule["plantillas"]], revisar=revisar,
                            nota_cruce=rule.get("nota"))
            else:
                item["candidato"] = candidate(fila["descripcion"])
                sin_receta.append(item)
        items.append(item)

    return {"items": items, "sin_receta": sin_receta, "plantillas_faltantes": sorted(faltan)}


def item_notes(item: dict) -> str:
    """Text for budget_items.notas: where the price comes from and what to review."""
    ex = item.get("excel") or {}
    parts: list[str] = []
    if item["nivel"] != "item":
        return "Seccion"
    if item.get("plantilla"):
        parts.append("Receta del Maestro: " + " + ".join(item["plantillas"]) + ".")
        parts.append(f"Excel de la obra: {_money(ex.get('mat_unit', 0) + ex.get('mo_unit', 0))} directo por unidad.")
        if item.get("nota_cruce"):
            parts.append(item["nota_cruce"])
    else:
        parts.append(f"Sin receta en el Maestro ({item.get('candidato')}): precio del Excel de la obra.")
    parts += item.get("notas") or []
    return " ".join(parts)


# ── Informe ──────────────────────────────────────────────────────────────────


def _money(value: float) -> str:
    return f"${value:,.0f}".replace(",", ".")


def report_markdown(parsed: dict, plan: dict, source_file: str) -> str:
    filas = parsed["filas"]
    rubros = [f for f in filas if f["nivel"] == "rubro"]
    items = [i for i in plan["items"] if i["nivel"] == "item"]
    con = [i for i in items if i.get("plantilla")]
    sin = plan["sin_receta"]
    by_order = {f["orden"]: f for f in filas}

    def rubro_of(f: dict) -> dict | None:
        while f and f["nivel"] != "rubro":
            f = by_order.get(f["parent"]) if f["parent"] is not None else None
        return f

    total = sum(i["excel"]["neto"] for i in items)
    total_sin = sum(i["excel"]["neto"] for i in sin)
    out = [
        "# Fase 5: cómputo de la obra contra el Maestro",
        "",
        f"Archivo: `{source_file}` (hoja `{SHEET}`). Título de la hoja: \"{parsed['titulo']}\".",
        "",
        "## Resumen",
        "",
        f"- **{len(rubros)} rubros**, **{sum(1 for f in filas if f['nivel'] == 'subrubro')} subrubros** "
        f"(pisos o partes de la estructura) y **{len(items)} ítems**.",
        f"- Total neto del Excel: **{_money(total)}**.",
        f"- **{len(con)} ítems con receta** del Maestro: el sistema calcula el precio con las cantidades.",
        f"- **{len(sin)} ítems sin receta**: se cargan con el precio del Excel "
        f"({_money(total_sin)}, {100 * total_sin / total if total else 0:.0f}% del total).",
        "",
        "| Rubro | Ítems | Con receta | Total neto Excel |",
        "|---|---:|---:|---:|",
    ]
    for rb in rubros:
        its = [i for i in items if rubro_of(i) is rb]
        out.append(f"| {rb['codigo']} {rb['descripcion']} | {len(its)} | "
                   f"{sum(1 for i in its if i.get('plantilla'))} | {_money(sum(i['excel']['neto'] for i in its))} |")

    ceros = [i for i in con if not i["excel"]["neto"]]
    if ceros:
        out += ["", f"Ojo: {len(ceros)} ítems con receta están en $0 en el Excel "
                f"({', '.join(i['codigo'] for i in ceros)}): ahí la comparación no sirve."]

    if plan["plantillas_faltantes"]:
        out += ["", "**Faltan en el Maestro las plantillas:** " + ", ".join(plan["plantillas_faltantes"])]

    out += ["", "## Ítems sin receta en el Maestro", "",
            "Agrupados por tarea (la misma tarea se repite en varios pisos).", "",
            "| Tarea | Veces | Total neto Excel | Receta más parecida |", "|---|---:|---:|---|"]
    groups: dict[str, list[dict]] = {}
    for i in sin:
        groups.setdefault(plain(i["descripcion"]), []).append(i)
    for its in sorted(groups.values(), key=lambda g: -sum(i["excel"]["neto"] for i in g)):
        first = its[0]
        codes = ", ".join(i["codigo"] or "?" for i in its[:4]) + ("…" if len(its) > 4 else "")
        out.append(f"| {first['descripcion'][:80]} ({codes}) | {len(its)} | "
                   f"{_money(sum(i['excel']['neto'] for i in its))} | {first['candidato']} |")

    out += ["", "## Ítems con receta", "",
            "| Tarea | Veces | Receta | Qué revisar |", "|---|---:|---|---|"]
    groups = {}
    for i in con:
        groups.setdefault(plain(i["descripcion"]) + "|" + "+".join(i["plantillas"]), []).append(i)
    for its in groups.values():
        first = its[0]
        out.append(f"| {first['descripcion'][:70]} | {len(its)} | {' + '.join(first['plantillas'])} | "
                   f"{first.get('nota_cruce') or ''} |")

    if parsed["problemas"]:
        out += ["", "## Datos del Excel que se corrigieron al cargar", ""]
        out += [f"- {p}" for p in parsed["problemas"]]
    out.append("")
    return "\n".join(out)
