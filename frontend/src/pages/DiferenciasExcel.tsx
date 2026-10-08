import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, GitCompare } from 'lucide-react'
import { obraApi, textoDeError } from '../lib/api'
import type { ObraDiferencias, ObraDiferenciaTrabajo } from '../lib/api'
import { fmtCurrency, fmtDate } from '../lib/format'
import { usePantalla } from '../lib/pantalla'

// The server's message, whole (quotes, accents and line breaks included): lib/api.ts mensajeDeTexto
const errorText = (e: unknown): string => textoDeError(e)

function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)
}

function fmtPct(n: number | null): string {
  if (n == null) return ''
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(n))}%`
}

function fmtMargen(n: number | null | undefined): string {
  if (n == null) return 's/d'
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)}%`
}

function fmtSigned(n: number): string {
  if (Math.round(n) === 0) return '$0'
  return `${n > 0 ? '+' : '-'}${fmtCurrency(Math.abs(n))}`
}

type Tono = 'caro' | 'barato' | 'parecido'
type Filtro = 'todos' | Tono | 'sin_receta'
type Modo = 'directo' | 'nivel'

const UMBRAL = 5

// Rojo si la app da más caro, verde si da más barato, gris si es parecido (5% o menos)
function tonoDe(app: number, excel: number, pct: number | null): Tono {
  if (pct == null) return app > excel ? 'caro' : app < excel ? 'barato' : 'parecido'
  return pct > UMBRAL ? 'caro' : pct < -UMBRAL ? 'barato' : 'parecido'
}

const COLOR: Record<Tono, string> = {
  caro: 'text-red-600',
  barato: 'text-[#2D8D68]',
  parecido: 'text-gray-500',
}
const FONDO: Record<Tono, string> = {
  caro: 'bg-red-50',
  barato: 'bg-[#E8F5EE]',
  parecido: 'bg-gray-50',
}

function Diferencia({ valor, pct, tono }: { valor: number; pct: number | null; tono: Tono }) {
  return (
    <div className={`${COLOR[tono]} font-semibold`}>
      {fmtSigned(valor)}
      {pct != null && <div className="text-[11px] font-normal">{fmtPct(pct)}</div>}
    </div>
  )
}

// The numbers of a job in the chosen mode (direct cost, or the app up to the level the Excel reaches)
function valoresDe(t: ObraDiferenciaTrabajo, modo: Modo) {
  return modo === 'directo'
    ? {
        excel: t.excel_directo,
        app: t.app_directo,
        diferencia: t.diferencia_directo,
        pct: t.diferencia_directo_pct,
        excelUnit: t.excel_unitario_directo,
        appUnit: t.app_unitario_directo,
      }
    : {
        // Al nivel del Excel: el lado Excel es siempre excel_neto / excel_unitario
        excel: t.excel_neto,
        app: t.app_nivel ?? 0,
        diferencia: t.diferencia_nivel ?? 0,
        pct: t.diferencia_nivel_pct ?? null,
        excelUnit: t.excel_unitario,
        appUnit: t.app_unitario_nivel ?? null,
      }
}

