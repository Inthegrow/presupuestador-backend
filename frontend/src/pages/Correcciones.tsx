import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet,
  Info, Library, MessageCircleQuestion, RefreshCw, RotateCcw, TrendingDown, TrendingUp, Wand2, X,
} from 'lucide-react'
import { ApiError, correccionesApi, mensajeDeError } from '../lib/api'
import type { Correccion, CorreccionCambio, LoteCorrecciones } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { fmtPesos, unidadEnPalabras } from '../lib/format'
import { dominio, fechaCorta, fmtEfecto, partesConLinks, urlSegura } from '../lib/origen'
import { conTildes } from '../lib/textos'
import type { TemplateResource } from '../types'

// ─── Palabras ──────────────────────────────────────────────────────────────────

/** "2026-10-07T13:20:00Z" → "7/10" (lo de hoy no necesita el año) */
function diaMes(value: string | null | undefined): string {
  const f = fechaCorta(value)
  return f ? f.replace(/\/\d{4}$/, '') : ''
}

/** Quién la aplicó, como se lee: "carlos@terrac.com" → "Carlos"; un id suelto no se muestra. */
function quien(por: string | null | undefined): string {
  const p = (por ?? '').trim()
  if (!p || /^[0-9a-f-]{20,}$/i.test(p)) return ''
  const nombre = p.includes('@') ? p.split('@')[0].split(/[._-]/)[0] : p
  return nombre.charAt(0).toUpperCase() + nombre.slice(1)
}

const CAMPO: Record<string, string> = {
  formula: 'Cantidad',
  codigo: 'Código',
  descripcion: 'Descripción',
  unidad: 'Unidad',
  desperdicio_pct: 'Desperdicio %',
  rendimiento: 'Rendimiento por día',
  trabajadores: 'Trabajadores',
  cargas_sociales_pct: 'Cargas sociales %',
  unidad_compra: 'Unidad de compra',
  redondear: 'Redondea',
  lo_compra_cliente: 'Lo compra el cliente',
  cantidad_por_unidad: 'Cantidad por unidad',
  precio_sin_iva: 'Precio sin IVA',
  proveedor: 'Proveedor',
  fecha_precio: 'Fecha del precio',
  tipo: 'Tipo',
}

const TIPO_RECURSO: Record<string, string> = {
  material: 'material',
  mano_obra: 'mano de obra',
  equipo: 'equipo',
  mo_material: 'material indirecto',
  subcontrato: 'subcontrato',
}

