"""Buscador de precios en internet (Precios → "Buscar en internet").

Le pide a OpenAI (Responses API con la herramienta de búsqueda web) de 2 a 6 opciones de precio
en comercios de Argentina (CABA/AMBA) para un material, y devuelve solo las que tienen un link
que la búsqueda realmente visitó o citó (anti-invento). Nada se guarda acá: "Usar este precio"
es el POST/PATCH de la entrada de la lista con ``fuente`` y ``fuente_url``.

Salida de ``buscar_opciones``::

    {"consulta": "Cemento portland 50 kg (bolsa)",
     "opciones": [{"comercio", "producto", "presentacion", "precio", "con_iva", "moneda",
                   "unidad_publicada", "cantidad_unidades_app", "coincide_unidad",
                   "precio_unidad_app_sin_iva", "cuenta", "fecha", "url"}],
     "aviso": None | "texto"}

``precio_unidad_app_sin_iva`` y ``cuenta`` los calcula el servidor (no el modelo): precio publicado,
menos el IVA (21 %) si lo incluye, dividido por cuántas unidades de la app trae la presentación.

Errores (``BuscadorError.codigo``, el router responde 502 con ``{"codigo", "mensaje"}``): ``CLAVE_INVALIDA``
(OpenAI rechazó la clave), ``SIN_CREDITO`` (sin crédito o demasiados pedidos), ``TIEMPO`` (más de un minuto),
``MODELO`` (el modelo no está disponible) y ``ERROR_BUSQUEDA`` (cualquier otro, o una respuesta que no se lee).
Sin clave: ``BuscadorNoConfigurado`` (503). ``estado()`` dice si está configurado, sin buscar nada.

Reemplazar la búsqueda real (pruebas y servidor falso, sin red):

1. Variable de entorno ``FAKE_BUSCADOR_ARCHIVO`` = ruta a un JSON. Si está, no se llama a OpenAI
   (ni hace falta OPENAI_API_KEY): las opciones salen del archivo y pasan por el mismo control
   (precio > 0, pesos, link) y la misma cuenta. Formato::

       {"opciones": [{"comercio": "Easy", "producto": "Cemento Loma Negra 50 kg",
                      "presentacion": "Bolsa 50 kg", "precio": 12990, "con_iva": true, "moneda": "ARS",
                      "unidad_publicada": "bolsa", "cantidad_unidades_app": 1,
                      "url": "https://www.easy.com.ar/cemento"}],
        "por_descripcion": {"arena": {"opciones": []},
                            "falla": {"error": "Se cortó la búsqueda"},
                            "sin configurar": {"no_configurado": true}}}

   ``por_descripcion``: si la descripción buscada contiene la clave (sin mayúsculas), se usa ese
   bloque en vez del general. ``error`` simula una falla (502) y ``no_configurado`` el 503.
   Se lee en cada búsqueda: se puede cambiar el archivo sin reiniciar.

2. O reemplazar la función: ``app.price_search.buscar_opciones = mi_funcion`` (async, mismos
   argumentos: descripcion, unidad, tipo=None, codigo=None; devuelve el dict de arriba o levanta
   ``BuscadorNoConfigurado`` / ``BuscadorError``). El router la llama por el módulo, así que el
   reemplazo vale aunque se haga después de importar la app.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.budget_prices import today
from app.config import get_settings

logger = logging.getLogger(__name__)

TIMEOUT_S = 60
IVA = 0.21
MAX_OPCIONES = 6

NO_CONFIGURADO = "El buscador de precios no está configurado"
AVISO_SIN_OPCIONES = ("No encontramos precios con un link para mostrar. Probá con otras palabras (la marca, la "
                      "presentación) o buscá de nuevo en un rato.")
AVISO_PUBLICO = "Precios de venta al público: un corralón por volumen suele ser más barato."


class BuscadorNoConfigurado(Exception):
    """No OPENAI_API_KEY: the router answers 503."""


class BuscadorError(Exception):
    """OpenAI failed or took too long: the router answers 502 with ``codigo`` and this message."""

    def __init__(self, mensaje: str, codigo: str = "ERROR_BUSQUEDA"):
        super().__init__(mensaje)
        self.codigo = codigo


# Errors of OpenAI, by kind (the code goes to the screen, the technical detail to the server log)
MSG_TIEMPO = "La búsqueda tardó más de un minuto y se cortó. Probá de nuevo."
MSG_CLAVE = "La clave de OpenAI del servidor no es válida: hay que cambiarla en Render."
MSG_CREDITO = "Se terminó el crédito de OpenAI o hay demasiados pedidos: probá más tarde."
MSG_MODELO = "El modelo configurado para el buscador no está disponible."
MSG_OTRO = "No se pudo buscar en internet en este momento. Probá de nuevo en unos minutos."


# ── Pedido al modelo ─────────────────────────────────────────────────────────

INSTRUCCIONES = """Sos un asistente de compras de una constructora de Buenos Aires, Argentina.
Buscá en internet el precio ACTUAL del producto que te piden, en comercios que vendan en CABA o el AMBA:
corralones, ferreterías, casas de materiales, cadenas (Easy, Sodimac, etc.), tiendas oficiales en Mercado Libre
o revistas del rubro con listas de precios. Solo precios en pesos argentinos.

