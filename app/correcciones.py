"""Correcciones de una revisión (Ginkgo): leer el archivo, validarlo y planificar cada una.

Funciones puras (sin base de datos). El router (app/routers/correcciones.py) lee la base de
la empresa, usa ``planificar`` para saber qué cambiaría y escribe.

Archivo (``app/data/correcciones_ginkgo.json``)::

    {"lote": "ginkgo-2026-10", "titulo": "Revisión de Ginkgo", "fecha": "2026-10-07",
     "correcciones": [{"id": "A1", "titulo": "…", "por_que": "…",
       "supuesto": {"respuesta": "Sí", "por": "Claude", "fecha": "2026-10-07", "confirma": "Emilia",
                    "razon": "…"},
       "fuentes": ["…"], "efecto_ginkgo": -19732275,
       "cambios": [
         {"tipo": "renglon", "plantilla": "8.4", "codigo": "C-MEM",
          "antes": {"formula": "Q"}, "despues": {"formula": "Q/10"}},
         {"tipo": "renglon_nuevo", "plantilla": "5.1.4", "renglon": {…recurso completo…}},
         {"tipo": "renglon_quitar", "plantilla": "4.2.4", "codigo": "HADN6", "antes": {…}},
         {"tipo": "plantilla_nueva", "plantilla": {"codigo": "5.5.6", "nombre": "…", "unidad": "m2",
          "categoria": "…", "parametros": [], "desperdicio_pct": null, "recursos": […]}},
         {"tipo": "precio", "codigo": "SUB-YES-CAJON", "tipo_recurso": "subcontrato", "descripcion": "…",
          "unidad": "m", "antes": null,
          "despues": {"precio_sin_iva": 25000, "proveedor": "EVER", "fecha_precio": "2026-09-18"},
          "fuente": "Excel de Sol, Ginkgo, hoja 00_Sub", "url": null}]}]}

Un renglón se busca por su código dentro de la fórmula (``codigo``) y tiene que tener los
valores de ``antes``; si no, la corrección "no coincide" (alguien la cambió a mano) y no se
aplica. Si ya tiene los valores de ``despues``, ese cambio "ya está".
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from pathlib import Path

from app.catalog_prices import normalize_codigo, parse_fecha
from app.recipes import validate_template

logger = logging.getLogger(__name__)

RUTA = Path(__file__).resolve().parent / "data" / "correcciones_ginkgo.json"

TIPOS_CAMBIO = ("renglon", "renglon_nuevo", "renglon_quitar", "plantilla_nueva", "precio")
TIPOS_PRECIO = ("material", "mano_obra", "equipo", "subcontrato")
CAMPOS_SUPUESTO = ("respuesta", "por", "fecha", "confirma", "razon")

# estado_cambio
PARA_APLICAR = "para_aplicar"
YA_ESTA = "ya_esta"          # la base ya tiene el valor nuevo
NO_COINCIDE = "no_coincide"  # la base tiene otra cosa: no se aplica
SE_SALTEA = "se_saltea"      # precio: la lista tiene uno más nuevo
APLICADO = "aplicado"
SALTEADO = "salteado"


class LoteInvalido(ValueError):
    def __init__(self, errores: list[str]):
        super().__init__("; ".join(errores))
        self.errores = errores


# ── Lectura y validación ─────────────────────────────────────────────────────


def cargar(ruta: Path | str | None = None) -> dict:
    """The corrections file, validated. Raises LoteInvalido with every problem found."""
    path = Path(ruta or RUTA)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LoteInvalido([f"No está el archivo {path.name}"]) from exc
    except ValueError as exc:
        raise LoteInvalido([f"El archivo {path.name} no es un JSON válido: {exc}"]) from exc
    errores = validar(data)
    if errores:
        raise LoteInvalido(errores)
    return data


def _texto(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _fecha_ok(value: object) -> bool:
    if not isinstance(value, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _numero(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _recurso_errores(recurso: object, donde: str) -> list[str]:
    if not isinstance(recurso, dict):
        return [f"{donde}: el renglón tiene que ser un objeto"]
    errores = []
    if not _texto(recurso.get("codigo")):
        errores.append(f"{donde}: al renglón le falta «codigo»")
    if recurso.get("tipo") not in TIPOS_PRECIO + ("mo_material",):
        errores.append(f"{donde}: «tipo» del renglón no válido ({recurso.get('tipo')!r})")
    return errores


def _cambio_errores(cambio: object, donde: str) -> list[str]:
    if not isinstance(cambio, dict):
        return [f"{donde}: tiene que ser un objeto"]
    tipo = cambio.get("tipo")
    if tipo not in TIPOS_CAMBIO:
        return [f"{donde}: «tipo» no válido ({tipo!r}); tiene que ser uno de {', '.join(TIPOS_CAMBIO)}"]
    donde = f"{donde} ({tipo})"
    errores: list[str] = []
    if tipo in ("renglon", "renglon_nuevo", "renglon_quitar") and not _texto(cambio.get("plantilla")):
        errores.append(f"{donde}: falta «plantilla» (el número de la fórmula, ej. \"8.4\")")
    if tipo in ("renglon", "renglon_quitar", "precio") and not _texto(cambio.get("codigo")):
        errores.append(f"{donde}: falta «codigo»")
    if tipo in ("renglon", "renglon_quitar"):
        antes = cambio.get("antes")
        if not isinstance(antes, dict) or not antes:
            errores.append(f"{donde}: falta «antes» (lo que tiene hoy el renglón)")
    if tipo == "renglon":
        despues = cambio.get("despues")
        if not isinstance(despues, dict) or not despues:
            errores.append(f"{donde}: falta «despues» (lo que cambia del renglón)")
        elif "codigo" in despues and not _texto(despues["codigo"]):
            errores.append(f"{donde}: «despues.codigo» vacío")
    if tipo == "renglon_nuevo":
        errores += _recurso_errores(cambio.get("renglon"), donde)
    if tipo == "renglon_quitar":
        antes = cambio.get("antes")
        if isinstance(antes, dict) and antes.get("codigo") not in (None, cambio.get("codigo")):
            errores.append(f"{donde}: «antes.codigo» no es el mismo que «codigo»")
    if tipo == "plantilla_nueva":
        plantilla = cambio.get("plantilla")
        if not isinstance(plantilla, dict):
            return errores + [f"{donde}: «plantilla» tiene que ser la fórmula entera"]
        for campo in ("codigo", "nombre", "unidad"):
            if not _texto(plantilla.get(campo)):
                errores.append(f"{donde}: a la fórmula le falta «{campo}»")
        recursos = plantilla.get("recursos")
        parametros = plantilla.get("parametros") or []
        if not isinstance(recursos, list) or not recursos:
            errores.append(f"{donde}: la fórmula no tiene «recursos»")
        elif not isinstance(parametros, list):
            errores.append(f"{donde}: «parametros» tiene que ser una lista")
        else:
            for i, r in enumerate(recursos, start=1):
                errores += _recurso_errores(r, f"{donde}, renglón {i}")
            if not errores:
                errores += [f"{donde}: {e}" for e in validate_template(recursos, parametros)]
        pct = plantilla.get("desperdicio_pct")
        if pct is not None and not _numero(pct):
            errores.append(f"{donde}: «desperdicio_pct» tiene que ser un número o null")
    if tipo == "precio":
        if cambio.get("tipo_recurso") not in TIPOS_PRECIO:
            errores.append(f"{donde}: «tipo_recurso» tiene que ser uno de {', '.join(TIPOS_PRECIO)}")
        for campo in ("descripcion", "unidad", "fuente"):
            if not _texto(cambio.get(campo)):
                errores.append(f"{donde}: falta «{campo}»")
        if cambio.get("antes") is not None and not isinstance(cambio.get("antes"), dict):
            errores.append(f"{donde}: «antes» tiene que ser null o un objeto")
        despues = cambio.get("despues")
        if not isinstance(despues, dict):
            errores.append(f"{donde}: falta «despues» (precio_sin_iva, proveedor, fecha_precio)")
        else:
            if not _numero(despues.get("precio_sin_iva")) or despues["precio_sin_iva"] <= 0:
                errores.append(f"{donde}: «despues.precio_sin_iva» tiene que ser un número mayor que 0")
            if not _fecha_ok(despues.get("fecha_precio")):
                errores.append(f"{donde}: «despues.fecha_precio» tiene que ser una fecha AAAA-MM-DD")
            if despues.get("proveedor") is not None and not isinstance(despues.get("proveedor"), str):
                errores.append(f"{donde}: «despues.proveedor» tiene que ser un texto o null")
        url = cambio.get("url")
        if url is not None and not (isinstance(url, str) and re.match(r"^https?://\S+$", url)):
            errores.append(f"{donde}: «url» tiene que ser null o un link http(s)://")
    return errores


def validar(data: object) -> list[str]:
    """Every problem of a corrections file, in words (empty = OK)."""
    if not isinstance(data, dict):
        return ["El archivo tiene que ser un objeto con «lote», «titulo», «fecha» y «correcciones»"]
    errores: list[str] = []
    for campo in ("lote", "titulo"):
        if not _texto(data.get(campo)):
            errores.append(f"Falta «{campo}»")
    if not _fecha_ok(data.get("fecha")):
        errores.append("«fecha» tiene que ser una fecha AAAA-MM-DD")
    correcciones = data.get("correcciones")
    if not isinstance(correcciones, list):
        return errores + ["«correcciones» tiene que ser una lista"]
    vistos: set[str] = set()
    for n, c in enumerate(correcciones, start=1):
        if not isinstance(c, dict):
            errores.append(f"Corrección {n}: tiene que ser un objeto")
            continue
        cid = c.get("id")
        donde = f"Corrección {cid}" if _texto(cid) else f"Corrección {n}"
        if not _texto(cid):
            errores.append(f"{donde}: falta «id»")
        elif cid in vistos:
            errores.append(f"{donde}: «id» repetido")
        else:
            vistos.add(cid)
        for campo in ("titulo", "por_que"):
            if not _texto(c.get(campo)):
                errores.append(f"{donde}: falta «{campo}»")
        supuesto = c.get("supuesto")
        if not isinstance(supuesto, dict):
            errores.append(f"{donde}: falta «supuesto» (respuesta, por, fecha, confirma, razon)")
        else:
            for campo in CAMPOS_SUPUESTO:
                if not _texto(supuesto.get(campo)):
                    errores.append(f"{donde}: al supuesto le falta «{campo}»")
            if _texto(supuesto.get("fecha")) and not _fecha_ok(supuesto["fecha"]):
                errores.append(f"{donde}: «supuesto.fecha» tiene que ser una fecha AAAA-MM-DD")
        fuentes = c.get("fuentes")
        if not isinstance(fuentes, list) or not fuentes or not all(_texto(f) for f in fuentes):
            errores.append(f"{donde}: «fuentes» tiene que ser una lista de textos (al menos uno)")
        efecto = c.get("efecto_ginkgo")
        if efecto is not None and not _numero(efecto):
            errores.append(f"{donde}: «efecto_ginkgo» tiene que ser un número o null")
        cambios = c.get("cambios")
        if not isinstance(cambios, list) or not cambios:
            errores.append(f"{donde}: «cambios» tiene que ser una lista con al menos un cambio")
            continue
        for i, cambio in enumerate(cambios, start=1):
            errores += _cambio_errores(cambio, f"{donde}, cambio {i}")
    return errores


# ── Textos ───────────────────────────────────────────────────────────────────


def fecha_corta(value: object) -> str:
    """'2026-10-07' → '7/10/2026' (as it came when it is not a date)."""
    try:
        d = parse_fecha(value)
    except ValueError:
        return str(value or "")
    return f"{d.day}/{d.month}/{d.year}" if d else ""


def nota_correccion(lote: dict, correccion: dict) -> dict:
    """The note each touched renglón keeps ("Corregido por la revisión de Ginkgo (A1), …")."""
    titulo = str(lote.get("titulo") or "revisión").strip()
    texto = f"Corregido por la {titulo[:1].lower()}{titulo[1:]} ({correccion['id']})"
    supuesto = correccion.get("supuesto") or {}
    if supuesto.get("por"):
        texto += f", supuesto por {supuesto['por']} el {fecha_corta(supuesto.get('fecha'))}"
    if supuesto.get("confirma"):
        texto += f", a confirmar por {supuesto['confirma']}"
    return {"lote": lote.get("lote"), "id": correccion["id"], "texto": texto}


def _humano(nombre: object) -> str:
    """'MEMBRANA ASFALTICA' → 'Membrana asfaltica' (the Maestro names are mostly in capitals)."""
    text = str(nombre or "").strip()
    if sum(c.isupper() for c in text) > sum(c.islower() for c in text):
        return text[:1].upper() + text[1:].lower()
    return text


def _valor(value: object) -> str:
    return "vacío" if value in (None, "") else f"«{value}»"


_NOMBRES_CAMPO = {"formula": "la fórmula", "codigo": "el código", "descripcion": "la descripción",
                  "desperdicio_pct": "el desperdicio", "rendimiento": "el rendimiento",
                  "trabajadores": "los trabajadores", "unidad": "la unidad"}


def _campo(key: str) -> str:
    return _NOMBRES_CAMPO.get(key, f"«{key}»")


# ── Comparación de valores ───────────────────────────────────────────────────


def mismo(a: object, b: object) -> bool:
    """Same value for a correction: numbers by value ("10" = 10.0), texts without spaces, None = ""."""
    if a in (None, "") and b in (None, ""):
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b) and a not in (None, "") and b not in (None, "")
    try:
        fa = float(str(a).replace(",", ".")) if isinstance(a, str) else float(a)  # type: ignore[arg-type]
        fb = float(str(b).replace(",", ".")) if isinstance(b, str) else float(b)  # type: ignore[arg-type]
        return abs(fa - fb) < 1e-9
    except (TypeError, ValueError):
        pass
    if isinstance(a, (dict, list)) or isinstance(b, (dict, list)):
        return a == b
    return "".join(str(a).split()) == "".join(str(b).split())


def _coinciden(row: dict, esperado: dict) -> list[str]:
    """Keys of ``esperado`` whose value in ``row`` is different."""
    return [k for k, v in esperado.items() if not mismo(row.get(k), v)]


def iguales(a: object, b: object) -> bool:
    """Same JSON (for a template's resources: what was written vs what is there now)."""
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def lista_recursos(value: object) -> list[dict]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def sin_nota(recurso: dict) -> dict:
    return {k: v for k, v in recurso.items() if k != "correccion"}


# ── Plan de una corrección ───────────────────────────────────────────────────


class Precios:
    """The oficial catalogs of the org and their entries by code (normalized)."""

    def __init__(self, catalogos: list[dict], entradas: list[dict]):
        self.oficiales = sorted((c for c in catalogos if c.get("oficial") is True),
                                key=lambda c: (str(c.get("created_at") or ""), str(c.get("id"))))
        ids = {str(c["id"]) for c in self.oficiales}
        self.por_codigo: dict[str, list[dict]] = {}
        for e in entradas:
            if str(e.get("catalog_id")) in ids:
                self.por_codigo.setdefault(normalize_codigo(e.get("codigo")), []).append(e)

    def entradas(self, codigo: str, tipo: str | None) -> list[dict]:
        found = self.por_codigo.get(normalize_codigo(codigo), [])
        mismo_tipo = [e for e in found if e.get("tipo") == tipo]
        return mismo_tipo or found

    def destino(self, tipo: str | None) -> dict | None:
        """Oficial catalog where a new price goes: by name for its tipo, else the first oficial."""
        from app.obra_import import plain

        clave = {"subcontrato": "SUBCONTRAT", "mano_obra": "MANO", "material": "MATERIAL",
                 "equipo": "EQUIPO"}.get(tipo or "")
        for c in self.oficiales:
            if clave and clave in plain(c.get("name")):
                return c
        return self.oficiales[0] if self.oficiales else None


def _precio_plan(cambio: dict, precios: Precios, fuente: dict) -> dict:
    despues = cambio["despues"]
    propuesta = parse_fecha(despues["fecha_precio"])
    datos = {
        "precio_sin_iva": float(despues["precio_sin_iva"]),
        "fecha_precio": propuesta.isoformat(),
        "proveedor": despues.get("proveedor") or None,
        **fuente,
    }
    entradas = precios.entradas(cambio["codigo"], cambio.get("tipo_recurso"))
    if not entradas:
        destino = precios.destino(cambio.get("tipo_recurso"))
        if destino is None:
            return {"accion": "sin_oficial", "estado": PARA_APLICAR, "datos": datos,
                    "detalle": "No hay una lista de precios oficial: marcá una como oficial en Precios "
                               "para poder cargar este precio."}
        return {"accion": "crear", "estado": PARA_APLICAR, "datos": datos, "catalogo": destino,
                "detalle": f"Se agrega a la lista «{destino.get('name')}»."}
    acciones = []
    for e in entradas:
        try:
            actual = parse_fecha(e.get("fecha_precio"))
        except ValueError:
            actual = None
        if actual and actual > propuesta:
            acciones.append(("saltear", e, f"La lista ya tiene un precio del {fecha_corta(actual)}: no se toca."))
        elif mismo(e.get("precio_sin_iva"), datos["precio_sin_iva"]) and actual == propuesta:
            acciones.append(("ya_esta", e, "La lista ya tiene este precio."))
        else:
            acciones.append(("actualizar", e, None))
    if any(a == "actualizar" for a, _, _ in acciones):
        return {"accion": "actualizar", "estado": PARA_APLICAR, "datos": datos,
                "entradas": [e for a, e, _ in acciones if a == "actualizar"],
                "salteadas": [(e, d) for a, e, d in acciones if a == "saltear"],
                "detalle": next((d for a, _, d in acciones if a == "saltear"), None)}
    if any(a == "saltear" for a, _, _ in acciones):
        return {"accion": "saltear", "estado": SE_SALTEA, "datos": datos,
                "salteadas": [(e, d) for a, e, d in acciones if a == "saltear"],
                "detalle": next(d for a, _, d in acciones if a == "saltear")}
    return {"accion": "ya_esta", "estado": YA_ESTA, "datos": datos, "detalle": "La lista ya tiene este precio."}


def planificar(lote: dict, correccion: dict, plantillas: dict[str, dict], precios: Precios) -> dict:
    """What applying ``correccion`` would do on the org's data, without writing anything.

    ``plantillas``: {codigo: item_templates row}. Returns::

        {"cambios": [vista de cada cambio con nombre_plantilla, nombre_recurso, estado_cambio, detalle],
         "conflictos": [texto, …],              # no coincide: no se puede aplicar
         "recursos": {codigo: recursos nuevos},  # fórmulas existentes que cambian
         "nuevas": [fila de item_templates],     # fórmulas que se crean
         "precios": [plan de cada precio],
         "pendiente": bool}                      # hay algo para escribir
    """
    nota = nota_correccion(lote, correccion)
    trabajo: dict[str, list[dict]] = {}  # working copy of each touched template
    tocadas: set[str] = set()
    nuevas: list[dict] = []
    precios_plan: list[dict] = []
    vistas: list[dict] = []
    conflictos: list[str] = []

    def recursos_de(codigo: str) -> list[dict] | None:
        if codigo not in plantillas:
            return None
        if codigo not in trabajo:
            trabajo[codigo] = [dict(r) for r in lista_recursos(plantillas[codigo].get("recursos"))]
        return trabajo[codigo]

    for cambio in correccion["cambios"]:
        tipo = cambio["tipo"]
        vista = {**cambio, "nombre_plantilla": None, "nombre_recurso": None,
                 "estado_cambio": PARA_APLICAR, "detalle": None}
        vistas.append(vista)

        def conflicto(texto: str, encontrado: dict | None = None, vista: dict = vista) -> None:
            vista.update(estado_cambio=NO_COINCIDE, detalle=texto)
            if encontrado is not None:
                vista["encontrado"] = encontrado
            conflictos.append(texto)

        if tipo == "precio":
            fuente = {"fuente": cambio["fuente"], "fuente_url": cambio.get("url") or None}
            plan = _precio_plan(cambio, precios, fuente)
            plan["cambio"] = cambio
            precios_plan.append(plan)
            actual = (plan.get("entradas") or [e for e, _ in plan.get("salteadas") or []] or [None])[0]
            vista.update(nombre_recurso=cambio.get("descripcion"), estado_cambio=plan["estado"],
                         detalle=plan.get("detalle"),
                         actual=None if actual is None else {
                             k: actual.get(k) for k in ("precio_sin_iva", "fecha_precio", "proveedor", "fuente")})
            continue

        if tipo == "plantilla_nueva":
            datos = cambio["plantilla"]
            codigo = str(datos["codigo"])
            vista.update(nombre_plantilla=_humano(datos.get("nombre")))
            recursos = [{**r, "correccion": nota} for r in datos["recursos"]]
            existente = plantillas.get(codigo)
            if existente is not None:
                actuales = [sin_nota(r) for r in lista_recursos(existente.get("recursos"))]
                if iguales(actuales, [sin_nota(r) for r in datos["recursos"]]):
                    vista.update(estado_cambio=YA_ESTA, detalle=f"La fórmula {codigo} ya existe así.")
                else:
                    conflicto(f"Ya hay una fórmula {codigo} («{_humano(existente.get('nombre'))}») distinta de la "
                              "que propone la revisión.")
                continue
            nuevas.append({
                "codigo": codigo,
                "nombre": datos["nombre"],
                "descripcion": datos.get("descripcion"),
                "unidad": datos["unidad"],
                "categoria": datos.get("categoria"),
                "parametros": datos.get("parametros") or [],
                "desperdicio_pct": datos.get("desperdicio_pct"),
                "recursos": recursos,
            })
            continue

        codigo_plantilla = str(cambio["plantilla"])
        plantilla = plantillas.get(codigo_plantilla)
        recursos = recursos_de(codigo_plantilla)
        if plantilla is None or recursos is None:
            conflicto(f"La empresa no tiene la fórmula {codigo_plantilla}.")
            continue
        vista["nombre_plantilla"] = _humano(plantilla.get("nombre"))

        if tipo == "renglon_nuevo":
            renglon = cambio["renglon"]
            vista["nombre_recurso"] = renglon.get("descripcion")
            iguales_cod = [r for r in recursos if normalize_codigo(r.get("codigo")) == normalize_codigo(renglon["codigo"])]
            if iguales_cod:
                if len(iguales_cod) == 1 and not _coinciden(iguales_cod[0], renglon):
                    vista.update(estado_cambio=YA_ESTA, detalle="La fórmula ya tiene este renglón.")
                else:
                    conflicto(f"La fórmula {codigo_plantilla} ya tiene un renglón {renglon['codigo']}.",
                              {k: iguales_cod[0].get(k) for k in renglon})
                continue
            recursos.append({**renglon, "correccion": nota})
            tocadas.add(codigo_plantilla)
            continue

        codigo = str(cambio["codigo"])
        indices = [i for i, r in enumerate(recursos) if normalize_codigo(r.get("codigo")) == normalize_codigo(codigo)]
        antes, despues = cambio.get("antes") or {}, cambio.get("despues") or {}

        if tipo == "renglon_quitar":
            if not indices:
                vista.update(estado_cambio=YA_ESTA, detalle=f"La fórmula ya no tiene el renglón {codigo}.")
                continue
            if len(indices) > 1:
                conflicto(f"La fórmula {codigo_plantilla} tiene {len(indices)} renglones {codigo}: no se sabe cuál sacar.")
                continue
            row = recursos[indices[0]]
            vista["nombre_recurso"] = row.get("descripcion")
            distintos = _coinciden(row, antes)
            if distintos:
                k = distintos[0]
                conflicto(f"La fórmula {codigo_plantilla} cambió desde la revisión: en el renglón {codigo}, "
                          f"{_campo(k)} es {_valor(row.get(k))} (la revisión esperaba {_valor(antes.get(k))}).",
                          {k: row.get(k) for k in antes})
                continue
            del recursos[indices[0]]
            tocadas.add(codigo_plantilla)
            continue

        # renglon: change some fields of one renglón
        if not indices and despues.get("codigo"):
            # Already corrected with its new code?
            indices_nuevo = [i for i, r in enumerate(recursos)
                             if normalize_codigo(r.get("codigo")) == normalize_codigo(despues["codigo"])]
            if len(indices_nuevo) == 1 and not _coinciden(recursos[indices_nuevo[0]], despues):
                vista.update(estado_cambio=YA_ESTA, nombre_recurso=recursos[indices_nuevo[0]].get("descripcion"),
                             detalle="El renglón ya tiene el valor nuevo.")
                continue
        if not indices:
            conflicto(f"La fórmula {codigo_plantilla} ya no tiene el renglón {codigo}.")
            continue
        if len(indices) > 1:
            conflicto(f"La fórmula {codigo_plantilla} tiene {len(indices)} renglones {codigo}: no se sabe cuál corregir.")
            continue
        row = recursos[indices[0]]
        vista["nombre_recurso"] = row.get("descripcion")
        distintos = _coinciden(row, antes)
        if distintos:
            if not _coinciden(row, despues):
                vista.update(estado_cambio=YA_ESTA, detalle="El renglón ya tiene el valor nuevo.")
                continue
            k = distintos[0]
            conflicto(f"La fórmula {codigo_plantilla} cambió desde la revisión: en el renglón {codigo}, "
                      f"{_campo(k)} es {_valor(row.get(k))} (la revisión esperaba {_valor(antes.get(k))}).",
                      {k: row.get(k) for k in antes})
            continue
        recursos[indices[0]] = {**row, **despues, "correccion": nota}
        tocadas.add(codigo_plantilla)

    pendiente = bool(tocadas or nuevas or any(p["accion"] in ("crear", "actualizar", "sin_oficial")
                                              for p in precios_plan))
    return {
        "cambios": vistas,
        "conflictos": conflictos,
        "recursos": {codigo: trabajo[codigo] for codigo in sorted(tocadas)},
        "nuevas": nuevas,
        "precios": precios_plan,
        "pendiente": pendiente,
    }
