import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle, CheckCircle2, ExternalLink, Globe, Info, Pencil, RefreshCw, Search, Store, X,
} from 'lucide-react'
import { ApiError, catalogApi, mensajeDeError, preciosApi } from '../lib/api'
import type { OpcionPrecio, ResultadoBusquedaPrecio } from '../lib/api'
import { fmtPesos, todayIso, unidadEnPalabras } from '../lib/format'
import { dominio, fechaCorta, unidadNormal, urlSegura } from '../lib/origen'
import type { CatalogEntry, PriceCatalog } from '../types'

// ─── Ícono: lupa con globo ─────────────────────────────────────────────────────

export function IconoBuscarInternet({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`relative inline-flex flex-shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      <Globe size={size} />
      <span className="absolute -right-[3px] -bottom-[3px] rounded-full bg-white leading-none">
        <Search size={Math.max(8, Math.round(size * 0.62))} strokeWidth={3} />
      </span>
    </span>
  )
}

// ─── Dónde se guarda ───────────────────────────────────────────────────────────

/**
 * - 'entrada': un renglón que ya está en la lista (se actualiza).
 * - 'recurso': un recurso de un trabajo; se busca su código en las listas oficiales (si no está, se crea).
 * - 'nueva': un precio que todavía no está en la lista; Sol elige en qué lista oficial va.
 */
export type DestinoPrecio =
  | { modo: 'entrada'; catalogId: string; catalogo?: string; entrada: CatalogEntry }
  | { modo: 'recurso'; codigo: string; descripcion: string; unidad?: string | null; tipo?: string | null }
  | { modo: 'nueva'; descripcion?: string; unidad?: string | null; tipo?: string | null }

export interface PrecioGuardado {
  entrada: CatalogEntry
  catalogId: string
  catalogo: string
  nueva: boolean
  precio: number
  opcion: OpcionPrecio
  // El servidor no devolvió el origen: falta la migración 012 (el precio sí se guardó)
  sinOrigen: boolean
}

const TIPOS: { value: string; label: string }[] = [
  { value: 'material', label: 'Material' },
  { value: 'mano_obra', label: 'Mano de obra' },
  { value: 'equipo', label: 'Equipo' },
  { value: 'subcontrato', label: 'Subcontrato' },
]

const PALABRA_TIPO: Record<string, string> = {
  material: 'material',
  mo_material: 'material',
  mano_obra: 'mano',
  equipo: 'equipo',
  subcontrato: 'subcontrat',
}

/** La lista oficial que corresponde al tipo (la que lo dice en el nombre); si ninguna, la primera oficial. */
export function listaParaTipo(oficiales: PriceCatalog[], tipo?: string | null): PriceCatalog | null {
  if (oficiales.length === 0) return null
  const palabra = PALABRA_TIPO[tipo ?? 'material']
  return (palabra && oficiales.find((c) => c.name.toLowerCase().includes(palabra))) || oficiales[0]
}

export const normalizarCodigo = (c: string | null | undefined) => (c ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

/** Busca el código en las listas oficiales (primero en la que corresponde al tipo). */
async function buscarEnOficiales(
  oficiales: PriceCatalog[],
  codigo: string,
  tipo?: string | null,
): Promise<{ catalogo: PriceCatalog; entrada: CatalogEntry } | null> {
  const preferida = listaParaTipo(oficiales, tipo)
  const orden = preferida ? [preferida, ...oficiales.filter((c) => c.id !== preferida.id)] : oficiales
  const cod = normalizarCodigo(codigo)
  for (const c of orden) {
    const entradas = await catalogApi.getEntries(c.id)
    const e = entradas.find((x) => normalizarCodigo(x.codigo) === cod)
    if (e) return { catalogo: c, entrada: e }
  }
  return null
}

function numero(texto: string): number | null {
  const s = texto.trim().replace(/\./g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const enPesos = (n: number) => Math.round(n).toLocaleString('es-AR')

// ─── Estados de la búsqueda ────────────────────────────────────────────────────

type Busqueda =
  | { tipo: 'nada' }
  | { tipo: 'buscando' }
  // unidad: la unidad con la que se buscó; las cuentas de las opciones son por esa unidad
  | { tipo: 'resultados'; res: ResultadoBusquedaPrecio; opciones: OpcionPrecio[]; unidad: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'no_configurado'; mensaje: string }

// ─── Panel ─────────────────────────────────────────────────────────────────────

export default function BuscarPrecio({
  destino,
  onGuardado,
  onClose,
}: {
  destino: DestinoPrecio
  onGuardado: (g: PrecioGuardado) => void
  onClose: () => void
}) {
  const tituloId = useId()
  const inicial =
    destino.modo === 'entrada'
      ? { descripcion: destino.entrada.descripcion ?? '', unidad: destino.entrada.unidad ?? '', tipo: destino.entrada.tipo ?? 'material', codigo: destino.entrada.codigo ?? '' }
      : destino.modo === 'recurso'
        ? { descripcion: destino.descripcion, unidad: destino.unidad ?? '', tipo: destino.tipo ?? 'material', codigo: destino.codigo }
        : { descripcion: destino.descripcion ?? '', unidad: destino.unidad ?? '', tipo: destino.tipo ?? 'material', codigo: '' }

  const [descripcion, setDescripcion] = useState(inicial.descripcion)
  const [unidad, setUnidad] = useState(inicial.unidad)
  const [tipo, setTipo] = useState(inicial.tipo)
  const [codigo, setCodigo] = useState(inicial.codigo)
  const [busqueda, setBusqueda] = useState<Busqueda>({ tipo: 'nada' })
  const pedido = useRef(0)

  // Listas oficiales (para 'recurso' y 'nueva')
  const [oficiales, setOficiales] = useState<PriceCatalog[] | null>(null)
  const [listasError, setListasError] = useState<string | null>(null)
  const [listaId, setListaId] = useState('')
  // 'recurso': dónde está ese código (null = no está, se crea; undefined = todavía no se sabe)
  const [existente, setExistente] = useState<{ catalogo: PriceCatalog; entrada: CatalogEntry } | null | undefined>(undefined)

  // La unidad de lo que se actualiza (un renglón de la lista o el recurso) no se cambia: el precio tiene que ser por
  // esa unidad. Solo un precio nuevo deja elegir la unidad.
  const unidadFija: string | null =
    destino.modo === 'entrada'
      ? destino.entrada.unidad ?? ''
      : destino.modo === 'recurso'
        ? existente?.entrada.unidad || destino.unidad || ''
        : null
  useEffect(() => {
    if (unidadFija !== null) setUnidad(unidadFija)
  }, [unidadFija])

  // Opción elegida y guardado
  const [guardando, setGuardando] = useState<number | null>(null)
  const [guardarError, setGuardarError] = useState<{ i: number; mensaje: string } | null>(null)

  const buscarRef = useRef<HTMLInputElement>(null)
  useEffect(() => { buscarRef.current?.focus() }, [])

  // Esc cierra (salvo mientras guarda)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && guardando === null) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guardando, onClose])

  const cargarListas = useMemo(() => async () => {
    if (destino.modo === 'entrada') return
    setListasError(null)
    try {
      const todas = await catalogApi.list()
      const ofs = (Array.isArray(todas) ? todas : []).filter((c) => c.oficial)
      setOficiales(ofs)
      setListaId((prev) => prev || listaParaTipo(ofs, inicial.tipo)?.id || '')
      if (destino.modo === 'recurso') {
        setExistente(ofs.length ? await buscarEnOficiales(ofs, destino.codigo, destino.tipo) : null)
      }
    } catch (err) {
      setListasError(mensajeDeError(err, 'No pude leer las listas de precios.'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { void cargarListas() }, [cargarListas])

  async function buscar(e?: FormEvent) {
    e?.preventDefault()
    if (!descripcion.trim()) return
    const req = ++pedido.current
    const unidadBuscada = unidad.trim()
    setBusqueda({ tipo: 'buscando' })
    setGuardarError(null)
    try {
      const res = await preciosApi.buscar({
        descripcion: descripcion.trim(),
        unidad: unidadBuscada || null,
        tipo: tipo || null,
        codigo: codigo.trim() || null,
      })
      if (req !== pedido.current) return
      // Nunca un precio sin link (el servidor ya las descarta; acá se vuelve a mirar)
      const opciones = (Array.isArray(res?.opciones) ? res.opciones : []).filter(
        (o) => urlSegura(o.url) && Number(o.precio) > 0,
      )
      setBusqueda({ tipo: 'resultados', res, opciones, unidad: unidadBuscada })
    } catch (err) {
      if (req !== pedido.current) return
      if (err instanceof ApiError && err.status === 503) {
        setBusqueda({ tipo: 'no_configurado', mensaje: mensajeDeError(err, 'El buscador de precios no está configurado.') })
      } else {
        setBusqueda({ tipo: 'error', mensaje: mensajeDeError(err, 'No pude buscar el precio. Probá de nuevo.') })
      }
    }
  }

  // ¿Dónde se guarda? (texto y si se puede)
  const lista = oficiales?.find((c) => c.id === listaId) ?? null
  const destinoTexto: { ok: boolean; texto: ReactNode; cargando?: boolean } = (() => {
    if (destino.modo === 'entrada') {
      return { ok: true, texto: <>Se actualiza <strong>{destino.entrada.codigo || destino.entrada.descripcion}</strong>{destino.catalogo ? <> en «{destino.catalogo}»</> : null}.</> }
    }
    if (listasError) return { ok: false, texto: <>{listasError}</> }
    if (oficiales === null || (destino.modo === 'recurso' && existente === undefined)) {
      return { ok: false, cargando: true, texto: <>Buscando dónde guardarlo…</> }
    }
    if (oficiales.length === 0) {
      return { ok: false, texto: <>No hay una lista oficial donde guardarlo. Marcá una como oficial en Lista de precios.</> }
    }
    if (destino.modo === 'recurso') {
      return existente
        ? { ok: true, texto: <>Se actualiza <strong>{destino.codigo}</strong> en «{existente.catalogo.name}» y este recurso toma el precio.</> }
        : { ok: true, texto: <><strong>{destino.codigo}</strong> no está en ninguna lista oficial: se agrega a «{lista?.name}» y este recurso toma el precio.</> }
    }
    return { ok: !!lista && !!descripcion.trim(), texto: <>Se agrega a la lista que elijas.</> }
  })()

  // Las opciones valen solo para la unidad con la que se buscó (y, si la unidad es fija, solo si es esa)
  const resultadosVigentes =
    busqueda.tipo === 'resultados' &&
    unidadNormal(busqueda.unidad) === unidadNormal(unidad) &&
    (unidadFija === null || unidadNormal(busqueda.unidad) === unidadNormal(unidadFija))

  async function usar(i: number, op: OpcionPrecio, precio: number) {
    if (busqueda.tipo !== 'resultados' || !resultadosVigentes) {
      setGuardarError({ i, mensaje: 'La unidad cambió después de buscar: buscá de nuevo para que la cuenta sea por esa unidad.' })
      return
    }
    if (!(precio > 0)) {
      setGuardarError({ i, mensaje: 'Poné un precio mayor que cero.' })
      return
    }
    setGuardando(i)
    setGuardarError(null)
    const datos = {
      precio_sin_iva: Math.round(precio * 100) / 100,
      proveedor: op.comercio,
      fecha_precio: todayIso(),
      fuente: `Internet: ${op.comercio} · ${op.producto}`,
      fuente_url: op.url,
    }
    try {
      let entrada: CatalogEntry
      let catalogId: string
      let catalogo: string
      let nueva = false
      if (destino.modo === 'entrada') {
        catalogId = destino.catalogId
        catalogo = destino.catalogo ?? ''
        entrada = await catalogApi.updateEntry(catalogId, destino.entrada.id, datos)
      } else if (destino.modo === 'recurso' && existente) {
        catalogId = existente.catalogo.id
        catalogo = existente.catalogo.name
        entrada = await catalogApi.updateEntry(catalogId, existente.entrada.id, datos)
      } else {
        if (!lista) throw new Error('Elegí en qué lista oficial va.')
        catalogId = lista.id
        catalogo = lista.name
        nueva = true
        entrada = await catalogApi.createEntry(catalogId, {
          codigo: destino.modo === 'recurso' ? destino.codigo : codigo.trim(),
          descripcion: destino.modo === 'recurso' ? destino.descripcion : descripcion.trim(),
          unidad: (destino.modo === 'recurso' ? destino.unidad : busqueda.unidad) || undefined,
          tipo: destino.modo === 'recurso' ? (destino.tipo === 'mo_material' ? 'material' : destino.tipo || 'material') : tipo,
          ...datos,
        })
      }
      onGuardado({
        entrada,
        catalogId,
        catalogo,
        nueva,
        precio: datos.precio_sin_iva,
        opcion: op,
        sinOrigen: !entrada?.fuente,
      })
    } catch (err) {
      setGuardarError({ i, mensaje: mensajeDeError(err, 'No se pudo guardar el precio. Probá de nuevo.') })
      setGuardando(null)
    }
  }

  const unidadApp = (busqueda.tipo === 'resultados' ? busqueda.unidad : unidad.trim()) || inicial.unidad
  const porUnidad = unidadEnPalabras(unidadApp)

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget && guardando === null) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        data-testid="buscar-precio"
        className="bg-white w-full sm:max-w-2xl sm:mx-4 sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-full sm:max-h-[92vh]"
      >
        {/* Cabecera */}
        <div className="bg-[#E8F5EE] px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 border-b border-[#C3E5D3] flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#143D34]">
              <IconoBuscarInternet size={16} className="text-[#2D8D68]" />
              <h2 id={tituloId} className="font-bold text-base">Buscar el precio en internet</h2>
            </div>
            <p className="text-[11px] text-[#1B5E4B] mt-0.5 [overflow-wrap:anywhere]">{destinoTexto.texto}</p>
          </div>
          <button
            onClick={onClose}
            disabled={guardando !== null}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg hover:bg-[#C3E5D3] text-[#2D8D68] flex-shrink-0 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4">
          {/* La búsqueda, armada y editable */}
          <form onSubmit={buscar} className="space-y-2" aria-label="La búsqueda">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
              <label className="text-[11px] font-medium text-gray-500 min-w-0">
                Qué buscar
                <input
                  ref={buscarRef}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Ej: cemento Loma Negra 50 kg"
                  className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
                />
              </label>
              <label className="text-[11px] font-medium text-gray-500 min-w-0">
                Unidad
                <input
                  value={unidad}
                  onChange={(e) => setUnidad(e.target.value)}
                  readOnly={unidadFija !== null}
                  aria-readonly={unidadFija !== null}
                  title={unidadFija !== null ? 'Es la unidad de la lista: el precio se guarda por esa unidad.' : undefined}
                  placeholder="bolsa"
                  className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20 read-only:bg-gray-50 read-only:text-gray-500"
                />
              </label>
            </div>

            {destino.modo === 'nueva' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="datos-precio-nuevo">
                <label className="text-[11px] font-medium text-gray-500 min-w-0">
                  Código (opcional)
                  <input
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="Ej: M-CEM50"
                    className="mt-0.5 w-full text-sm font-mono border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
                  />
                </label>
                <label className="text-[11px] font-medium text-gray-500 min-w-0">
                  Tipo
                  <select
                    value={tipo}
                    onChange={(e) => {
                      setTipo(e.target.value)
                      if (oficiales) setListaId(listaParaTipo(oficiales, e.target.value)?.id ?? '')
                    }}
                    className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#2D8D68]"
                  >
                    {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                <label className="col-span-2 sm:col-span-1 text-[11px] font-medium text-gray-500 min-w-0">
                  Va en la lista
                  <select
                    value={listaId}
                    onChange={(e) => setListaId(e.target.value)}
                    disabled={!oficiales || oficiales.length === 0}
                    className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#2D8D68] disabled:bg-gray-50"
                  >
                    {!oficiales && <option value="">Cargando…</option>}
                    {oficiales?.length === 0 && <option value="">Ninguna lista es oficial</option>}
                    {oficiales?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={!descripcion.trim() || busqueda.tipo === 'buscando'}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl shadow-sm transition-colors"
            >
              <Search size={15} /> {busqueda.tipo === 'resultados' || busqueda.tipo === 'error' ? 'Buscar de nuevo' : 'Buscar'}
            </button>
          </form>

          {!destinoTexto.ok && !destinoTexto.cargando && destino.modo !== 'nueva' && (
            <div role="alert" className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-px text-amber-600" />
              <span>{destinoTexto.texto} Podés buscar igual para ver los precios.</span>
            </div>
          )}
          {destino.modo === 'nueva' && oficiales?.length === 0 && (
            <div role="alert" className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-px text-amber-600" />
              <span>No hay una lista oficial donde guardarlo. Marcá una como oficial en Lista de precios. Podés buscar igual para ver los precios.</span>
            </div>
          )}

          {/* Buscando */}
          {busqueda.tipo === 'buscando' && (
            <div role="status" data-testid="buscando" className="flex items-center gap-3 rounded-xl border border-[#C3E5D3] bg-[#F3FAF6] px-4 py-4 text-sm text-[#143D34]">
              <div className="w-5 h-5 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span>Buscando en corralones y ferreterías… <span className="text-[#1B5E4B]/80">(puede tardar hasta un minuto)</span></span>
            </div>
          )}

          {/* No configurado */}
          {busqueda.tipo === 'no_configurado' && (
            <div role="alert" data-testid="buscador-no-configurado" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <div className="flex items-start gap-2">
                <Info size={16} className="flex-shrink-0 mt-0.5 text-gray-500" />
                <div className="min-w-0">
                  <p className="font-semibold">El buscador de precios no está configurado</p>
                  <p className="text-xs mt-1 text-gray-600">
                    Lo activa quien administra la app. Mientras tanto, podés cargar el precio a mano en la lista; el resto de la app funciona igual.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {busqueda.tipo === 'error' && (
            <div role="alert" data-testid="buscador-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">No pude buscar el precio</p>
                  <p className="mt-0.5 [overflow-wrap:anywhere]">{busqueda.mensaje}</p>
                  <button
                    onClick={() => void buscar()}
                    className="mt-2 inline-flex items-center gap-1 font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100"
                  >
                    <RefreshCw size={12} /> Probar de nuevo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* La unidad cambió después de buscar: las cuentas ya no valen */}
          {busqueda.tipo === 'resultados' && !resultadosVigentes && (
            <div role="status" data-testid="unidad-cambiada" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Cambiaste la unidad: los precios encontrados eran por {unidadEnPalabras(busqueda.unidad || inicial.unidad)}.</p>
              <p className="mt-1">Buscá de nuevo para ver las cuentas por {unidadEnPalabras(unidad.trim() || inicial.unidad)}.</p>
              <button
                onClick={() => void buscar()}
                className="mt-2 inline-flex items-center gap-1 font-semibold bg-white border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100"
              >
                <RefreshCw size={12} /> Buscar de nuevo
              </button>
            </div>
          )}

          {/* Resultados */}
          {busqueda.tipo === 'resultados' && resultadosVigentes && (
            <section aria-label="Precios encontrados" data-testid="resultados-precio" className="space-y-3">
              {busqueda.opciones.length === 0 ? (
                <div role="status" data-testid="sin-opciones" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">No encontré precios con su link para «{descripcion.trim()}».</p>
                  {busqueda.res.aviso && <p className="mt-0.5">{busqueda.res.aviso}</p>}
                  <p className="mt-1">Probá con otras palabras (la marca, la medida o cómo se vende) y buscá de nuevo.</p>
                  <button
                    onClick={() => void buscar()}
                    className="mt-2 inline-flex items-center gap-1 font-semibold bg-white border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100"
                  >
                    <RefreshCw size={12} /> Buscar de nuevo
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    {busqueda.opciones.length === 1 ? 'Encontré 1 precio' : `Encontré ${busqueda.opciones.length} precios`}
                    {' '}para «{descripcion.trim() || busqueda.res.consulta}». El de la app es por {porUnidad}, sin IVA.
                  </p>
                  {busqueda.res.aviso && !/venta al p[uú]blico/i.test(busqueda.res.aviso) && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{busqueda.res.aviso}</p>
                  )}
                  {busqueda.opciones.map((op, i) => (
                    <TarjetaOpcion
                      key={`${op.url}-${i}`}
                      op={op}
                      unidadApp={unidadApp}
                      puedeGuardar={destinoTexto.ok}
                      guardando={guardando === i}
                      bloqueado={guardando !== null && guardando !== i}
                      error={guardarError?.i === i ? guardarError.mensaje : null}
                      onUsar={(precio) => void usar(i, op, precio)}
                    />
                  ))}
                </>
              )}
              <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
                <Store size={12} className="flex-shrink-0 mt-px" />
                Precios de venta al público: un corralón por volumen suele ser más barato.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Una opción encontrada ─────────────────────────────────────────────────────

function TarjetaOpcion({
  op, unidadApp, puedeGuardar, guardando, bloqueado, error, onUsar,
}: {
  op: OpcionPrecio
  unidadApp: string
  puedeGuardar: boolean
  guardando: boolean
  bloqueado: boolean
  error: string | null
  onUsar: (precio: number) => void
}) {
  const calculado = op.precio_unidad_app_sin_iva ?? null
  // Si se publica en otra presentación que la unidad de la app, se marca y se deja corregir el número
  const publicada = (op.unidad_publicada ?? '').trim()
  const distinta = op.coincide_unidad === false
    || (op.coincide_unidad == null && !!publicada && !!unidadApp && unidadNormal(publicada) !== unidadNormal(unidadApp))
  const [corrigiendo, setCorrigiendo] = useState(distinta || calculado === null)
  const [texto, setTexto] = useState(calculado !== null ? enPesos(calculado) : '')
  const precio = corrigiendo ? numero(texto) : calculado
  const url = urlSegura(op.url)!
  const porUnidad = unidadEnPalabras(unidadApp)
  const inputId = useId()

  return (
    <article
      data-testid="opcion-precio"
      className="rounded-xl border border-gray-200 bg-white shadow-sm p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-sm font-bold text-gray-900 [overflow-wrap:anywhere]" data-testid="opcion-comercio">{op.comercio}</p>
          <p className="text-xs text-gray-700 [overflow-wrap:anywhere]">
            {op.producto}
            {op.presentacion && <span className="text-gray-500"> · {op.presentacion}</span>}
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="ver-en-el-sitio"
          className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 underline underline-offset-2 whitespace-nowrap"
        >
          Ver en el sitio <ExternalLink size={11} aria-hidden />
        </a>
      </div>

      <div className="mt-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-gray-600">
            Publicado: <strong className="text-gray-800 tabular-nums">{fmtPesos(op.precio)}</strong>{' '}
            <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${op.con_iva ? 'bg-gray-100 text-gray-700' : 'bg-[#E8F5EE] text-[#1B5E4B]'}`}>
              {op.con_iva ? 'con IVA' : 'sin IVA'}
            </span>
            {publicada && <span className="text-gray-500"> · por {publicada}</span>}
          </p>
          {op.cuenta && (
            <p className="text-[11px] text-gray-500 font-mono [overflow-wrap:anywhere]" data-testid="opcion-cuenta">{op.cuenta}</p>
          )}
          <p className="text-[11px] text-gray-400 [overflow-wrap:anywhere]">
            {op.fecha ? `Consultado el ${fechaCorta(op.fecha)} · ` : ''}{dominio(url)}
          </p>
        </div>
        <div className="rounded-lg bg-[#F3FAF6] border border-[#C3E5D3] px-3 py-2 text-right min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#1B5E4B]">Por {porUnidad}, sin IVA</div>
          <div className="text-lg font-extrabold text-[#143D34] tabular-nums" data-testid="opcion-precio-app">
            {calculado !== null ? fmtPesos(calculado) : '—'}
          </div>
        </div>
      </div>

      {distinta && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" data-testid="unidad-distinta">
          <AlertTriangle size={12} className="flex-shrink-0 mt-px text-amber-600" />
          <span>Se vende por {publicada || op.presentacion || 'otra presentación'} y la app usa {porUnidad}: revisá la cuenta y corregí el número si hace falta.</span>
        </p>
      )}

      {corrigiendo && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="text-[11px] font-medium text-gray-600">
            Precio por {porUnidad}, sin IVA
          </label>
          <div className="flex items-center gap-1 border border-gray-300 rounded-lg px-2 py-1 focus-within:border-[#2D8D68] focus-within:ring-2 focus-within:ring-[#2D8D68]/20 bg-white">
            <span className="text-xs text-gray-500">$</span>
            <input
              id={inputId}
              inputMode="decimal"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="w-28 text-sm text-right tabular-nums outline-none"
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => precio !== null && onUsar(precio)}
          disabled={!puedeGuardar || guardando || bloqueado || precio === null || !(precio > 0)}
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          {guardando ? (
            <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden /> Guardando…</>
          ) : (
            <><CheckCircle2 size={15} /> Usar este precio{corrigiendo && precio !== null && precio > 0 ? `: ${fmtPesos(precio)}` : ''}</>
          )}
        </button>
        {!corrigiendo && (
          <button
            onClick={() => setCorrigiendo(true)}
            disabled={guardando}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-[#1B5E4B] px-2 py-2"
          >
            <Pencil size={12} /> Corregir el número
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 [overflow-wrap:anywhere]">{error}</p>
      )}
    </article>
  )
}
