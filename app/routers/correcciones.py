"""Correcciones de la revisión de Ginkgo, para aplicar con un botón (Fórmulas → Correcciones).

Las correcciones salen de ``app/data/correcciones_ginkgo.json`` (app/correcciones.py). Cada una
cambia renglones de fórmulas, crea fórmulas o carga precios en la lista oficial. Aplicar escribe
todo o nada y guarda en ``correcciones_aplicadas`` (migración 012) la copia de lo que había,
para poder deshacerla. Todo filtrado por la empresa del usuario (``org_id``).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app import correcciones as corr
from app.auth import get_current_user, require_editor
from app.budget_prices import fetch_all
from app.catalog_prices import history_row
from app.db import get_data_db
from app.recipes import validate_template

logger = logging.getLogger(__name__)
router = APIRouter()

TABLA = "correcciones_aplicadas"
FALTA_MIGRACION = ("Falta la migración 012: pedile a quien administra la base que la corra antes de aplicar "
                   "correcciones.")
NO_SE_APLICO = "No se aplicó la corrección: todo quedó como estaba. Probá de nuevo."
A_MEDIAS = ("No se pudo aplicar la corrección y algunas fórmulas o precios pueden haber quedado a medias. "
            "Volvé a aplicarla o deshacela.")
NO_SE_DESHIZO = "No se deshizo la corrección: todo quedó como estaba. Probá de nuevo."
A_MEDIAS_DESHACER = ("No se pudo deshacer la corrección y algunas fórmulas o precios pueden haber quedado a "
                     "medias. Volvé a deshacerla.")
AVISO_PRESUPUESTOS = ("Los presupuestos ya cargados no cambian solos. Para ver el efecto en Ginkgo, volvé a cargar "
                      "la obra en Cargar obra.")
PRECIO_KEYS = ("precio_sin_iva", "fecha_precio", "proveedor", "fuente", "fuente_url")


# ── Lectura ──────────────────────────────────────────────────────────────────


def _lote() -> tuple[dict | None, str | None]:
    """The corrections file, or (None, aviso) when it cannot be read: the screen says so."""
    try:
        return corr.cargar(corr.RUTA), None
    except corr.LoteInvalido as exc:
        logger.error("El archivo de correcciones no es válido: %s", exc.errores)
        return None, ("El archivo de correcciones tiene errores y no se puede mostrar: "
                      + "; ".join(exc.errores[:5]) + ("…" if len(exc.errores) > 5 else ""))


def _plantillas(db, org_id: str) -> dict[str, dict]:  # type: ignore[no-untyped-def]
    rows = fetch_all(lambda: db.table("item_templates").select("*").eq("org_id", org_id).order("id"))
    return {str(r["codigo"]): r for r in rows if r.get("codigo")}


def _precios(db, org_id: str) -> corr.Precios:  # type: ignore[no-untyped-def]
    # select("*"): before migration 011 there is no "oficial" column and nothing is oficial
    catalogos = db.table("price_catalogs").select("*").eq("org_id", org_id).execute().data or []
    oficiales = [str(c["id"]) for c in catalogos if c.get("oficial") is True]
    entradas = fetch_all(
        lambda: db.table("catalog_entries").select("*").eq("org_id", org_id).in_("catalog_id", oficiales).order("id")
    ) if oficiales else []
    return corr.Precios(catalogos, entradas)


def _registros(db, org_id: str, lote: str, *, estricto: bool) -> list[dict]:  # type: ignore[no-untyped-def]
    """Applied corrections of the lote (newest last). Without migration 012: [] or 409 when ``estricto``."""
    try:
        rows = fetch_all(
            lambda: db.table(TABLA).select("*").eq("org_id", org_id).eq("lote", lote).order("aplicada_at")
        )
    except Exception as exc:
        if estricto:
            logger.warning("No se pudo leer %s (¿falta correr migrations/012?)", TABLA, exc_info=True)
            raise HTTPException(409, {"codigo": "FALTA_MIGRACION", "mensaje": FALTA_MIGRACION}) from exc
        logger.warning("No se pudo leer %s (¿falta correr migrations/012?)", TABLA, exc_info=True)
        return []
    return rows


def _activo(registros: list[dict], correccion_id: str) -> dict | None:
    activos = [r for r in registros if r.get("correccion_id") == correccion_id and r.get("estado") == "aplicada"]
    return activos[-1] if activos else None


def _correccion(lote: dict, correccion_id: str) -> dict:
    found = next((c for c in lote["correcciones"] if c["id"] == correccion_id), None)
    if found is None:
        raise HTTPException(404, f"No hay una corrección {correccion_id} en la revisión")
    return found


# ── Vista ────────────────────────────────────────────────────────────────────


def _vista(lote: dict, correccion: dict, plan: dict, registro: dict | None) -> dict:
    base = {k: correccion.get(k) for k in ("id", "titulo", "por_que", "supuesto", "fuentes", "efecto_ginkgo")}
    cambios = plan["cambios"]
    if registro is not None:
        despues = registro.get("despues") or {}
        salteados = despues.get("salteados") or []
        cambios = [_cambio_aplicado(c, salteados) for c in correccion["cambios"]]
        for vista, actual in zip(cambios, plan["cambios"]):
            vista.update(nombre_plantilla=actual.get("nombre_plantilla"), nombre_recurso=actual.get("nombre_recurso"))
        por = registro.get("aplicada_por")
        fecha = registro.get("aplicada_at")
        detalle = f"Aplicada el {corr.fecha_corta(fecha)}" + (f" por {por}" if por else "") + "."
        estado = "aplicada"
        if salteados:
            estado = "en_parte"
            detalle += " " + " ".join(f"{s.get('codigo')}: {s.get('detalle')}" for s in salteados)
        return {**base, "cambios": cambios, "estado": estado, "aplicada": {"por": por, "fecha": fecha},
                "detalle": detalle}
    if plan["conflictos"]:
        return {**base, "cambios": cambios, "estado": "no_coincide", "aplicada": None,
                "detalle": "No coincide: " + " ".join(plan["conflictos"])}
    if not plan["pendiente"]:
        return {**base, "cambios": cambios, "estado": "aplicada", "aplicada": None,
                "detalle": "Las fórmulas y los precios ya tienen estos valores (se corrigieron por otro lado): "
                           "no hay nada para aplicar ni para deshacer desde acá."}
    return {**base, "cambios": cambios, "estado": "para_aplicar", "aplicada": None, "detalle": None}


def _cambio_aplicado(cambio: dict, salteados: list[dict]) -> dict:
    vista = {**cambio, "nombre_plantilla": None, "nombre_recurso": None, "estado_cambio": corr.APLICADO,
             "detalle": None}
    if cambio["tipo"] == "precio":
        salteado = next((s for s in salteados if s.get("codigo") == cambio["codigo"]), None)
        if salteado:
            vista.update(estado_cambio=corr.SALTEADO, detalle=salteado.get("detalle"))
    return vista


def _estado(db, org_id: str, lote: dict, correccion: dict, registros: list[dict]) -> tuple[dict, dict]:  # type: ignore[no-untyped-def]
    plan = corr.planificar(lote, correccion, _plantillas(db, org_id), _precios(db, org_id))
    return plan, _vista(lote, correccion, plan, _activo(registros, correccion["id"]))


@router.get("")
async def listar_correcciones(user: dict = Depends(get_current_user)):
    """Every correction of the revisión with its state for the user's company."""
    lote, aviso = _lote()
    if lote is None:
        return {"lote": None, "titulo": None, "fecha": None, "correcciones": [], "aviso": aviso}
    db = get_data_db()
    org_id = user["org_id"]
    plantillas = _plantillas(db, org_id)
    precios = _precios(db, org_id)
    registros = _registros(db, org_id, lote["lote"], estricto=False)
    vistas = []
    for correccion in lote["correcciones"]:
        plan = corr.planificar(lote, correccion, plantillas, precios)
        vistas.append(_vista(lote, correccion, plan, _activo(registros, correccion["id"])))
    return {"lote": lote["lote"], "titulo": lote["titulo"], "fecha": lote["fecha"], "correcciones": vistas,
            "aviso": None}


