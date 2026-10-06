import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Lock, RefreshCw, Send, Table, X,
} from 'lucide-react'
import { ApiError, budgetApi, mensajeDeError } from '../lib/api'
import { escaleraDe, indirectosCompletos } from '../lib/cascada'
import { estadoEnTabla } from '../lib/semaforo'
import { fmtPesos } from '../lib/format'
import type { Budget, BudgetItem, IndirectConfig } from '../types'

// ─── Las cuatro opciones, en este orden ────────────────────────────────────────

type OpcionId = 'cliente' | 'terrac' | 'interno' | 'simple'

interface Opcion {
  id: OpcionId
  titulo: string
  formato: 'PDF' | 'Excel'
  ext: 'pdf' | 'xlsx'
  icono: ReactNode
  /** Para quién es */
  para: string
  /** Qué lleva */
  lleva: string
  /** Cómo se lo nombra en una frase ("No se pudo bajar el PDF para el cliente") */
  enFrase: string
  /** Una advertencia corta, si hace falta */
  ojo?: string
  destacada?: boolean
  bajar: (id: string) => Promise<Blob>
}

const OPCIONES: Opcion[] = [
  {
    id: 'cliente',
    titulo: 'Para el cliente',
    formato: 'PDF',
    ext: 'pdf',
    icono: <Send size={20} strokeWidth={1.75} />,
    para: 'Para mandarle al cliente',
    enFrase: 'el PDF para el cliente',
    lleva: 'Precio de venta de cada trabajo y el total, con y sin IVA. Sin tus costos.',
    destacada: true,
    bajar: (id) => budgetApi.exportPdf(id, 'cliente'),
  },
  {
    id: 'terrac',
    titulo: 'Planilla Terrac',
    formato: 'Excel',
    ext: 'xlsx',
    icono: <FileSpreadsheet size={20} strokeWidth={1.75} />,
    para: 'Para vos y tu equipo',
    enFrase: 'la Planilla Terrac',
    lleva:
      'Tu planilla de siempre: hoja 01_C&P, una hoja por trabajo con sus materiales y mano de obra, y el Coeficiente de pase. Si la volvés a subir en Cargar obra, vuelve con los mismos trabajos, cantidades y porcentajes; los trabajos con fórmula se calculan con los precios de ese día.',
    bajar: (id) => budgetApi.exportExcel(id, 'terrac'),
  },
  {
    id: 'interno',
    titulo: 'Informe interno',
    formato: 'PDF',
    ext: 'pdf',
    icono: <FileText size={20} strokeWidth={1.75} />,
    para: 'Solo para vos',
    enFrase: 'el Informe interno',
    lleva: 'Con costos, indirectos, beneficio e impuestos.',
    ojo: 'No se lo mandes al cliente: tiene tus costos.',
    bajar: (id) => budgetApi.exportPdf(id),
  },
  {
    id: 'simple',
    titulo: 'Planilla simple',
    formato: 'Excel',
    ext: 'xlsx',
    icono: <Table size={20} strokeWidth={1.75} />,
    para: 'Para hacer tus cuentas',
    enFrase: 'la Planilla simple',
    lleva: 'Un renglón por trabajo con su rubro y su precio. Para filtrar u ordenar, o pasarlo a otro sistema.',
    bajar: (id) => budgetApi.exportExcel(id),
  },
]

// ─── Nombres de archivo ────────────────────────────────────────────────────────

/** El nombre de la obra, sin los caracteres que Windows o Mac no aceptan en un nombre de archivo */
function nombreSeguro(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim()
  return limpio || 'Presupuesto'
}