Devolvé de 2 a 6 opciones distintas (distintos comercios si se puede). Para cada una:
- comercio, producto (el nombre tal cual en el sitio), presentacion (ej. "Bolsa de 50 kg").
- precio: el número publicado, en pesos, sin puntos de miles (12990.5). con_iva: true si el precio publicado
  incluye IVA (lo normal en venta al público), false si el sitio dice "+ IVA" o "sin IVA".
- moneda: "ARS".
- unidad_publicada: en qué unidad está el precio publicado (bolsa, kg, m2, m, u, rollo, litro...).
- cantidad_unidades_app: cuántas unidades de la UNIDAD DE LA APP trae esa presentación (ej. la app pide "kg" y
  la bolsa es de 50 kg → 50; la app pide "bolsa" y es una bolsa → 1; la app pide "m2" y la caja cubre 2,5 m2 → 2.5).
  Si no se puede saber, poné 1 y explicalo en "cuenta".
- cuenta: una oración corta que explique la conversión a la unidad de la app.
- url: el link EXACTO de la página del producto donde viste el precio (tiene que ser una de las páginas que
  abriste o citaste en esta búsqueda). Nunca inventes un link ni un precio: si no encontrás, devolvé menos opciones.
Si no encontrás ninguna, devolvé "opciones": [] y explicá por qué en "aviso"."""

_OPCION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["comercio", "producto", "presentacion", "precio", "con_iva", "moneda", "unidad_publicada",
                 "cantidad_unidades_app", "cuenta", "url"],
    "properties": {
        "comercio": {"type": "string"},
        "producto": {"type": "string"},
        "presentacion": {"type": "string"},
        "precio": {"type": "number"},
        "con_iva": {"type": "boolean"},
        "moneda": {"type": "string"},
        "unidad_publicada": {"type": "string"},
        "cantidad_unidades_app": {"type": "number"},
        "cuenta": {"type": "string"},
        "url": {"type": "string"},
    },
}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["opciones", "aviso"],
    "properties": {
        "opciones": {"type": "array", "items": _OPCION_SCHEMA},
        "aviso": {"type": ["string", "null"]},
    },
}


def consulta_de(descripcion: str, unidad: str | None) -> str:
    descripcion = " ".join(str(descripcion or "").split())
    unidad = str(unidad or "").strip()
    return f"{descripcion} ({unidad})" if unidad else descripcion


def _pedido(descripcion: str, unidad: str | None, tipo: str | None, codigo: str | None) -> str:
    partes = [f"Producto: {' '.join(str(descripcion or '').split())}",
              f"Unidad de la app: {unidad or 'unidad'}"]
    if tipo:
        partes.append(f"Tipo: {tipo.replace('_', ' ')}")
    if codigo:
        partes.append(f"Código interno (no lo busques, es nuestro): {codigo}")
    partes.append(f"Fecha de hoy: {today().isoformat()}")
    return "\n".join(partes)


# ── Anti-invento: links que la búsqueda vio ──────────────────────────────────


def normalizar_url(url: object) -> str | None:
    """Comparable link: http(s) only, host in lower case without "www.", no fragment, no utm_*
    parameters, no trailing slash. None when it is not a web link."""
    if not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return None
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                       if not k.lower().startswith("utm_")])
    path = parts.path.rstrip("/")
    return urlunsplit(("https", host, path, query, ""))


def url_limpia(url: str) -> str:
    """The link to show: as it came, without the utm_* parameters and the fragment."""
    parts = urlsplit(url.strip())
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                       if not k.lower().startswith("utm_")])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


def _get(obj: object, key: str) -> object:
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def fuentes_de(response: object) -> set[str]:
    """Normalized links the search really saw: url_citation annotations of the answer, the sources
    of each web search call and the pages it opened."""
    urls: set[str] = set()

    def add(url: object) -> None:
        norm = normalizar_url(url)
        if norm:
            urls.add(norm)

    for item in _get(response, "output") or []:
        tipo = _get(item, "type")
        if tipo == "message":
            for content in _get(item, "content") or []:
                for ann in _get(content, "annotations") or []:
                    if _get(ann, "type") == "url_citation":
                        add(_get(ann, "url"))
        elif tipo == "web_search_call":
            action = _get(item, "action")
            if action is None:
                continue
            add(_get(action, "url"))
            for source in _get(action, "sources") or []:
                add(_get(source, "url"))
    return urls


def texto_de(response: object) -> str:
    """The text of the answer (all its output_text parts)."""
    partes = []
    for item in _get(response, "output") or []:
        if _get(item, "type") != "message":
            continue
        for content in _get(item, "content") or []:
            if _get(content, "type") in ("output_text", None) and isinstance(_get(content, "text"), str):
                partes.append(_get(content, "text"))
    if partes:
        return "".join(partes)
    text = _get(response, "output_text")
    return text if isinstance(text, str) else ""


def parsear(texto: str) -> dict:
    """The JSON of the answer. Tolerates ```json fences and text around the object."""
    texto = (texto or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", texto, re.DOTALL)
    if fence:
        texto = fence.group(1).strip()
    try:
        data = json.loads(texto)
    except ValueError:
        inicio, fin = texto.find("{"), texto.rfind("}")
        if inicio < 0 or fin <= inicio:
            raise BuscadorError("La búsqueda devolvió una respuesta que no se puede leer. Probá de nuevo.")
        try:
            data = json.loads(texto[inicio:fin + 1])
        except ValueError as exc:
            raise BuscadorError("La búsqueda devolvió una respuesta que no se puede leer. Probá de nuevo.") from exc
    if isinstance(data, list):
        data = {"opciones": data}
    if not isinstance(data, dict):
        raise BuscadorError("La búsqueda devolvió una respuesta que no se puede leer. Probá de nuevo.")
    return data


# ── Opciones: control y cuenta ───────────────────────────────────────────────


def _num(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("$", "").replace(" ", "")
    if not text:
        return None
    if "," in text:  # 12.990,50 (Argentina)
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def pesos(value: float) -> str:
    """12990 → '$12.990'; 214.7 → '$214,70' (decimals only under $1.000)."""
    if abs(value) >= 1000 or float(value).is_integer():
        return "$" + f"{round(value):,.0f}".replace(",", ".")
    return "$" + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _moneda_ok(value: object) -> bool:
    return str(value or "ARS").strip().upper() in ("ARS", "$", "PESOS", "PESO", "AR$", "ARG")


def _texto(value: object) -> str:
    return " ".join(str(value or "").split())


def armar_opcion(raw: dict, unidad: str | None, hoy: str) -> dict | None:
    """One option checked and with the server's arithmetic, or None when it must not be shown."""
    if not isinstance(raw, dict):
        return None
    precio = _num(raw.get("precio"))
    url = raw.get("url")
    if precio is None or precio <= 0 or not _moneda_ok(raw.get("moneda")) or not normalizar_url(url):
        return None
    con_iva = raw.get("con_iva")
    con_iva = True if con_iva is None else bool(con_iva)  # retail prices include VAT unless they say so
    cantidad = _num(raw.get("cantidad_unidades_app"))
    cantidad_ok = cantidad is not None and cantidad > 0
    if not cantidad_ok:
        cantidad = 1.0
    sin_iva = precio / (1 + IVA) if con_iva else precio
    por_unidad = sin_iva / cantidad
    presentacion = _texto(raw.get("presentacion")) or _texto(raw.get("unidad_publicada")) or "la presentación"
    if presentacion[1:2].islower():
        presentacion = presentacion[:1].lower() + presentacion[1:]  # "Bolsa de 50 kg" → "bolsa de 50 kg"
    unidad_app = _texto(unidad) or "unidad"
    cuenta = f"{pesos(precio)} {presentacion} {'con IVA' if con_iva else 'sin IVA'}"
    if con_iva:
        cuenta += f" → {pesos(sin_iva)} sin IVA"
    if abs(cantidad - 1) > 1e-9:
        cuenta += f" → {pesos(sin_iva)} / {str(round(cantidad, 4)).replace('.', ',')} = {pesos(por_unidad)} por {unidad_app}"
    explicacion = _texto(raw.get("cuenta"))
    if explicacion:
        cuenta += f" ({explicacion})"
    if not cantidad_ok:
        cuenta += ". No se sabe cuántos " + unidad_app + " trae: revisá el número antes de guardar."
    return {
        "comercio": _texto(raw.get("comercio")) or "Comercio sin nombre",
        "producto": _texto(raw.get("producto")),
        "presentacion": _texto(raw.get("presentacion")) or None,
        "precio": round(precio, 2),
        "con_iva": con_iva,
        "moneda": "ARS",
        "unidad_publicada": _texto(raw.get("unidad_publicada")) or None,
        "cantidad_unidades_app": round(cantidad, 6),
        # The presentation is not the app's unit (or it is unknown): the screen marks it to check the number
        "coincide_unidad": cantidad_ok and abs(cantidad - 1) < 1e-9,
        "precio_unidad_app_sin_iva": round(por_unidad, 2),
        "cuenta": cuenta,
        "fecha": hoy,
        "url": url_limpia(str(url)),
    }


def filtrar(data: dict, fuentes: set[str] | None, unidad: str | None) -> tuple[list[dict], int]:
    """Valid options whose link is among the search's sources (all, when ``fuentes`` is None).

    Returns (options, how many were dropped). Repeated links count once.
    """
    hoy = today().isoformat()
    opciones, descartadas, vistas = [], 0, set()
    for raw in data.get("opciones") or []:
        opcion = armar_opcion(raw, unidad, hoy)
        norm = normalizar_url(opcion["url"]) if opcion else None
        if opcion is None or (fuentes is not None and norm not in fuentes) or norm in vistas:
            descartadas += 1
            continue
        vistas.add(norm)
        opciones.append(opcion)
    return opciones[:MAX_OPCIONES], descartadas


def resultado(consulta: str, opciones: list[dict], aviso: str | None = None) -> dict:
    if not opciones:
        return {"consulta": consulta, "opciones": [], "aviso": aviso or AVISO_SIN_OPCIONES}
    return {"consulta": consulta, "opciones": opciones, "aviso": AVISO_PUBLICO}


# ── Búsqueda ─────────────────────────────────────────────────────────────────


def _cliente():  # type: ignore[no-untyped-def]
    """The OpenAI client, or None without OPENAI_API_KEY. Tests replace it."""
    return get_settings().openai_client


def estado() -> dict:
    """Whether the search can run (OpenAI client or FAKE_BUSCADOR_ARCHIVO) and the model. Never the key."""
    configurado = bool(os.environ.get("FAKE_BUSCADOR_ARCHIVO")) or _cliente() is not None
    return {"configurado": configurado, "modelo": get_settings().OPENAI_MODEL_PRECIOS}


def _es(exc: BaseException, nombre: str) -> bool:
    """``exc`` is the openai SDK error ``nombre`` (or a class with that name: the tests' fakes)."""
    try:
        import openai
        cls = getattr(openai, nombre, None)
    except ImportError:  # pragma: no cover - openai is in requirements.txt
        cls = None
    if cls is not None and isinstance(exc, cls):
        return True
    return any(c.__name__ == nombre for c in type(exc).__mro__)


def _pedido_inicial(model: str, pedido: str) -> dict:
    return {
        "model": model,
        "instructions": INSTRUCCIONES,
        "input": pedido,
        "tools": [{"type": "web_search", "search_context_size": "medium",
                   "user_location": {"type": "approximate", "country": "AR", "city": "Buenos Aires",
                                     "region": "Buenos Aires", "timezone": "America/Argentina/Buenos_Aires"}}],
        "include": ["web_search_call.action.sources"],
        "text": {"format": {"type": "json_schema", "name": "opciones_de_precio", "schema": SCHEMA,
                            "strict": True}},
        "timeout": TIMEOUT_S,
    }


def _sin_include(kwargs: dict) -> dict:
    return {k: v for k, v in kwargs.items() if k != "include"}


def _con_preview(kwargs: dict) -> dict:
    tools = [{**t, "type": "web_search_preview"} if t.get("type") == "web_search" else t for t in kwargs["tools"]]
    return {**kwargs, "tools": tools}


def _sin_ubicacion(kwargs: dict) -> dict:
    return {**kwargs, "tools": [{k: v for k, v in t.items() if k != "user_location"} for t in kwargs["tools"]]}


def _sin_formato(kwargs: dict) -> dict:
    # The answer is read as JSON from the text anyway (parsear)
    return {k: v for k, v in kwargs.items() if k != "text"}


# When OpenAI rejects the request as it goes (400), it is retried in this order, each step on top of
# the previous one: without the detailed sources, with the older search tool (with and without the
# location) and without the strict format.
REINTENTOS = [
    ("sin include (fuentes detalladas)", _sin_include),
    ("con la herramienta web_search_preview", _con_preview),
    ("web_search_preview sin user_location", _sin_ubicacion),
    ("sin text.format (formato estricto)", _sin_formato),
]


async def _llamar(client, model: str, pedido: str):  # type: ignore[no-untyped-def]
    kwargs = _pedido_inicial(model, pedido)
    pasos = list(REINTENTOS)
    while True:
        try:
            return await client.responses.create(**kwargs)
        except Exception as exc:
            if not _es(exc, "BadRequestError") or not pasos:
                raise
            motivo, cambio = pasos.pop(0)
            logger.warning("Buscador de precios: OpenAI rechazó el pedido (%s). Reintento %s.", exc, motivo)
            kwargs = cambio(kwargs)


def error_de_openai(exc: BaseException) -> BuscadorError:
    """The error to show for an OpenAI failure, by kind. The detail goes to the log."""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) or _es(exc, "APITimeoutError") \
            or "timeout" in exc.__class__.__name__.lower() or "timed out" in str(exc).lower():
        return BuscadorError(MSG_TIEMPO, "TIEMPO")
    if _es(exc, "AuthenticationError"):
        logger.error("Buscador de precios: OpenAI rechazó la clave (OPENAI_API_KEY): %s", exc)
        return BuscadorError(MSG_CLAVE, "CLAVE_INVALIDA")
    if _es(exc, "RateLimitError"):  # also insufficient_quota (no credit left)
        logger.error("Buscador de precios: sin crédito o demasiados pedidos a OpenAI: %s", exc)
        return BuscadorError(MSG_CREDITO, "SIN_CREDITO")
    if _es(exc, "PermissionDeniedError") or _es(exc, "NotFoundError"):
        logger.error("Buscador de precios: el modelo %s no está disponible: %s",
                     get_settings().OPENAI_MODEL_PRECIOS, exc)
        return BuscadorError(MSG_MODELO, "MODELO")
    logger.warning("El buscador de precios falló: %s", exc, exc_info=exc)
    return BuscadorError(MSG_OTRO)


async def _buscar_openai(descripcion: str, unidad: str | None, tipo: str | None, codigo: str | None) -> dict:
    client = _cliente()
    if client is None:
        raise BuscadorNoConfigurado(NO_CONFIGURADO)
    consulta = consulta_de(descripcion, unidad)
    try:
        response = await asyncio.wait_for(
            _llamar(client, get_settings().OPENAI_MODEL_PRECIOS, _pedido(descripcion, unidad, tipo, codigo)),
            timeout=TIMEOUT_S + 5,
        )
    except Exception as exc:
        raise error_de_openai(exc) from exc

    data = parsear(texto_de(response))
    fuentes = fuentes_de(response)
    opciones, descartadas = filtrar(data, fuentes, unidad)
    if descartadas:
        logger.info("Buscador de precios: %d opciones descartadas (sin link de la búsqueda o sin precio)", descartadas)
    aviso = data.get("aviso") if isinstance(data.get("aviso"), str) and data.get("aviso").strip() else None
    return resultado(consulta, opciones, aviso)


def _buscar_archivo(path: str, descripcion: str, unidad: str | None) -> dict:
    """Options from the FAKE_BUSCADOR_ARCHIVO file (no network)."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BuscadorError(f"No se pudo leer el archivo del buscador falso: {exc}") from exc
    bloque = data
    texto = descripcion.lower()
    for clave, valor in (data.get("por_descripcion") or {}).items():
        if clave.lower() in texto:
            bloque = valor
            break
    if bloque.get("no_configurado"):
        raise BuscadorNoConfigurado(NO_CONFIGURADO)
    if bloque.get("error"):
        raise BuscadorError(str(bloque["error"]))
    opciones, _ = filtrar(bloque, None, unidad)
    return resultado(consulta_de(descripcion, unidad), opciones, bloque.get("aviso"))


async def buscar_opciones(descripcion: str, unidad: str | None, tipo: str | None = None,
                          codigo: str | None = None) -> dict:
    """Price options on the internet for one material. See the module docstring to replace it."""
    archivo = os.environ.get("FAKE_BUSCADOR_ARCHIVO")
    if archivo:
        return _buscar_archivo(archivo, descripcion, unidad)
    return await _buscar_openai(descripcion, unidad, tipo, codigo)