# ── Escritura con vuelta atrás ───────────────────────────────────────────────


class _Escritura:
    """Writes that remember how to undo themselves (all or nothing, like indirectos)."""

    def __init__(self, db, org_id: str):  # type: ignore[no-untyped-def]
        self.db, self.org_id = db, org_id
        self.inversas: list = []

    def _check(self, result, que: str) -> list[dict]:  # type: ignore[no-untyped-def]
        if not result.data:
            raise RuntimeError(f"No se escribió {que}")
        return result.data

    def plantilla(self, row: dict, recursos: list[dict], editado: object) -> dict:
        datos: dict = {"recursos": recursos}
        if "editado" in row:  # migration 007
            datos["editado"] = editado
        self._check(self.db.table("item_templates").update(datos).eq("id", str(row["id"]))
                    .eq("org_id", self.org_id).execute(), f"la fórmula {row.get('codigo')}")
        viejo = {"recursos": row.get("recursos")}
        if "editado" in row:
            viejo["editado"] = row.get("editado")
        self.inversas.append(lambda: self.db.table("item_templates").update(viejo).eq("id", str(row["id"]))
                             .eq("org_id", self.org_id).execute())
        return datos

    def crear_plantilla(self, datos: dict) -> dict:
        creada = self._check(self.db.table("item_templates").insert({**datos, "org_id": self.org_id}).execute(),
                             f"la fórmula {datos.get('codigo')}")[0]
        self.inversas.append(lambda: self.borrar_plantilla(creada))
        return creada

    def borrar_plantilla(self, row: dict) -> None:
        self.db.table("item_templates").delete().eq("id", str(row["id"])).eq("org_id", self.org_id).execute()

    def _historial(self, entry: dict) -> str | None:
        hist = self.db.table("catalog_price_history").insert(history_row({**entry, "org_id": self.org_id})).execute()
        hid = (hist.data or [{}])[0].get("id")
        if hid:
            self.inversas.append(lambda: self._borrar_historial(str(hid)))
        return str(hid) if hid else None

    def _borrar_historial(self, hid: str) -> None:
        self.db.table("catalog_price_history").delete().eq("id", hid).eq("org_id", self.org_id).execute()

    def precio(self, entry: dict, datos: dict, *, historial: bool = True) -> dict:
        guardada = self._check(self.db.table("catalog_entries").update(datos).eq("id", str(entry["id"]))
                               .eq("org_id", self.org_id).execute(), f"el precio de {entry.get('codigo')}")[0]
        viejo = {k: entry.get(k) for k in datos}
        self.inversas.append(lambda: self.db.table("catalog_entries").update(viejo).eq("id", str(entry["id"]))
                             .eq("org_id", self.org_id).execute())
        return {**guardada, "historial_id": self._historial({**entry, **guardada}) if historial else None}

    def crear_precio(self, datos: dict) -> dict:
        creada = self._check(self.db.table("catalog_entries").insert({**datos, "org_id": self.org_id}).execute(),
                             f"el precio de {datos.get('codigo')}")[0]
        self.inversas.append(lambda: self.borrar_precio(str(creada["id"])))
        return {**creada, "historial_id": self._historial(creada)}

    def borrar_precio(self, entry_id: str) -> None:
        # The history goes with the entry (ON DELETE CASCADE); deleted by hand too, for safety
        self.db.table("catalog_price_history").delete().eq("entry_id", entry_id).eq("org_id", self.org_id).execute()
        self.db.table("catalog_entries").delete().eq("id", entry_id).eq("org_id", self.org_id).execute()

    def registro(self, datos: dict) -> dict:
        creado = self._check(self.db.table(TABLA).insert({**datos, "org_id": self.org_id}).execute(),
                             "el registro de la corrección")[0]
        self.inversas.append(lambda: self.db.table(TABLA).delete().eq("id", str(creado["id"]))
                             .eq("org_id", self.org_id).execute())
        return creado

    def marcar(self, registro: dict, datos: dict) -> None:
        self._check(self.db.table(TABLA).update(datos).eq("id", str(registro["id"])).eq("org_id", self.org_id)
                    .execute(), "el registro de la corrección")
        viejo = {k: registro.get(k) for k in datos}
        self.inversas.append(lambda: self.db.table(TABLA).update(viejo).eq("id", str(registro["id"]))
                             .eq("org_id", self.org_id).execute())

    def volver_atras(self) -> None:
        for inversa in reversed(self.inversas):
            inversa()


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fallar(exc: Exception, escritura: _Escritura, que: str, no_se: str, a_medias: str) -> HTTPException:
    logger.exception("%s falló; vuelvo atrás %d escrituras", que, len(escritura.inversas))
    try:
        escritura.volver_atras()
    except Exception:
        logger.exception("No se pudo volver atrás: %s", que)
        return HTTPException(500, {"codigo": "A_MEDIAS", "mensaje": a_medias})
    return HTTPException(500, {"codigo": "NO_SE_APLICO", "mensaje": no_se})