/** AAAA-MM-DD de hoy, en la hora de la compu (no en la de Londres) */
function hoy(): string {
  const d = new Date()
  const dd = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`
}

function nombreArchivo(obra: string | null | undefined, op: Opcion): string {
  return `${nombreSeguro(obra)} - ${op.titulo} - ${hoy()}.${op.ext}`
}

function guardarArchivo(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Un rato después: si se libera enseguida, algunos navegadores cortan la descarga
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Qué pasó, dicho para Sol */
function mensajeDescarga(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'No encontré este presupuesto. Puede que lo hayan borrado o que sea de otra empresa.'
    if (err.status === 401 || err.status === 403) return 'Tu sesión se venció o no tenés permiso. Volvé a entrar y probá de nuevo.'
    return mensajeDeError(err, 'El servidor no pudo armar el archivo. Probá de nuevo en un rato; si sigue pasando, avisanos.')
  }
  return mensajeDeError(err, 'No se pudo bajar el archivo. Probá de nuevo.')
}

// ─── Estado de cada opción ─────────────────────────────────────────────────────

type Estado =
  | { tipo: 'nada' }
  | { tipo: 'bajando' }
  | { tipo: 'listo'; archivo: string }
  | { tipo: 'error'; mensaje: string }

type Faltantes = { porItem: Record<string, number>; recursosPorItem: Record<string, number>; ids: Set<string> }

export default function Export() {
  const { id } = useParams<{ id: string }>()
  const [budget, setBudget] = useState<Budget | null>(null)
  const [items, setItems] = useState<BudgetItem[] | null>(null)
  const [indirectos, setIndirectos] = useState<IndirectConfig | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorTotal, setErrorTotal] = useState<string | null>(null)
  // null = todavía no se sabe o la consulta falló (nunca "todo bien" sin saber)
  const [faltantes, setFaltantes] = useState<Faltantes | null>(null)
  const [faltantesFallo, setFaltantesFallo] = useState(false)
  const [estados, setEstados] = useState<Record<OpcionId, Estado>>({
    cliente: { tipo: 'nada' }, terrac: { tipo: 'nada' }, interno: { tipo: 'nada' }, simple: { tipo: 'nada' },
  })

  const cargar = useCallback(async () => {
    if (!id) return
    setCargando(true)
    setErrorTotal(null)
    setFaltantesFallo(false)
    budgetApi.get(id).then(setBudget).catch(() => {})
    budgetApi.getIndirects(id).then((c) => setIndirectos(c ?? null)).catch(() => setIndirectos(null))
    try {
      const its = await budgetApi.getItems(id)
      setItems(its)
      try {
        const r = await budgetApi.preciosFaltantesPorItem(id)
        const porItem = r && typeof r.por_item === 'object' && r.por_item !== null ? r.por_item : null
        const recursosPorItem = r && typeof r.recursos_por_item === 'object' && r.recursos_por_item !== null
          ? r.recursos_por_item : null
        if (porItem && recursosPorItem) setFaltantes({ porItem, recursosPorItem, ids: new Set(its.map((i) => i.id)) })
        else { setFaltantes(null); setFaltantesFallo(true) }
      } catch {
        setFaltantes(null)
        setFaltantesFallo(true)
      }
    } catch (err) {
      setItems(null)
      setErrorTotal(mensajeDeError(err, 'No pude leer los trabajos de este presupuesto.'))
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => { void cargar() }, [cargar])

  // Los mismos números que la escalera del editor: lo guardado en cada trabajo, sumado (los rubros no suman)
  const trabajos = useMemo(() => (items ?? []).filter((i) => i.notas !== 'Seccion'), [items])
  const ivaPct = indirectos ? indirectosCompletos(indirectos).iva_pct : null
  const escalera = useMemo(() => escaleraDe(trabajos, ivaPct), [trabajos, ivaPct])

  // Trabajos en rojo, con la misma regla que el punto de la tabla del editor
  const revision = useMemo(() => {
    if (!faltantes) return null
    const rojos: BudgetItem[] = []
    let sinDato = 0
    for (const t of trabajos) {
      const e = estadoEnTabla(t, faltantes)
      if (!e) sinDato++
      else if (e.estado === 'rojo') rojos.push(t)
    }
    return { rojos, sinDato }
  }, [faltantes, trabajos])

  const obra = budget?.name ?? null

  async function descargar(op: Opcion) {
    if (!id) return
    setEstados((s) => ({ ...s, [op.id]: { tipo: 'bajando' } }))
    try {
      const blob = await op.bajar(id)
      if (!blob || blob.size === 0) throw new Error('El archivo vino vacío. Probá de nuevo.')
      const archivo = nombreArchivo(obra, op)
      guardarArchivo(blob, archivo)
      setEstados((s) => ({ ...s, [op.id]: { tipo: 'listo', archivo } }))
    } catch (err) {
      setEstados((s) => ({ ...s, [op.id]: { tipo: 'error', mensaje: mensajeDescarga(err) } }))
    }
  }

  const cerrarError = (op: OpcionId) => setEstados((s) => ({ ...s, [op]: { tipo: 'nada' } }))

  return (
    <div className="px-3 py-5 sm:p-6 fade-in @container">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <Download size={14} /> EXPORTAR
        </div>
        <div className="flex items-start gap-3 mb-1 min-w-0">
          <div className="w-1 h-7 bg-[#2D8D68] rounded-full flex-shrink-0" />
          <h1 className="text-xl font-extrabold text-gray-900 min-w-0 [overflow-wrap:anywhere]" data-testid="export-obra">
            {obra ?? <span className="inline-block h-6 w-40 max-w-full rounded bg-gray-200 animate-pulse align-middle" aria-label="Cargando" />}
          </h1>
        </div>
        <p className="text-sm text-gray-500 mb-4 pl-4">Elegí qué archivo bajar. Todos llevan los mismos números que ves en el editor.</p>

        {/* El total que se va a exportar */}
        <section
          data-testid="export-cabecera"
          aria-label="Lo que se va a exportar"
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 @3xs:p-3 mb-4"
        >
          {cargando && !items ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-3 px-1">
              <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              Sumando el presupuesto…
            </div>
          ) : errorTotal ? (
            <div role="alert" className="flex flex-wrap items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">No pude leer el total</p>
                <p className="text-xs mt-0.5">{errorTotal} Igual podés bajar los archivos: los arma el servidor.</p>
              </div>
              <button
                onClick={() => void cargar()}
                className="text-xs font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100"
              >
                Probar de nuevo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 @lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-2">
              <div
                className="rounded-xl px-2.5 @3xs:px-3 py-2.5 min-w-0 bg-gradient-to-br from-[#2D8D68] to-[#1B5E4B] text-white shadow-sm"
                data-testid="export-precio-sin-iva"
                data-valor={escalera.neto}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">Precio sin IVA</div>
                <div className="font-extrabold text-[13px] tracking-tight @3xs:tracking-normal @3xs:text-base @md:text-xl tabular-nums mt-0.5 [overflow-wrap:anywhere]">{fmtPesos(escalera.neto)}</div>
              </div>
              <div
                className="rounded-xl px-2.5 @3xs:px-3 py-2.5 min-w-0 bg-[#E8F5EE] border border-[#2D8D68]/25"
                data-testid="export-precio-con-iva"
                data-valor={escalera.total_final ?? ''}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#1B5E4B]">Precio con IVA</div>
                <div className="font-extrabold text-[13px] tracking-tight @3xs:tracking-normal @3xs:text-base @md:text-xl text-[#143D34] tabular-nums mt-0.5 [overflow-wrap:anywhere]">
                  {escalera.total_final === null ? '—' : fmtPesos(escalera.total_final)}
                </div>
                {escalera.total_final === null && <div className="text-[10px] text-[#2D8D68] mt-0.5">Falta saber el % de IVA</div>}
              </div>
              <div className="rounded-xl px-2.5 @3xs:px-3 py-2.5 min-w-0 border border-gray-100 bg-gray-50" data-testid="export-trabajos" data-valor={trabajos.length}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Trabajos</div>
                <div className="font-extrabold text-[13px] tracking-tight @3xs:tracking-normal @3xs:text-base @md:text-xl text-gray-900 tabular-nums mt-0.5">{trabajos.length.toLocaleString('es-AR')}</div>
              </div>
            </div>
          )}

          {/* Precios que faltan: se avisa antes de exportar. Si no se pudo revisar, no se dice ni que falta ni que está todo bien */}
          {!errorTotal && revision && revision.rojos.length > 0 && (
            <AvisoRojos rojos={revision.rojos} budgetId={id ?? ''} />
          )}
          {!errorTotal && revision && revision.rojos.length === 0 && revision.sinDato === 0 && trabajos.length > 0 && (
            <p className="mt-2.5 px-1 flex items-center gap-1.5 text-xs text-[#1B5E4B]" data-testid="sin-faltantes">
              <CheckCircle2 size={14} className="text-[#2D8D68] flex-shrink-0" /> Todos los trabajos tienen sus precios.
            </p>
          )}
          {!errorTotal && !cargando && faltantesFallo && (
            <p className="mt-2.5 px-1 text-xs text-gray-500" data-testid="faltantes-sin-revisar">
              No pude revisar si faltan precios. Podés exportar igual.
            </p>
          )}
        </section>

        {/* Las cuatro opciones */}
        <h2 className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-2 px-1">¿Qué archivo necesitás?</h2>
        <div className="space-y-3">
          {OPCIONES.map((op) => (
            <TarjetaOpcion
              key={op.id}
              op={op}
              estado={estados[op.id]}
              onDescargar={() => void descargar(op)}
              onCerrarError={() => cerrarError(op.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function AvisoRojos({ rojos, budgetId }: { rojos: BudgetItem[]; budgetId: string }) {
  const n = rojos.length
  const corto = (t: string) => (t.length > 42 ? t.slice(0, 40).trimEnd() + '…' : t)
  const ejemplos = rojos.slice(0, 3).map((t) => [t.code, corto((t.description ?? '').trim())].filter(Boolean).join(' ') || 'Sin nombre')
  return (
    <div
      role="status"
      data-testid="aviso-faltantes"
      className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 @3xs:p-3 text-xs @3xs:text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {n === 1 ? 'Hay 1 trabajo con precios que faltan' : `Hay ${n} trabajos con precios que faltan`}: el total puede quedar corto.
          </p>
          <p className="hidden @md:block text-xs text-amber-800 mt-1 [overflow-wrap:anywhere]" data-testid="ejemplos-rojos">
            {ejemplos.join(' · ')}
            {n > 3 && ` y ${n - 3} más`}.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Se puede exportar igual. En el editor están marcados con un punto rojo.
          </p>
          <Link
            to={`/app/budgets/${budgetId}/editor`}
            data-testid="ver-cuales"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold bg-white border border-amber-300 text-amber-900 rounded-lg px-3 py-1.5 hover:bg-amber-100"
          >
            Ver cuáles
          </Link>
        </div>
      </div>
    </div>
  )
}

function TarjetaOpcion({
  op, estado, onDescargar, onCerrarError,
}: {
  op: Opcion
  estado: Estado
  onDescargar: () => void
  onCerrarError: () => void
}) {
  const bajando = estado.tipo === 'bajando'
  return (
    <article
      data-testid={`opcion-${op.id}`}
      aria-labelledby={`titulo-${op.id}`}
      className={`@container rounded-xl p-4 transition-shadow ${
        op.destacada
          ? 'bg-gradient-to-br from-[#F3FAF6] to-white border-2 border-[#2D8D68] shadow-sm'
          : 'bg-white border border-gray-100 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="flex flex-col @md:flex-row @md:items-center gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`hidden @2xs:flex w-10 h-10 rounded-xl items-center justify-center flex-shrink-0 ${
              op.destacada ? 'bg-[#2D8D68] text-white' : 'bg-[#E8F5EE] text-[#2D8D68]'
            }`}
            aria-hidden
          >
            {op.icono}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id={`titulo-${op.id}`} className="font-bold text-[15px] text-gray-900 [overflow-wrap:anywhere]">
                {op.titulo} <span className="sr-only">({op.formato})</span>
              </h3>
              <span
                aria-hidden
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  op.formato === 'PDF' ? 'bg-rose-50 text-rose-700' : 'bg-[#E8F5EE] text-[#1B5E4B]'
                }`}
              >
                {op.formato}
              </span>
            </div>
            <p className="text-[11px] font-semibold text-[#2D8D68] mt-0.5 flex items-center gap-1">
              {op.id === 'interno' && <Lock size={11} className="flex-shrink-0" />}
              {op.para}
            </p>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed [overflow-wrap:anywhere]">{op.lleva}</p>
            {op.ojo && <p className="text-xs text-amber-700 font-medium mt-1">{op.ojo}</p>}
          </div>
        </div>

        <button
          onClick={onDescargar}
          disabled={bajando}
          aria-label={`Descargar ${op.titulo} (${op.formato})`}
          className={`w-full @md:w-auto flex-shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-wait ${
            op.destacada
              ? 'bg-[#2D8D68] hover:bg-[#1B5E4B] text-white shadow-sm disabled:opacity-80'
              : 'bg-white border border-[#2D8D68]/40 text-[#1B5E4B] hover:bg-[#E8F5EE] disabled:opacity-70'
          }`}
        >
          {bajando ? (
            <>
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
              Descargando…
            </>
          ) : (
            <>
              <Download size={15} /> Descargar
            </>
          )}
        </button>
      </div>

      <div aria-live="polite">
        {estado.tipo === 'listo' && (
          <p
            data-testid="descargado"
            className="mt-3 flex items-start gap-1.5 text-xs text-[#1B5E4B] bg-[#E8F5EE] rounded-lg px-2.5 py-1.5"
          >
            <CheckCircle2 size={14} className="text-[#2D8D68] flex-shrink-0 mt-px" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">Descargado:</span> {estado.archivo}
            </span>
          </p>
        )}
      </div>
      {estado.tipo === 'error' && (
        <div
          role="alert"
          data-testid="error-descarga"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">No se pudo bajar {op.enFrase}</p>
              <p className="mt-0.5 [overflow-wrap:anywhere]">{estado.mensaje}</p>
              <button
                onClick={onDescargar}
                className="mt-2 inline-flex items-center gap-1 font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100"
              >
                <RefreshCw size={12} /> Probar de nuevo
              </button>
            </div>
            <button onClick={onCerrarError} aria-label="Cerrar" className="opacity-60 hover:opacity-100 flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