function valor(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'vacío'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (campo === 'precio_sin_iva' && typeof v === 'number') return fmtPesos(v)
  if (campo === 'fecha_precio' && typeof v === 'string') return fechaCorta(v)
  if (campo === 'tipo' && typeof v === 'string') return TIPO_RECURSO[v] ?? v
  if (typeof v === 'number') return v.toLocaleString('es-AR', { maximumFractionDigits: 4 })
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Cuánto lleva un renglón de fórmula, en una línea: "Q/10 rollo" o "2 trabajadores · días = Q / 25". */
function cantidadDe(r: TemplateResource): string {
  if (r.tipo === 'mano_obra') {
    if (r.rendimiento !== undefined && r.rendimiento !== '') return `${r.trabajadores ?? 1} trabajadores · días = Q / ${r.rendimiento}`
    return `${r.trabajadores_por_unidad ?? '—'} trabajadores × ${r.dias_por_unidad ?? '—'} días por unidad`
  }
  const f = r.formula ?? (r.cantidad_por_unidad !== undefined ? `Q * ${r.cantidad_por_unidad}` : '')
  return [f, r.unidad].filter(Boolean).join(' ')
}

/** "COLOCACION DE ROLLO DE MEMBRANA" → "Colocación de rollo de membrana" (los nombres del Maestro van en mayúsculas). */
function enPalabras(texto: string | null | undefined): string {
  const t = (texto ?? '').trim()
  const mayus = t.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length
  const minus = t.replace(/[^a-záéíóúñ]/g, '').length
  const base = mayus > minus ? t.charAt(0) + t.slice(1).toLowerCase() : t
  return conTildes(base)
}

function nombreFormula(c: CorreccionCambio): string {
  const cod = typeof c.plantilla === 'string' ? c.plantilla : c.plantilla?.codigo ?? ''
  const nombre = enPalabras(c.nombre_plantilla ?? (typeof c.plantilla === 'object' ? c.plantilla?.nombre : null) ?? '')
  if (cod && nombre && !nombre.startsWith(cod)) return `Fórmula ${cod} · ${nombre}`
  return nombre ? `Fórmula ${nombre}` : cod ? `Fórmula ${cod}` : 'Fórmula'
}

function nombreRecurso(c: CorreccionCambio): string {
  const r = c.renglon ?? (c.antes as TemplateResource | null | undefined) ?? null
  const cod = c.codigo ?? r?.codigo ?? ''
  const nombre = enPalabras(c.nombre_recurso ?? r?.descripcion ?? c.descripcion ?? '')
  return [cod, nombre].filter(Boolean).join(' · ') || 'Renglón'
}

// Estado de cada cambio (lo dice el servidor): solo se marcan los que no van a pasar tal cual
const ESTADO_CAMBIO: Record<string, { texto: string; clase: string; aviso: boolean }> = {
  no_coincide: { texto: 'No coincide', clase: 'bg-amber-100 text-amber-800', aviso: true },
  se_saltea: { texto: 'Se saltea', clase: 'bg-gray-200 text-gray-700', aviso: true },
  salteado: { texto: 'Salteado', clase: 'bg-gray-200 text-gray-700', aviso: true },
  ya_esta: { texto: 'Ya está', clase: 'bg-[#E8F5EE] text-[#1B5E4B]', aviso: false },
  aplicado: { texto: 'Aplicado', clase: 'bg-[#E8F5EE] text-[#1B5E4B]', aviso: false },
}

// ─── Estado de cada corrección en la pantalla ──────────────────────────────────

type Accion =
  | { tipo: 'nada' }
  | { tipo: 'aplicando' }
  | { tipo: 'deshaciendo' }
  | { tipo: 'listo'; texto: string }
  | { tipo: 'error'; titulo: string; mensaje: string; aMedias: boolean }

const sePuedeAplicar = (c: Correccion) => !c.aplicada && (c.estado === 'para_aplicar' || c.estado === 'en_parte')
// Aplicada desde la app (se puede deshacer) o ya corregida por otro lado (nada para hacer)
const estaAplicada = (c: Correccion) => !!c.aplicada || c.estado === 'aplicada'
const noCoincide = (c: Correccion) => !c.aplicada && c.estado === 'no_coincide'
/** El servidor ya empieza con "No coincide:"; la pantalla lo dice en negrita, así que se saca. */
const sinPrefijo = (t: string) => t.replace(/^\s*No coincide:\s*/i, '')

type Filtro = 'todas' | 'para_aplicar' | 'aplicadas' | 'no_coinciden'

function errorDeAccion(err: unknown, que: 'aplicar' | 'deshacer'): Accion {
  const d = err instanceof ApiError ? (err.detail as { codigo?: unknown } | null) : null
  const codigo = d && typeof d === 'object' ? d.codigo : null
  const porDefecto = que === 'aplicar' ? 'No se pudo aplicar. Probá de nuevo.' : 'No se pudo deshacer. Probá de nuevo.'
  // 422: la lista de lo que la validación de fórmulas no acepta
  const mensaje = err instanceof ApiError && Array.isArray(err.detail)
    ? (err.detail as unknown[]).map((d) => (typeof d === 'string' ? d : (d as { msg?: string })?.msg ?? '')).filter(Boolean).join('\n') || porDefecto
    : mensajeDeError(err, porDefecto)
  if (codigo === 'A_MEDIAS') return { tipo: 'error', titulo: 'Quedó a medias', mensaje, aMedias: true }
  if (codigo === 'NO_SE_APLICO') return { tipo: 'error', titulo: 'No se aplicó: quedó todo como estaba', mensaje, aMedias: false }
  return { tipo: 'error', titulo: que === 'aplicar' ? 'No se pudo aplicar' : 'No se pudo deshacer', mensaje, aMedias: false }
}

// ─── Página ────────────────────────────────────────────────────────────────────

export default function Correcciones() {
  const { puedeEditar } = useAuth()
  const [lote, setLote] = useState<LoteCorrecciones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noHay, setNoHay] = useState(false)
  const [acciones, setAcciones] = useState<Record<string, Accion>>({})
  const [filtro, setFiltro] = useState<Filtro>('todas')
  // "Aplicar todas": confirmación en la página, avance y resultado
  const [confirmarTodas, setConfirmarTodas] = useState(false)
  const [todas, setTodas] = useState<{ hechas: number; total: number; actual: string } | null>(null)
  const [resultadoTodas, setResultadoTodas] = useState<{ ok: number; mal: number } | null>(null)

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    setError(null)
    try {
      const data = await correccionesApi.listar()
      setLote(data)
      setNoHay(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNoHay(true)
      else if (!silencioso) setError(mensajeDeError(err, 'No pude traer las correcciones.'))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const lista = useMemo(() => lote?.correcciones ?? [], [lote])
  const resumen = useMemo(() => ({
    aplicadas: lista.filter(estaAplicada).length,
    paraAplicar: lista.filter(sePuedeAplicar).length,
    noCoinciden: lista.filter(noCoincide).length,
  }), [lista])
  const visibles = lista.filter((c) =>
    filtro === 'todas' ? true
      : filtro === 'para_aplicar' ? sePuedeAplicar(c)
        : filtro === 'aplicadas' ? estaAplicada(c)
          : noCoincide(c),
  )

  const setAccion = (id: string, a: Accion) => setAcciones((prev) => ({ ...prev, [id]: a }))

  async function aplicar(c: Correccion): Promise<boolean> {
    setAccion(c.id, { tipo: 'aplicando' })
    try {
      await correccionesApi.aplicar(c.id)
      setAccion(c.id, { tipo: 'listo', texto: 'Aplicada.' })
      return true
    } catch (err) {
      setAccion(c.id, errorDeAccion(err, 'aplicar'))
      return false
    }
  }

  async function deshacer(c: Correccion) {
    setAccion(c.id, { tipo: 'deshaciendo' })
    try {
      await correccionesApi.deshacer(c.id)
      setAccion(c.id, { tipo: 'listo', texto: 'Deshecha: la fórmula quedó como antes.' })
    } catch (err) {
      setAccion(c.id, errorDeAccion(err, 'deshacer'))
    }
    await cargar(true)
  }

  async function aplicarUna(c: Correccion) {
    setResultadoTodas(null)
    await aplicar(c)
    await cargar(true)
  }

  async function aplicarTodas() {
    const pendientes = lista.filter(sePuedeAplicar)
    setConfirmarTodas(false)
    setResultadoTodas(null)
    let ok = 0
    for (let i = 0; i < pendientes.length; i++) {
      setTodas({ hechas: i, total: pendientes.length, actual: pendientes[i].titulo })
      if (await aplicar(pendientes[i])) ok++
    }
    await cargar(true)
    setTodas(null)
    setResultadoTodas({ ok, mal: pendientes.length - ok })
  }

  const ocupado = todas !== null || Object.values(acciones).some((a) => a.tipo === 'aplicando' || a.tipo === 'deshaciendo')

  return (
    <div className="px-3 sm:px-6 pb-8 pt-5 fade-in">
      <div className="max-w-3xl">
        <Link
          to="/app/templates"
          className="inline-flex items-center gap-1 text-xs text-[#2D8D68] hover:text-[#1B5E4B] font-medium mb-2"
        >
          <ArrowLeft size={13} /> Volver a Fórmulas
        </Link>
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <Library size={14} /> FÓRMULAS · CORRECCIONES
        </div>
        <div className="flex items-start gap-3 mb-1 min-w-0">
          <div className="w-1 h-7 bg-[#2D8D68] rounded-full flex-shrink-0" />
          <h1 className="text-xl font-extrabold text-gray-900 min-w-0 [overflow-wrap:anywhere]">
            {(lote?.titulo ?? 'Revisión de Ginkgo').toUpperCase()}
          </h1>
        </div>
        <p className="text-sm text-gray-500 pl-4 mb-4">
          Lo que encontró la revisión de Ginkgo en las fórmulas, listo para aplicar con un botón. Cada corrección se puede
          deshacer. Las respuestas que faltaban las supuso Claude: están marcadas y quedan a confirmar.
        </p>

        {cargando && (
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Cargando las correcciones…
          </div>
        )}

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
            <p className="font-semibold mb-1">No pude traer las correcciones</p>
            <p className="text-xs [overflow-wrap:anywhere]">{error}</p>
            <button
              onClick={() => void cargar()}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100"
            >
              <RefreshCw size={12} /> Probar de nuevo
            </button>
          </div>
        )}

        {noHay && !cargando && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-500">
            <Library size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium text-gray-700">No hay correcciones para revisar.</p>
          </div>
        )}

        {lote?.aviso && !cargando && (
          <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm text-amber-900">
            <p className="font-semibold mb-1">No se pueden mostrar las correcciones</p>
            <p className="text-xs [overflow-wrap:anywhere]">{lote.aviso}</p>
          </div>
        )}

        {lote && !lote.aviso && !cargando && (
          <>
            {/* Resumen */}
            <section aria-label="Resumen" data-testid="resumen-correcciones" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-3">
              <div className="grid grid-cols-3 gap-2">
                <Cifra n={resumen.aplicadas} texto={resumen.aplicadas === 1 ? 'aplicada' : 'aplicadas'} clase="bg-[#E8F5EE] text-[#143D34] border-[#2D8D68]/25" testId="cifra-aplicadas" />
                <Cifra n={resumen.paraAplicar} texto="para aplicar" clase="bg-gray-50 text-gray-900 border-gray-200" testId="cifra-para-aplicar" />
                <Cifra n={resumen.noCoinciden} texto={resumen.noCoinciden === 1 ? 'no coincide' : 'no coinciden'} clase="bg-amber-50 text-amber-900 border-amber-200" testId="cifra-no-coinciden" />
              </div>

              {puedeEditar && resumen.paraAplicar > 0 && !confirmarTodas && !todas && (
                <button
                  onClick={() => { setConfirmarTodas(true); setResultadoTodas(null) }}
                  disabled={ocupado}
                  className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm transition-colors"
                >
                  <Wand2 size={15} /> Aplicar todas las que se pueden ({resumen.paraAplicar})
                </button>
              )}

              {confirmarTodas && (
                <div role="alertdialog" aria-labelledby="confirmar-todas-titulo" data-testid="confirmar-todas" className="mt-3 rounded-xl border-2 border-[#2D8D68] bg-[#F3FAF6] p-3">
                  <p id="confirmar-todas-titulo" className="text-sm font-semibold text-[#143D34]">
                    ¿Aplicar {resumen.paraAplicar === 1 ? 'la corrección que se puede' : `las ${resumen.paraAplicar} correcciones que se pueden`}?
                  </p>
                  <p className="text-xs text-[#1B5E4B] mt-1">
                    Cambian las fórmulas de la empresa. Cada una se puede deshacer después.
                    {resumen.noCoinciden > 0 && ` Las que no coinciden (${resumen.noCoinciden}) quedan como están.`}
                    {' '}Los presupuestos ya cargados no cambian solos.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => void aplicarTodas()}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white text-sm font-semibold px-4 py-2 rounded-xl"
                    >
                      Sí, aplicar {resumen.paraAplicar === 1 ? 'la corrección' : `las ${resumen.paraAplicar}`}
                    </button>
                    <button
                      onClick={() => setConfirmarTodas(false)}
                      className="flex-1 sm:flex-none bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-xl"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {todas && (
                <div role="status" data-testid="aplicando-todas" className="mt-3 rounded-xl border border-[#C3E5D3] bg-[#F3FAF6] p-3">
                  <p className="text-sm text-[#143D34] flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin flex-shrink-0" aria-hidden />
                    Aplicando {todas.hechas + 1} de {todas.total}…
                  </p>
                  <p className="text-xs text-[#1B5E4B] mt-1 truncate">{todas.actual}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden">
                    <div className="h-full bg-[#2D8D68] transition-all" style={{ width: `${(todas.hechas / todas.total) * 100}%` }} />
                  </div>
                </div>
              )}

              {resultadoTodas && (
                <div
                  role="status"
                  data-testid="resultado-todas"
                  className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${
                    resultadoTodas.mal ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-[#E8F5EE] text-[#143D34]'
                  }`}
                >
                  {resultadoTodas.mal
                    ? <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
                    : <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-[#2D8D68]" />}
                  <span className="flex-1">
                    {resultadoTodas.ok === 1 ? 'Se aplicó 1 corrección.' : `Se aplicaron ${resultadoTodas.ok} correcciones.`}
                    {resultadoTodas.mal > 0 && ` ${resultadoTodas.mal === 1 ? '1 no se pudo aplicar' : `${resultadoTodas.mal} no se pudieron aplicar`}: el motivo está en su tarjeta.`}
                  </span>
                  <button onClick={() => setResultadoTodas(null)} aria-label="Cerrar" className="opacity-60 hover:opacity-100"><X size={14} /></button>
                </div>
              )}

              {!puedeEditar && (
                <p className="mt-3 text-xs text-gray-500">Tu usuario solo puede mirar: las correcciones las aplica quien edita.</p>
              )}
            </section>

            {/* Después de aplicar: los presupuestos cargados no cambian solos */}
            {resumen.aplicadas > 0 && (
              <div data-testid="aviso-volver-a-cargar" className="mb-3 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
                <Info size={15} className="flex-shrink-0 mt-px text-sky-600" />
                <p>
                  Los presupuestos ya cargados no cambian solos. Para ver el efecto en Ginkgo, volvé a cargar la obra en{' '}
                  <Link to="/app/cargar-obra" className="font-semibold underline underline-offset-2 hover:text-sky-700">Cargar obra</Link>.
                </p>
              </div>
            )}

            {/* Qué quiere decir el color de lo supuesto */}
            <p className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-violet-400 bg-violet-50 px-2 py-0.5 font-semibold text-violet-800">
                <MessageCircleQuestion size={11} /> Supuesto
              </span>
              es una respuesta que dio Claude porque no se pudo preguntar: no está confirmada.
            </p>

            {/* Filtros */}
            <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Mostrar">
              {([
                ['todas', `Todas (${lista.length})`],
                ['para_aplicar', `Para aplicar (${resumen.paraAplicar})`],
                ['aplicadas', `Aplicadas (${resumen.aplicadas})`],
                ['no_coinciden', `No coinciden (${resumen.noCoinciden})`],
              ] as [Filtro, string][]).map(([f, t]) => (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  aria-pressed={filtro === f}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    filtro === f ? 'bg-[#2D8D68] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-[#2D8D68] hover:text-[#2D8D68]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {visibles.length === 0 && (
                <p className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-500">No hay correcciones en este grupo.</p>
              )}
              {visibles.map((c) => (
                <TarjetaCorreccion
                  key={c.id}
                  c={c}
                  accion={acciones[c.id] ?? { tipo: 'nada' }}
                  puedeEditar={puedeEditar}
                  ocupado={ocupado}
                  onAplicar={() => void aplicarUna(c)}
                  onDeshacer={() => void deshacer(c)}
                  onCerrar={() => setAccion(c.id, { tipo: 'nada' })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Cifra({ n, texto, clase, testId }: { n: number; texto: string; clase: string; testId: string }) {
  return (
    <div className={`rounded-xl border px-2 py-2 text-center min-w-0 ${clase}`} data-testid={testId} data-valor={n}>
      <div className="text-xl font-extrabold tabular-nums leading-tight">{n}</div>
      <div className="text-[11px] font-medium leading-tight">{texto}</div>
    </div>
  )
}

// ─── Tarjeta ───────────────────────────────────────────────────────────────────

function TarjetaCorreccion({
  c, accion, puedeEditar, ocupado, onAplicar, onDeshacer, onCerrar,
}: {
  c: Correccion
  accion: Accion
  puedeEditar: boolean
  ocupado: boolean
  onAplicar: () => void
  onDeshacer: () => void
  onCerrar: () => void
}) {
  const [verCambios, setVerCambios] = useState(false)
  const aplicada = !!c.aplicada
  const yaEsta = !aplicada && c.estado === 'aplicada'
  const noCoin = noCoincide(c)
  const enParte = aplicada && c.estado === 'en_parte'
  const s = c.supuesto
  const porQuien = quien(c.aplicada?.por)
  const borde = aplicada || yaEsta ? 'border-l-[#2D8D68]' : noCoin ? 'border-l-amber-400' : 'border-l-gray-300'

  let estado: { texto: string; clase: string }
  if (aplicada) {
    estado = {
      texto: `${enParte ? 'Aplicada en parte' : 'Aplicada'}${c.aplicada?.fecha ? ` el ${diaMes(c.aplicada.fecha)}` : ''}${porQuien ? ` por ${porQuien}` : ''}`,
      clase: 'bg-[#E8F5EE] text-[#1B5E4B]',
    }
  } else if (yaEsta) {
    estado = { texto: 'Ya está corregida', clase: 'bg-[#E8F5EE] text-[#1B5E4B]' }
  } else if (noCoin) {
    estado = { texto: 'No coincide', clase: 'bg-amber-100 text-amber-800' }
  } else {
    estado = { texto: 'Para aplicar', clase: 'bg-gray-100 text-gray-700' }
  }

  return (
    <article
      data-testid="correccion"
      data-id={c.id}
      data-estado={aplicada ? 'aplicada' : yaEsta ? 'ya_esta' : c.estado}
      aria-labelledby={`corr-${c.id}`}
      className={`bg-white rounded-xl border border-gray-100 border-l-4 ${borde} shadow-sm p-3 sm:p-4`}
    >
      {/* Título y estado */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h2 id={`corr-${c.id}`} className="min-w-0 flex-1 basis-56 text-[15px] font-bold text-gray-900 [overflow-wrap:anywhere]">
          <span className="mr-1.5 text-xs font-semibold text-gray-400 tabular-nums">{c.id}</span>
          {c.titulo}
        </h2>
        <span data-testid="estado-correccion" className={`text-[11px] font-semibold rounded-full px-2 py-0.5 max-w-full ${estado.clase}`}>
          {(aplicada || yaEsta) && <CheckCircle2 size={11} className="inline -mt-px mr-1" />}
          {estado.texto}
        </span>
      </div>
      <p className="text-sm text-gray-600 mt-1 [overflow-wrap:anywhere]">{c.por_que}</p>

      {/* Respuesta supuesta: siempre a la vista, en su color, nunca como confirmada */}
      {s && (
        <div data-testid="supuesto" className="mt-3 rounded-lg border border-dashed border-violet-400 bg-violet-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <MessageCircleQuestion size={11} /> Supuesto por {s.por || 'Claude'} · a confirmar por {s.confirma || 'Emilia'}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-violet-950 [overflow-wrap:anywhere]">
            <span className="text-violet-800">
              Supuesto por {s.por || 'Claude'}{s.fecha ? ` el ${fechaCorta(s.fecha)}` : ''} · a confirmar por {s.confirma || 'Emilia'}:
            </span>{' '}
            <strong>{s.respuesta}</strong>.
            {s.razon && <> <span className="text-violet-800">Razón:</span> {s.razon}</>}
          </p>
        </div>
      )}

      {/* De dónde sale */}
      {c.fuentes?.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-400">De dónde sale</h3>
          <ul className="mt-1 space-y-0.5" data-testid="fuentes">
            {c.fuentes.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700 [overflow-wrap:anywhere]">
                <FileSpreadsheet size={12} className="flex-shrink-0 mt-[2px] text-gray-400" />
                <span className="min-w-0"><ConLinks texto={f} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Efecto en Ginkgo */}
      {typeof c.efecto_ginkgo === 'number' && c.efecto_ginkgo !== 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600" data-testid="efecto">
          {c.efecto_ginkgo < 0
            ? <TrendingDown size={14} className="text-[#2D8D68]" />
            : <TrendingUp size={14} className="text-rose-600" />}
          Efecto en Ginkgo, en costo directo:
          <strong className={`tabular-nums ${c.efecto_ginkgo < 0 ? 'text-[#1B5E4B]' : 'text-rose-700'}`}>{fmtEfecto(c.efecto_ginkgo)}</strong>
        </p>
      )}

      {/* No coincide / en parte: qué encontró */}
      {(noCoin || enParte || yaEsta) && c.detalle && (
        <div
          data-testid="detalle-estado"
          className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
            noCoin ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-gray-50 border border-gray-200 text-gray-700'
          }`}
        >
          {noCoin || enParte
            ? <AlertTriangle size={14} className={`flex-shrink-0 mt-px ${noCoin ? 'text-amber-600' : 'text-gray-500'}`} />
            : <Info size={14} className="flex-shrink-0 mt-px text-gray-500" />}
          <p className="min-w-0 [overflow-wrap:anywhere]">
            {noCoin && <strong>No coincide: </strong>}
            {noCoin ? sinPrefijo(c.detalle) : c.detalle}
          </p>
        </div>
      )}
      {noCoin && !c.detalle && (
        <p data-testid="detalle-estado" className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <strong>No coincide: la fórmula cambió desde la revisión.</strong> Mirá los cambios para ver qué renglón es.
        </p>
      )}

      {/* Ver los cambios */}
      {c.cambios?.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setVerCambios((v) => !v)}
            aria-expanded={verCambios}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2D8D68] hover:text-[#1B5E4B]"
          >
            {verCambios ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {verCambios ? 'Ocultar los cambios' : `Ver los cambios (${c.cambios.length})`}
          </button>
          {verCambios && (
            <ul className="mt-2 space-y-2 fade-in" data-testid="cambios">
              {c.cambios.map((cb, i) => <Cambio key={i} c={cb} />)}
            </ul>
          )}
        </div>
      )}

      {/* Botón y lo que pasó */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
        {puedeEditar && !aplicada && !yaEsta && !noCoin && (
          <button
            onClick={onAplicar}
            disabled={ocupado}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            {accion.tipo === 'aplicando'
              ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden /> Aplicando…</>
              : <><Wand2 size={15} /> Aplicar</>}
          </button>
        )}
        {puedeEditar && aplicada && (
          <button
            onClick={onDeshacer}
            disabled={ocupado}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            {accion.tipo === 'deshaciendo'
              ? <><span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" aria-hidden /> Deshaciendo…</>
              : <><RotateCcw size={15} /> Deshacer</>}
          </button>
        )}
        {noCoin && (
          <span className="text-xs text-gray-500">No se puede aplicar: así no se pisa una corrección hecha a mano.</span>
        )}
        <span aria-live="polite" className="text-xs text-[#1B5E4B]">
          {accion.tipo === 'listo' && (
            <span data-testid="accion-lista" className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-[#2D8D68]" /> {accion.texto}</span>
          )}
        </span>
      </div>

      {accion.tipo === 'error' && (
        <div role="alert" data-testid="error-correccion" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{accion.titulo}</p>
              <p className="mt-0.5 whitespace-pre-line [overflow-wrap:anywhere]">{accion.mensaje}</p>
              {accion.aMedias && puedeEditar && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={onAplicar} disabled={ocupado} className="inline-flex items-center gap-1 font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 disabled:opacity-50">
                    <RefreshCw size={12} /> Volver a aplicarla
                  </button>
                  <button onClick={onDeshacer} disabled={ocupado} className="inline-flex items-center gap-1 font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 disabled:opacity-50">
                    <RotateCcw size={12} /> Deshacerla
                  </button>
                </div>
              )}
            </div>
            <button onClick={onCerrar} aria-label="Cerrar" className="opacity-60 hover:opacity-100 flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

function ConLinks({ texto }: { texto: string }) {
  return (
    <>
      {partesConLinks(texto).map((p, i) =>
        'url' in p ? (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900"
          >
            {dominio(p.url)} <ExternalLink size={10} aria-hidden />
          </a>
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </>
  )
}

// ─── Un cambio, renglón por renglón ────────────────────────────────────────────

function AntesDespues({ campo, antes, despues }: { campo: string; antes: unknown; despues: unknown }) {
  const mono = campo === 'formula' || campo === 'codigo' || campo === 'rendimiento'
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs" data-testid="antes-despues">
      <span className="text-gray-500 font-medium">{CAMPO[campo] ?? campo}:</span>
      <span className={`rounded bg-rose-50 px-1 text-rose-800 line-through decoration-rose-300 [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>
        {valor(campo, antes)}
      </span>
      <ArrowRight size={12} className="text-gray-400 self-center" aria-hidden />
      <span className="sr-only">pasa a</span>
      <span className={`rounded bg-[#E8F5EE] px-1 font-semibold text-[#143D34] [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>
        {valor(campo, despues)}
      </span>
    </div>
  )
}

function Etiqueta({ children, clase }: { children: ReactNode; clase: string }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${clase}`}>{children}</span>
}

function Cambio({ c }: { c: CorreccionCambio }) {
  const est = c.estado_cambio ? ESTADO_CAMBIO[c.estado_cambio] : undefined
  let cuerpo: ReactNode = null
  let etiqueta: ReactNode = null
  let titulo = ''

  if (c.tipo === 'renglon') {
    etiqueta = <Etiqueta clase="bg-sky-50 text-sky-800">Cambia</Etiqueta>
    titulo = nombreRecurso(c)
    const antes = c.antes ?? {}
    const despues = c.despues ?? {}
    const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].filter((k) => k !== 'correccion')
    cuerpo = <div className="space-y-0.5">{campos.map((k) => <AntesDespues key={k} campo={k} antes={antes[k]} despues={despues[k]} />)}</div>
  } else if (c.tipo === 'renglon_nuevo') {
    etiqueta = <Etiqueta clase="bg-[#E8F5EE] text-[#1B5E4B]">Se agrega</Etiqueta>
    titulo = nombreRecurso(c)
    const r = c.renglon
    cuerpo = r ? (
      <p className="text-xs text-gray-700">
        <span className="text-gray-500 font-medium">Cantidad:</span> <span className="font-mono">{cantidadDe(r)}</span>
        {r.tipo && <span className="text-gray-400"> · {TIPO_RECURSO[r.tipo] ?? r.tipo}</span>}
      </p>
    ) : null
  } else if (c.tipo === 'renglon_quitar') {
    etiqueta = <Etiqueta clase="bg-rose-50 text-rose-800">Se quita</Etiqueta>
    titulo = nombreRecurso(c)
    const r = c.antes as TemplateResource | null | undefined
    cuerpo = r ? (
      <p className="text-xs text-gray-500">
        Hoy lleva <span className="font-mono line-through decoration-rose-300">{cantidadDe(r)}</span>
      </p>
    ) : null
  } else if (c.tipo === 'plantilla_nueva') {
    etiqueta = <Etiqueta clase="bg-[#E8F5EE] text-[#1B5E4B]">Fórmula nueva</Etiqueta>
    const p = typeof c.plantilla === 'object' && c.plantilla ? c.plantilla : null
    titulo = [p?.codigo, enPalabras(c.nombre_plantilla ?? p?.nombre)].filter(Boolean).join(' · ') || 'Fórmula nueva'
    cuerpo = p ? (
      <div className="text-xs text-gray-700">
        <p className="text-gray-500">
          Por {unidadEnPalabras(p.unidad)}{p.categoria ? ` · ${p.categoria}` : ''} · {(p.recursos ?? []).length} renglones
        </p>
        <ul className="mt-1 space-y-0.5">
          {(p.recursos ?? []).map((r, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              <span className="font-mono text-gray-500">{r.codigo}</span> {r.descripcion}: <span className="font-mono">{cantidadDe(r)}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null
  } else if (c.tipo === 'precio') {
    etiqueta = <Etiqueta clase="bg-amber-50 text-amber-800">Precio</Etiqueta>
    titulo = [c.codigo, enPalabras(c.descripcion)].filter(Boolean).join(' · ')
    const antes = c.antes ?? null
    const despues = c.despues ?? {}
    const url = urlSegura(c.url)
    cuerpo = (
      <div className="space-y-0.5">
        <AntesDespues
          campo="precio_sin_iva"
          antes={c.actual ? c.actual.precio_sin_iva : antes ? antes.precio_sin_iva : null}
          despues={despues.precio_sin_iva}
        />
        <p className="text-[11px] text-gray-500 [overflow-wrap:anywhere]">
          Por {unidadEnPalabras(c.unidad)}
          {c.tipo_recurso ? ` · ${TIPO_RECURSO[c.tipo_recurso] ?? c.tipo_recurso}` : ''}
          {despues.proveedor ? ` · ${String(despues.proveedor)}` : ''}
          {despues.fecha_precio ? ` · ${fechaCorta(String(despues.fecha_precio))}` : ''}
          {!antes && !c.actual && ' · todavía no está en la lista oficial'}
        </p>
        {(c.fuente || url) && (
          <p className="text-[11px] text-gray-500 [overflow-wrap:anywhere]">
            De dónde sale: {c.fuente}
            {url && (
              <>
                {' · '}
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-sky-700 underline underline-offset-2">
                  Ver <ExternalLink size={9} aria-hidden />
                </a>
              </>
            )}
          </p>
        )}
      </div>
    )
  } else {
    etiqueta = <Etiqueta clase="bg-gray-100 text-gray-700">Cambio</Etiqueta>
    titulo = nombreRecurso(c)
  }

  const formula = c.tipo !== 'precio' && c.tipo !== 'plantilla_nueva' ? nombreFormula(c) : ''

  return (
    <li
      data-testid="cambio"
      data-tipo={c.tipo}
      className={`rounded-lg border px-3 py-2 ${est?.aviso ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-gray-50/60'}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {etiqueta}
        {est && <Etiqueta clase={est.clase}>{est.texto}</Etiqueta>}
        <span className="text-xs font-semibold text-gray-800 min-w-0 [overflow-wrap:anywhere]">{titulo}</span>
      </div>
      {formula && <p className="text-[11px] text-gray-500 mt-0.5 [overflow-wrap:anywhere]">{formula}</p>}
      {cuerpo && <div className="mt-1">{cuerpo}</div>}
      {c.detalle && (
        <p className={`mt-1 text-[11px] [overflow-wrap:anywhere] ${est?.aviso ? 'text-amber-900' : 'text-gray-500'}`} data-testid="detalle-cambio">
          {c.estado_cambio === 'no_coincide' ? sinPrefijo(c.detalle) : c.detalle}
        </p>
      )}
    </li>
  )
}