def _validar_formulas(plan: dict, plantillas: dict[str, dict]) -> None:
    """The same check as the formula editor (_check_template), for every formula the correction leaves."""
    errores: list[str] = []
    for codigo, recursos in plan["recursos"].items():
        parametros = corr.lista_recursos(plantillas[codigo].get("parametros"))
        errores += [f"Fórmula {codigo}: {e}" for e in validate_template(recursos, parametros)]
    for nueva in plan["nuevas"]:
        errores += [f"Fórmula {nueva['codigo']}: {e}" for e in validate_template(nueva["recursos"], nueva["parametros"])]
    if errores:
        raise HTTPException(422, errores)


# ── Aplicar ──────────────────────────────────────────────────────────────────


@router.post("/{correccion_id}/aplicar")
async def aplicar_correccion(correccion_id: str, user: dict = Depends(require_editor)):
    """Apply one correction: all its changes, or none (409 when the data no longer matches)."""
    lote, aviso = _lote()
    if lote is None:
        raise HTTPException(409, aviso)
    correccion = _correccion(lote, correccion_id)
    db = get_data_db()
    org_id = user["org_id"]

    registros = _registros(db, org_id, lote["lote"], estricto=True)
    if _activo(registros, correccion_id):
        raise HTTPException(409, f"La corrección {correccion_id} ya está aplicada")

    plantillas = _plantillas(db, org_id)
    plan = corr.planificar(lote, correccion, plantillas, _precios(db, org_id))
    if plan["conflictos"]:
        raise HTTPException(409, {
            "codigo": "NO_COINCIDE",
            "mensaje": "No se aplicó: " + " ".join(plan["conflictos"]),
            "cambios": [c for c in plan["cambios"] if c["estado_cambio"] == corr.NO_COINCIDE],
        })
    if any(p["accion"] == "sin_oficial" for p in plan["precios"]):
        raise HTTPException(409, {
            "codigo": "SIN_LISTA_OFICIAL",
            "mensaje": "No se aplicó: no hay una lista de precios oficial. Marcá una como oficial en Precios y "
                       "volvé a aplicar la corrección.",
        })
    if not plan["pendiente"]:
        raise HTTPException(409, "Las fórmulas y los precios ya tienen estos valores: no hay nada para aplicar")
    _validar_formulas(plan, plantillas)

    escritura = _Escritura(db, org_id)
    antes: dict = {"plantillas": [], "precios": []}
    despues: dict = {"plantillas": [], "plantillas_creadas": [], "precios": [], "precios_creados": [],
                     "salteados": []}
    try:
        for codigo, recursos in plan["recursos"].items():
            row = plantillas[codigo]
            antes["plantillas"].append({"id": str(row["id"]), "codigo": codigo, "recursos": row.get("recursos"),
                                        "editado": row.get("editado")})
            escrito = escritura.plantilla(row, recursos, True)
            despues["plantillas"].append({"id": str(row["id"]), "codigo": codigo, **escrito})
        for nueva in plan["nuevas"]:
            creada = escritura.crear_plantilla({**nueva, "editado": True, "origen": f"correcciones:{lote['lote']}"})
            despues["plantillas_creadas"].append({"id": str(creada["id"]), "codigo": nueva["codigo"],
                                                  "recursos": creada.get("recursos", nueva["recursos"])})
        for p in plan["precios"]:
            cambio = p["cambio"]
            for entry, detalle in p.get("salteadas") or []:
                despues["salteados"].append({"codigo": cambio["codigo"], "id": str(entry["id"]), "detalle": detalle})
            if p["accion"] == "actualizar":
                for entry in p["entradas"]:
                    antes["precios"].append({"id": str(entry["id"]), "codigo": entry.get("codigo"),
                                             **{k: entry.get(k) for k in PRECIO_KEYS}})
                    guardada = escritura.precio(entry, p["datos"])
                    despues["precios"].append({"id": str(entry["id"]), "codigo": entry.get("codigo"),
                                               "historial_id": guardada["historial_id"],
                                               **{k: guardada.get(k) for k in PRECIO_KEYS}})
            elif p["accion"] == "crear":
                creada = escritura.crear_precio({
                    "catalog_id": str(p["catalogo"]["id"]),
                    "codigo": cambio["codigo"],
                    "descripcion": cambio["descripcion"],
                    "unidad": cambio["unidad"],
                    "tipo": cambio["tipo_recurso"],
                    **p["datos"],
                })
                despues["precios_creados"].append({"id": str(creada["id"]), "codigo": cambio["codigo"],
                                                   "historial_id": creada["historial_id"],
                                                   **{k: creada.get(k) for k in PRECIO_KEYS}})
        registro = escritura.registro({
            "lote": lote["lote"],
            "correccion_id": correccion_id,
            "estado": "aplicada",
            "aplicada_por": user.get("email") or user.get("user_id"),
            "aplicada_at": _ahora(),
            "antes": antes,
            "despues": despues,
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise _fallar(exc, escritura, f"Aplicar la corrección {correccion_id}", NO_SE_APLICO, A_MEDIAS) from exc

    _, vista = _estado(db, org_id, lote, correccion, [registro])
    return {**vista, "aviso": AVISO_PRESUPUESTOS}


# ── Deshacer ─────────────────────────────────────────────────────────────────


def _diferencia(codigo: str, escritos: list[dict], actuales: list[dict]) -> str:
    """What changed in a formula since the correction wrote it, in words."""
    por_codigo = {str(r.get("codigo")): r for r in actuales}
    for r in escritos:
        actual = por_codigo.get(str(r.get("codigo")))
        if actual is None:
            return f"La fórmula {codigo} se editó después de aplicar la corrección: ya no tiene el renglón {r.get('codigo')}."
        for k, v in r.items():
            if not corr.mismo(actual.get(k), v):
                return (f"La fórmula {codigo} se editó después de aplicar la corrección: en el renglón "
                        f"{r.get('codigo')}, {corr._campo(k)} era {corr._valor(v)} y ahora es "
                        f"{corr._valor(actual.get(k))}.")
    return f"La fórmula {codigo} se editó después de aplicar la corrección."


@router.post("/{correccion_id}/deshacer")
async def deshacer_correccion(correccion_id: str, user: dict = Depends(require_editor)):
    """Put back what the correction changed, if nobody edited it afterwards (409 otherwise)."""
    lote, aviso = _lote()
    if lote is None:
        raise HTTPException(409, aviso)
    correccion = _correccion(lote, correccion_id)
    db = get_data_db()
    org_id = user["org_id"]

    registros = _registros(db, org_id, lote["lote"], estricto=True)
    registro = _activo(registros, correccion_id)
    if registro is None:
        raise HTTPException(409, f"La corrección {correccion_id} no está aplicada desde la app: no hay nada para deshacer")
    antes, despues = registro.get("antes") or {}, registro.get("despues") or {}

    # 1. Nothing the correction wrote may have changed since
    conflictos: list[str] = []
    actuales = {str(r["id"]): r for r in fetch_all(
        lambda: db.table("item_templates").select("*").eq("org_id", org_id).order("id"))}
    for p in despues.get("plantillas") or []:
        actual = actuales.get(p["id"])
        if actual is None:
            conflictos.append(f"La fórmula {p['codigo']} ya no existe.")
        elif not corr.iguales(corr.lista_recursos(actual.get("recursos")), corr.lista_recursos(p["recursos"])):
            conflictos.append(_diferencia(p["codigo"], corr.lista_recursos(p["recursos"]),
                                          corr.lista_recursos(actual.get("recursos"))))
    creadas = []
    for p in despues.get("plantillas_creadas") or []:
        actual = actuales.get(p["id"])
        if actual is None:
            continue  # already deleted by hand
        if not corr.iguales(corr.lista_recursos(actual.get("recursos")), corr.lista_recursos(p["recursos"])):
            conflictos.append(_diferencia(p["codigo"], corr.lista_recursos(p["recursos"]),
                                          corr.lista_recursos(actual.get("recursos"))))
            continue
        usos = db.table("budget_items").select("id").eq("org_id", org_id).eq("template_id", p["id"]).execute().data
        if usos:
            conflictos.append(f"La fórmula {p['codigo']} la usan {len(usos)} trabajos de presupuestos: no se puede "
                              "borrar. Cambiales la fórmula y volvé a deshacer.")
            continue
        creadas.append(actual)
    entradas_ids = [p["id"] for p in (despues.get("precios") or []) + (despues.get("precios_creados") or [])]
    entradas = {str(e["id"]): e for e in (
        db.table("catalog_entries").select("*").eq("org_id", org_id).in_("id", entradas_ids).execute().data or []
    )} if entradas_ids else {}
    for p in (despues.get("precios") or []) + (despues.get("precios_creados") or []):
        actual = entradas.get(p["id"])
        if actual is None:
            continue
        if not (corr.mismo(actual.get("precio_sin_iva"), p.get("precio_sin_iva"))
                and corr.mismo(actual.get("fecha_precio"), p.get("fecha_precio"))):
            conflictos.append(f"El precio de {p['codigo']} cambió después de aplicar la corrección "
                              f"(ahora es ${actual.get('precio_sin_iva')} del {corr.fecha_corta(actual.get('fecha_precio'))}).")
    if conflictos:
        raise HTTPException(409, {"codigo": "CAMBIO_DESPUES", "mensaje": "No se deshizo: " + " ".join(conflictos)})

    # 2. Put everything back, all or nothing
    escritura = _Escritura(db, org_id)
    try:
        for p in antes.get("plantillas") or []:
            actual = actuales[p["id"]]
            escritura.plantilla(actual, p["recursos"], p.get("editado") if p.get("editado") is not None else False)
        for actual in creadas:
            escritura.borrar_plantilla(actual)
            copia = {k: v for k, v in actual.items()}
            escritura.inversas.append(lambda copia=copia: db.table("item_templates").insert(copia).execute())
        for p in antes.get("precios") or []:
            actual = entradas.get(p["id"])
            if actual is None:
                continue
            escritura.precio(actual, {k: p.get(k) for k in PRECIO_KEYS}, historial=False)
        for p in despues.get("precios") or []:
            if p.get("historial_id") and p["id"] in entradas:
                hist = db.table("catalog_price_history").select("*").eq("id", p["historial_id"]).eq(
                    "org_id", org_id).execute().data or []
                escritura._borrar_historial(p["historial_id"])
                for h in hist:
                    escritura.inversas.append(lambda h=h: db.table("catalog_price_history").insert(h).execute())
        for p in despues.get("precios_creados") or []:
            actual = entradas.get(p["id"])
            if actual is None:
                continue
            hist = db.table("catalog_price_history").select("*").eq("entry_id", p["id"]).eq(
                "org_id", org_id).execute().data or []
            escritura.borrar_precio(p["id"])
            escritura.inversas.append(lambda actual=actual, hist=hist: (
                db.table("catalog_entries").insert(actual).execute(),
                hist and db.table("catalog_price_history").insert(hist).execute(),
            ))
        escritura.marcar(registro, {"estado": "deshecha", "deshecha_at": _ahora()})
    except HTTPException:
        raise
    except Exception as exc:
        raise _fallar(exc, escritura, f"Deshacer la corrección {correccion_id}", NO_SE_DESHIZO,
                      A_MEDIAS_DESHACER) from exc

    _, vista = _estado(db, org_id, lote, correccion, [])
    return vista
