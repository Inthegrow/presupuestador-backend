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

from datetime import date, datetime

from app.budget_prices import find_entry, pick_price
from app.catalog_prices import normalize_codigo
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
    {"patron": r"^BASES AISLADAS", "plantillas": [("4.1.3", 1.0)], "obra": "u",
     "nota": "1 m³ por base: en la solapa 3.1-1 de la obra son 35 m³ para 35 bases, llenadas junto con los troncos."},
    {"patron": r"^TRONCOS", "plantillas": [("4.1.4", 0.32)], "obra": "u",
     "nota": "0,80 × 0,40 × 1 m = 0,32 m³ por tronco. En la obra el hormigón de los troncos va con las bases: revisar que no se cuente dos veces."},
    {"patron": r"^TENSORES", "plantillas": [("4.1.7", 0.08)], "obra": "m",
     "nota": "0,20 × 0,40 = 0,08 m³ por ml."},
    {"patron": r"TABIQUE DE HORMIGON ARMADO EN PLANTA BAJA", "plantillas": [("4.2.4", 2.816)], "obra": "tramo",
     "nota": "17,6 m² × 0,16 m = 2,816 m³ por tramo."},
    {"patron": r"TABIQUE DE HORMIGON ARMADO EN NUCLEO", "plantillas": [("4.2.4", 6.72)], "obra": "tramo",
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
    {"patron": r"^TELGOPOR 50 ?MM \+ CONTRAPISO.*E ?[:=] ?4 ?CM", "plantillas": [("8.3", 1.0), ("5.2.3", 0.04)], "obra": "m2",
     "nota": "Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 4 cm."},
    {"patron": r"^TELGOPOR 50 ?MM \+ CONTRAPISO", "plantillas": [("8.3", 1.0), ("5.2.3", 0.08)], "obra": "m2",
     "nota": "Compuesto: placas EPS (8.3) + contrapiso de cascote (5.2.3) de 8 cm."},
    {"patron": r"^CONTRAPISO/ ?CARPETA EN BALCONES", "plantillas": [("5.4.1", 1.0)],
     "nota": "En el Excel de la obra lleva el precio de la carpeta. ¿Va con hidrófugo (5.4.2)?"},
    {"patron": r"^CONTRAPISO", "plantillas": [("5.2.3", 0.10)], "obra": "m2",
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


_UNITS = {
    "M2": "m2", "M²": "m2", "M3": "m3", "M³": "m3", "M": "m", "ML": "m", "MTS": "m",
    "U": "u", "UN": "u", "UNID": "u", "UNIDAD": "u", "UNIDADES": "u", "GL": "gl", "GLOBAL": "gl",
}


def unit_key(unidad: object) -> str:
    """Comparable unit: 'm²' = 'M2' = 'm2', 'ml' = 'm', 'unid' = 'u'."""
    u = plain(unidad).replace(".", "").replace(" ", "")
    return _UNITS.get(u, u.lower())


def task_key(descripcion: str, unidad: object) -> str:
    """One task = same description AND same unit (the same text in m and m3 are two tasks)."""
    return f"{plain(descripcion)} | {unit_key(unidad)}"


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


# ── Sugerencias (sin receta en MAPEO): parecido de palabras ─────────────────

_STOPWORDS = {
    "CON", "DEL", "LAS", "LOS", "POR", "SIN", "PARA", "SOBRE", "ENTRE", "HASTA", "INCLUYE",
    "ESP", "TIPO", "CADA", "TODO", "TODA", "OBRA", "EJECUCION", "COLOCACION",
}
_BOILERPLATE = "Importado del Maestro"  # description written by the Maestro import


def _tokens(text: object) -> dict[str, str]:
    """Comparable words → the word as written: no accents, no short stopwords, no plural."""
    out: dict[str, str] = {}
    for tok in re.findall(r"[A-Z]+|\d+", plain(text)):
        if tok.isdigit():
            out.setdefault(tok, tok)
            continue
        if len(tok) <= 2 or tok in _STOPWORDS:
            continue
        key = re.sub(r"(.)\1", r"\1", tok)  # CIELORRASO = CIELORASO
        if len(key) > 4 and key.endswith("S"):
            key = key[:-1]
        out.setdefault(key, tok.lower())
    return out


def suggest_recipes(descripcion: str, templates: dict[str, dict], top: int = 3) -> list[tuple[str, float, str]]:
    """Recipes whose name looks like the description: [(codigo, score, porque)], best first.

    score = shared words / words of the recipe, plus a bonus for equal numbers ("18", "12").
    A number alone is not enough, and one shared word scores at most 0.5 (too generic
    to propose the recipe by itself: "ESMALTE EN ESCALERA" is not the concrete stair).
    """
    desc = _tokens(descripcion)
    found = []
    for codigo, tmpl in templates.items():
        text = str(tmpl.get("nombre") or "")
        extra = str(tmpl.get("descripcion") or "")
        if extra and not extra.startswith(_BOILERPLATE):
            text += " " + extra
        words = _tokens(text)
        if not words:
            continue
        common = [k for k in words if k in desc]
        nums = [k for k in common if k.isdigit()]
        palabras = [k for k in common if not k.isdigit()]
        if not palabras:
            continue
        score = min(1.0, len(common) / len(words) + 0.2 * len(nums))
        if len(palabras) == 1:
            score = min(score, 0.5)
        porque = "Se parece por " + ", ".join(f"'{desc[k]}'" for k in (palabras + nums)[:4])
        found.append((codigo, round(score, 3), porque))
    found.sort(key=lambda s: (-s[1], s[0]))
    return found[:top]


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


def rule_for(fila: dict, templates: dict[str, dict], asignaciones: dict | None = None) -> dict | None:
    """Recipe rule of an item: the one chosen by hand (asignaciones) or the automatic one.

    asignaciones = {task_key(descripcion, unidad): {"plantillas": [[codigo, factor], ...]}};
    an empty list means "sin receta" (use the Excel price). A factor may be null: it is 1
    when the recipe and the item have the same unit, otherwise it is missing.

    When the units differ, the conversion must be explicit: a hand-chosen factor, or the
    one of an automatic rule written for that item unit ("obra"). If it is missing, the
    rule comes back with "falta_factor" (the item cannot be loaded until it is given).
    """
    auto = match_recipe(fila["descripcion"])
    elegida = (asignaciones or {}).get(task_key(fila["descripcion"], fila.get("unidad")))
    obra = unit_key(fila.get("unidad"))

    if elegida is None:
        if auto is None:
            return None
        rule = dict(auto)
        pares = [(c, f, True) for c, f in auto["plantillas"]]
    else:
        pares = []
        for par in elegida.get("plantillas") or []:
            codigo, factor = str(par[0]), par[1] if len(par) > 1 else None
            try:
                factor = float(factor) if factor not in (None, "") else None
            except (TypeError, ValueError):
                factor = None
            pares.append((codigo, factor if factor and factor > 0 else None, False))
        if not pares:
            return None
        same = auto and [c for c, _ in auto["plantillas"]] == [c for c, _, _ in pares]
        rule = dict(auto) if same else {"patron": None, "nota": "Receta elegida a mano al cargar la obra."}

    plantillas, falta = [], []
    for codigo, factor, automatica in pares:
        receta = unit_key((templates.get(codigo) or {}).get("unidad"))
        if automatica:
            # A rule with "obra" was written for that item unit (its factors convert from it);
            # without it, the rule assumes the item already comes in the recipe's unit
            esperada = unit_key(auto.get("obra")) if auto.get("obra") else receta
            if esperada and obra and esperada != obra:
                factor = None
        elif factor is None and (not receta or not obra or receta == obra):
            factor = 1.0
        if factor is None:
            falta.append(codigo)
        plantillas.append((codigo, factor))
    rule["plantillas"] = plantillas
    rule["falta_factor"] = falta
    return rule


def build_plan(parsed: dict, templates: dict[str, dict], asignaciones: dict | None = None) -> dict:
    """Items to load, each with its recipe resources or with the Excel price."""
    items: list[dict] = []
    sin_receta: list[dict] = []
    sin_factor: list[dict] = []
    faltan: set[str] = set()

    for fila in parsed["filas"]:
        item = dict(fila, plantilla=None, parametros={}, recursos=[], revisar=[])
        if fila["nivel"] == "item":
            rule = rule_for(fila, templates, asignaciones)
            missing = [c for c, _ in (rule or {}).get("plantillas", []) if c not in templates]
            faltan.update(missing)
            if rule and not missing and rule["falta_factor"]:
                # Units differ and nobody said how to convert: not loadable yet
                item.update(falta_factor=rule["falta_factor"], plantillas=[c for c, _ in rule["plantillas"]],
                            factores=[f for _, f in rule["plantillas"]], nota_cruce=rule.get("nota"))
                sin_factor.append(item)
            elif rule and not missing:
                rows, params, revisar = expand_item(fila, rule, templates)
                item.update(plantilla=rule["plantillas"][0][0], parametros=params, recursos=rows,
                            plantillas=[c for c, _ in rule["plantillas"]],
                            factores=[f for _, f in rule["plantillas"]], revisar=revisar,
                            nota_cruce=rule.get("nota"))
            else:
                item["candidato"] = candidate(fila["descripcion"])
                if missing:
                    item.update(faltan_plantillas=missing, nota_cruce=rule.get("nota"))
                sin_receta.append(item)
        items.append(item)

    return {"items": items, "sin_receta": sin_receta, "sin_factor": sin_factor,
            "plantillas_faltantes": sorted(faltan)}


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


def price_problems(plan: dict, entries: list[dict], fecha: date) -> list[dict]:
    """Resources without a valid price at ``fecha`` in the Maestro catalogs.

    Same rule as the SQL and as Fase 4 (find_entry + pick_price). Only the
    current price of each entry is known here (no history): the SQL, which
    reads the real catalog and its history, has the last word.
    Returns [{codigo, motivo, recursos, items: [codigos]}], sorted by code.
    """
    by_id = {str(i): {**e, "id": str(i)} for i, e in enumerate(entries)}
    by_codigo: dict[str, list[dict]] = {}
    for e in by_id.values():
        if normalize_codigo(e.get("codigo")):
            by_codigo.setdefault(normalize_codigo(e.get("codigo")), []).append(e)

    found: dict[str, dict] = {}
    for item in plan["items"]:
        for r in item.get("recursos") or []:
            if r.get("lo_compra_cliente"):
                continue
            entry, problem = find_entry({"codigo": r["codigo"], "tipo": r["tipo"]}, by_id, by_codigo)
            if entry is not None:
                price = pick_price(entry, [], fecha)
                if price is None or price[0] <= 0:
                    problem = "sin precio"
            elif problem is None:
                problem = "sin código"
            if problem is None:
                continue
            if problem == "sin_precio":
                problem = "no está en el catálogo"
            elif problem == "duplicado":
                problem = "código duplicado en el catálogo"
            key = normalize_codigo(r["codigo"]) or "(sin código)"
            row = found.setdefault(key, {"codigo": r["codigo"], "motivo": problem, "recursos": 0, "items": []})
            row["recursos"] += 1
            if item["codigo"] not in row["items"]:
                row["items"].append(item["codigo"])
    return [found[k] for k in sorted(found)]


# ── Informe ──────────────────────────────────────────────────────────────────


def _money(value: float) -> str:
    return f"${value:,.0f}".replace(",", ".")


def report_markdown(parsed: dict, plan: dict, source_file: str, precios: list[dict] | None = None) -> str:
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

    if precios:
        n_items = len({c for p in precios for c in p["items"]})
        out += ["", "## Recursos sin precio válido (la carga se frena)", "",
                f"Según los catálogos del Maestro: **{len(precios)} códigos**, en **{n_items} ítems** con receta. "
                "El SQL se frena y lista estos códigos. Si se fuerza (`v_permitir_sin_precio := true`), "
                "esos recursos quedan en $0 y esos ítems salen **más baratos que en la realidad**.", "",
                "| Código | Motivo | Recursos | Ítems |", "|---|---|---:|---|"]
        for p in precios:
            its = ", ".join(p["items"][:6]) + ("…" if len(p["items"]) > 6 else "")
            out.append(f"| `{p['codigo']}` | {p['motivo']} | {p['recursos']} | {its} ({len(p['items'])}) |")

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