function TrabajoRow({ t, modo }: { t: ObraDiferenciaTrabajo; modo: Modo }) {
  const [abierto, setAbierto] = useState(false)
  const v = valoresDe(t, modo)
  const tono = tonoDe(v.app, v.excel, v.pct)
  const unidad = t.unidad || 's/u'

  return (
    <Fragment>
      <tr onClick={() => setAbierto(!abierto)} className="border-t cursor-pointer hover:bg-gray-50 align-top">
        <td className="py-2.5 pl-3 pr-2 w-6 text-gray-400">
          {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="py-2.5 pr-3">
          <div className="text-sm font-medium text-gray-900">{t.descripcion}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {t.veces} {t.veces === 1 ? 'vez' : 'veces'} · {fmtNum(t.cantidad_total)} {unidad}
          </div>
        </td>
        <td className="py-2.5 pr-3 text-xs">
          {t.sin_receta || !t.receta
            ? <span className="text-gray-400">Precio del Excel</span>
            : <span className="text-gray-800">{t.receta.nombre}</span>}
        </td>
        <td className="py-2.5 pr-3 text-xs text-right whitespace-nowrap">{fmtCurrency(v.excel)}</td>
        <td className="py-2.5 pr-3 text-xs text-right whitespace-nowrap">{fmtCurrency(v.app)}</td>
        <td className="py-2.5 pr-3 text-xs text-right whitespace-nowrap">
          <Diferencia valor={v.diferencia} pct={v.pct} tono={tono} />
        </td>
      </tr>
      {abierto && (
        <tr className="bg-gray-50">
          <td />
          <td colSpan={5} className="pb-3 pr-3">
            {v.appUnit != null && v.excelUnit != null && (
              <div className="text-[11px] text-gray-500 mb-2">
                Por {unidad}: Excel {fmtCurrency(v.excelUnit)} · App {fmtCurrency(v.appUnit)}
              </div>
            )}
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="font-semibold pb-1">Piso</th>
                  <th className="font-semibold pb-1 text-right">Cantidad</th>
                  <th className="font-semibold pb-1 text-right">Excel</th>
                  <th className="font-semibold pb-1 text-right">App</th>
                  <th className="font-semibold pb-1 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {t.items.map((it) => {
                  const iExcel = modo === 'directo' ? it.excel_directo : it.excel_neto
                  const iApp = modo === 'directo' ? it.app_directo : (it.app_nivel ?? 0)
                  const iDif = modo === 'directo' ? it.diferencia_directo : (it.diferencia_nivel ?? 0)
                  const pct = iExcel ? Math.round((iDif / iExcel) * 1000) / 10 : null
                  const tonoItem = tonoDe(iApp, iExcel, pct)
                  return (
                    <tr key={it.id} className="border-t border-gray-200 text-xs">
                      <td className="py-1.5 pr-2">
                        {it.piso || 'Sin piso'}
                        {it.code && <span className="ml-2 font-mono text-[10px] text-gray-400">{it.code}</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtNum(it.cantidad)} {unidad}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtCurrency(iExcel)}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtCurrency(iApp)}</td>
                      <td className={`py-1.5 text-right whitespace-nowrap font-semibold ${COLOR[tonoItem]}`}>{fmtSigned(iDif)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

// Celular: cada trabajo es una tarjeta con Excel / App / Diferencia; tocarla abre el detalle por piso
function TrabajoTarjeta({ t, modo }: { t: ObraDiferenciaTrabajo; modo: Modo }) {
  const [abierto, setAbierto] = useState(false)
  const v = valoresDe(t, modo)
  const tono = tonoDe(v.app, v.excel, v.pct)
  const unidad = t.unidad || 's/u'
  return (
    <li data-testid="diferencia-tarjeta" className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="w-full text-left px-4 py-3 active:bg-gray-50">
        <span className="flex items-start gap-2">
          <span className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 leading-snug line-clamp-2">{t.descripcion}</span>
          <ChevronDown size={18} className={`flex-shrink-0 mt-0.5 text-gray-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </span>
        <span className="block text-[12px] text-gray-500 mt-0.5">
          {t.veces} {t.veces === 1 ? 'vez' : 'veces'} · {fmtNum(t.cantidad_total)} {unidad} ·{' '}
          {t.sin_receta || !t.receta ? 'Precio del Excel' : t.receta.nombre}
        </span>
        <span className="grid grid-cols-3 gap-2 mt-2.5">
          <span>
            <span className="block text-[11px] text-gray-500">Excel</span>
            <span className="block text-[14px] font-semibold text-gray-900 tabular-nums">{fmtCurrency(v.excel)}</span>
          </span>
          <span>
            <span className="block text-[11px] text-gray-500">App</span>
            <span className="block text-[14px] font-semibold text-[#2D8D68] tabular-nums">{fmtCurrency(v.app)}</span>
          </span>
          <span className={`text-right rounded-lg px-2 py-1 -my-1 ${FONDO[tono]}`}>
            <span className="block text-[11px] text-gray-500">Diferencia</span>
            <span className={`block text-[14px] font-semibold tabular-nums ${COLOR[tono]}`}>
              {fmtSigned(v.diferencia)}
              {v.pct != null && <span className="block text-[11px] font-normal">{fmtPct(v.pct)}</span>}
            </span>
          </span>
        </span>
      </button>
      {abierto && (
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-2.5">
          {v.appUnit != null && v.excelUnit != null && (
            <div className="text-[12px] text-gray-500 mb-1.5">
              Por {unidad}: Excel {fmtCurrency(v.excelUnit)} · App {fmtCurrency(v.appUnit)}
            </div>
          )}
          <ul className="divide-y divide-gray-200">
            {t.items.map((it) => {
              const iExcel = modo === 'directo' ? it.excel_directo : it.excel_neto
              const iApp = modo === 'directo' ? it.app_directo : (it.app_nivel ?? 0)
              const iDif = modo === 'directo' ? it.diferencia_directo : (it.diferencia_nivel ?? 0)
              const pct = iExcel ? Math.round((iDif / iExcel) * 1000) / 10 : null
              const tonoItem = tonoDe(iApp, iExcel, pct)
              return (
                <li key={it.id} className="py-2 text-[13px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-800">
                      {it.piso || 'Sin piso'}
                      {it.code && <span className="ml-2 font-mono text-[11px] text-gray-400">{it.code}</span>}
                    </span>
                    <span className="text-gray-500 whitespace-nowrap">{fmtNum(it.cantidad)} {unidad}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-0.5 tabular-nums">
                    <span>{fmtCurrency(iExcel)}</span>
                    <span>{fmtCurrency(iApp)}</span>
                    <span className={`text-right font-semibold ${COLOR[tonoItem]}`}>{fmtSigned(iDif)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </li>
  )
}

export default function DiferenciasExcel() {
  const { celular } = usePantalla()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ObraDiferencias | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sinTotales, setSinTotales] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  // Starts on direct cost: that is where the recipes show
  const [modo, setModo] = useState<Modo>('directo')

  useEffect(() => {
    if (!id) return
    let vigente = true
    setLoading(true)
    setError('')
    setSinTotales(false)
    obraApi.diferencias(id)
      .then((res) => { if (vigente) setData(res) })
      .catch((e) => {
        if (!vigente) return
        setData(null)
        setError(errorText(e))
        setSinTotales(e instanceof Error && e.message.startsWith('409'))
      })
      .finally(() => { if (vigente) setLoading(false) })
    return () => { vigente = false }
  }, [id])

  const directo = modo === 'directo'
  const trabajosServidor = data?.trabajos || []
  // Sin nivel_excel el servidor es viejo y no trae la comparación al nivel del Excel
  const nivelExcel = data?.nivel_excel
  const sinNivel = !directo && !nivelExcel
  // Cada vista ordena por su propia diferencia (de mayor a menor, en valor absoluto)
  const trabajos = directo
    ? [...trabajosServidor].sort((a, b) => Math.abs(b.diferencia_directo) - Math.abs(a.diferencia_directo))
    : [...trabajosServidor].sort((a, b) => Math.abs(b.diferencia_nivel ?? 0) - Math.abs(a.diferencia_nivel ?? 0))
  const tonoTrabajo = (t: ObraDiferenciaTrabajo) => {
    const v = valoresDe(t, modo)
    return tonoDe(v.app, v.excel, v.pct)
  }
  const cuentaLocal = {
    caro: trabajos.filter((t) => tonoTrabajo(t) === 'caro').length,
    barato: trabajos.filter((t) => tonoTrabajo(t) === 'barato').length,
    parecido: trabajos.filter((t) => tonoTrabajo(t) === 'parecido').length,
  }
  const rd = directo ? data?.resumen?.directo : data?.resumen?.nivel
  const cuenta = {
    todos: trabajos.length,
    ...(rd
      ? { caro: rd.mas_caros, barato: rd.mas_baratos, parecido: rd.parecidos }
      : cuentaLocal),
    sin_receta: trabajos.filter((t) => t.sin_receta).length,
  }
  const visibles = trabajos.filter((t) => {
    if (filtro === 'todos') return true
    if (filtro === 'sin_receta') return t.sin_receta
    return tonoTrabajo(t) === filtro
  })

  const total = data?.total
  // Total al nivel del Excel: el del servidor si lo trae; si no, la suma de los trabajos
  const totalNivel = () => {
    const app = total?.app_nivel ?? trabajosServidor.reduce((s, t) => s + (t.app_nivel ?? 0), 0)
    const excel = total?.excel_neto ?? 0
    const diferencia = total?.diferencia_nivel ?? app - excel
    const pct = total?.diferencia_nivel_pct !== undefined
      ? total.diferencia_nivel_pct
      : excel ? Math.round((diferencia / excel) * 1000) / 10 : null
    return { excel, app, diferencia, pct }
  }
  const tot = total && !sinNivel
    ? directo
      ? { excel: total.excel_directo, app: total.app_directo, diferencia: total.diferencia_directo, pct: total.diferencia_directo_pct }
      : totalNivel()
    : null
  const precioFinalApp = data?.resumen?.app_neto ?? total?.app_neto
  const tonoTotal: Tono = tot ? tonoDe(tot.app, tot.excel, tot.pct) : 'parecido'
  const muyDistinto = tot?.pct != null && Math.abs(tot.pct) > 20

  return (
    <div className="p-4 md:p-6 pb-10 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <GitCompare size={14} /> DIFERENCIAS CON EL EXCEL
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full max-md:hidden" />
        <div className="flex-1 min-w-[220px] max-md:min-w-0 max-md:basis-full">
          <h1 className="text-xl font-extrabold text-gray-900 [overflow-wrap:anywhere]">{data?.nombre || 'COMPARAR CON EL EXCEL'}</h1>
          {data && (
            <div className="text-[11px] text-gray-500">
              {data.precios_al ? `Precios al ${fmtDate(data.precios_al)}` : 'Precios de hoy'}
              {data.source_file && <> · {data.source_file}</>}
            </div>
          )}
        </div>
        {id && (
          <button
            onClick={() => navigate(`/app/budgets/${id}/editor`)}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2 rounded-lg text-sm max-md:w-full max-md:h-11 max-md:rounded-xl max-md:text-[15px]"
          >
            Abrir el presupuesto
          </button>
        )}
      </div>

      <div className="max-w-5xl space-y-5">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Comparando con el Excel…
          </div>
        )}

        {error && !sinTotales && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg whitespace-pre-line">{error}</div>
        )}

        {error && sinTotales && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-sm text-gray-800 mb-4 whitespace-pre-line">{error}</p>
            <button
              onClick={() => navigate('/app/cargar-obra')}
              className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2 rounded-lg text-sm"
            >
              Ir a Cargar obra
            </button>
          </div>
        )}

        {data && total && (
          <>
            <div>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 gap-0.5 max-md:flex max-md:w-full">
                {([
                  ['directo', 'Costo directo'],
                  ['nivel', 'Al nivel del Excel'],
                ] as [Modo, string][]).map(([k, txt]) => (
                  <button
                    key={k}
                    onClick={() => setModo(k)}
                    aria-pressed={modo === k}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-md max-md:flex-1 max-md:min-h-10 max-md:text-[13px] ${modo === k ? 'bg-[#143D34] text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    {txt}
                  </button>
                ))}
              </div>
              {directo && (
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Acá se ven las fórmulas: lo que cuesta hacer cada trabajo, sin margen.
                </p>
              )}
              {!directo && nivelExcel && (
                <div className="mt-2">
                  <p className="text-sm text-gray-800">{nivelExcel.texto}</p>
                  {precioFinalApp != null && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Precio final de la app (con todo): {fmtCurrency(precioFinalApp)}
                    </p>
                  )}
                </div>
              )}
            </div>

            {sinNivel && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg">
                Actualizá la app para ver esta comparación.
              </div>
            )}

            {tot && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-md:gap-2">
                  <div className="bg-white border border-gray-200 rounded-xl p-4 max-md:p-3">
                    <div className="text-[11px] text-gray-500">Excel de Sol</div>
                    <div className="text-xl max-md:text-lg font-bold text-gray-900">{fmtCurrency(tot.excel)}</div>
                  </div>
                  <div className="bg-[#E8F5EE] rounded-xl p-4 max-md:p-3">
                    <div className="text-[11px] text-gray-500">La app</div>
                    <div className="text-xl max-md:text-lg font-bold text-[#2D8D68]">{fmtCurrency(tot.app)}</div>
                  </div>
                  <div className={`${FONDO[tonoTotal]} rounded-xl p-4 max-md:p-3 max-md:col-span-2`}>
                    <div className="text-[11px] text-gray-500">Diferencia</div>
                    <div className={`text-xl max-md:text-lg font-bold ${COLOR[tonoTotal]}`}>
                      {fmtSigned(tot.diferencia)}
                      {tot.pct != null && (
                        <span className="text-sm font-semibold ml-2">{fmtPct(tot.pct)}</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4 max-md:p-3 max-md:col-span-2">
                    <div className="text-[11px] text-gray-500">Margen</div>
                    <div className="text-sm font-bold text-gray-900 mt-1">
                      Tu Excel: {fmtMargen(total.margen_excel_pct)} promedio · La app: {fmtMargen(total.margen_app_pct)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      Si querés que coincidan, ajustá el coeficiente de pase del presupuesto.
                    </div>
                  </div>
                </div>

                {muyDistinto && tot.pct != null && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg">
                    El total da {new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(tot.pct))}%{' '}
                    {tot.pct > 0 ? 'más caro' : 'más barato'} que tu Excel. Mirá las diferencias antes de usarlo.
                  </div>
                )}

                <div className="flex flex-wrap gap-2 max-md:flex-nowrap max-md:overflow-x-auto max-md:-mx-4 max-md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="filtros-diferencias">
                  {([
                    ['todos', 'Todos', cuenta.todos],
                    ['caro', 'Más caros', cuenta.caro],
                    ['barato', 'Más baratos', cuenta.barato],
                    ['parecido', 'Parecidos', cuenta.parecido],
                    ['sin_receta', 'Sin fórmula', cuenta.sin_receta],
                  ] as [Filtro, string, number][]).map(([k, txt, n]) => (
                    <button
                      key={k}
                      onClick={() => setFiltro(k)}
                      aria-pressed={filtro === k}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap flex-shrink-0 max-md:min-h-10 max-md:px-4 max-md:text-[13px] ${filtro === k ? 'bg-[#143D34] text-white border-[#143D34]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      {txt} ({n})
                    </button>
                  ))}
                </div>

                {celular ? (
                  <>
                    <ul className="space-y-2.5">
                      {visibles.map((t) => <TrabajoTarjeta key={t.clave} t={t} modo={modo} />)}
                    </ul>
                    {visibles.length === 0 && (
                      <div className="bg-white border rounded-2xl px-4 py-4 text-[13px] text-gray-500">No hay trabajos en esta lista.</div>
                    )}
                  </>
                ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left min-w-[640px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                        <th className="w-6" />
                        <th className="font-semibold py-2 pr-3">Trabajo</th>
                        <th className="font-semibold py-2 pr-3">Fórmula</th>
                        <th className="font-semibold py-2 pr-3 text-right">{directo ? 'Excel (costo)' : 'Excel'}</th>
                        <th className="font-semibold py-2 pr-3 text-right">{directo ? 'App (costo)' : 'App'}</th>
                        <th className="font-semibold py-2 pr-3 text-right">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((t) => <TrabajoRow key={t.clave} t={t} modo={modo} />)}
                    </tbody>
                  </table>
                  {visibles.length === 0 && (
                    <div className="px-4 py-4 text-xs text-gray-500 border-t">No hay trabajos en esta lista.</div>
                  )}
                </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
