import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, GitCompare } from 'lucide-react'
import { obraApi } from '../lib/api'
import type { ObraDiferencias, ObraDiferenciaTrabajo } from '../lib/api'
import { fmtCurrency, fmtDate } from '../lib/format'

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // The API answers "409: {...json...}": show only the message
  const m = msg.match(/"mensaje"\s*:\s*"((?:[^"\\]|\\.)*)"/) || msg.match(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  return m ? m[1].replace(/\\"/g, '"') : msg
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)
}

function fmtPct(n: number | null): string {
  if (n == null) return ''
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(n))}%`
}

function fmtSigned(n: number): string {
  if (Math.round(n) === 0) return '$0'
  return `${n > 0 ? '+' : '-'}${fmtCurrency(Math.abs(n))}`
}

type Tono = 'caro' | 'barato' | 'parecido'
type Filtro = 'todos' | Tono | 'sin_receta'

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

function TrabajoRow({ t }: { t: ObraDiferenciaTrabajo }) {
  const [abierto, setAbierto] = useState(false)
  const tono = tonoDe(t.app_neto, t.excel_neto, t.diferencia_pct)
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
        <td className="py-2.5 pr-3 text-xs text-right whitespace-nowrap">{fmtCurrency(t.excel_neto)}</td>
        <td className="py-2.5 pr-3 text-xs text-right whitespace-nowrap">{fmtCurrency(t.app_neto)}</td>
        <td className="py-2.5 pr-3 text-xs text-right whitespace-nowrap">
          <Diferencia valor={t.diferencia} pct={t.diferencia_pct} tono={tono} />
        </td>
      </tr>
      {abierto && (
        <tr className="bg-gray-50">
          <td />
          <td colSpan={5} className="pb-3 pr-3">
            {t.app_unitario != null && t.excel_unitario != null && (
              <div className="text-[11px] text-gray-500 mb-2">
                Por {unidad}: Excel {fmtCurrency(t.excel_unitario)} · App {fmtCurrency(t.app_unitario)}
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
                  const pct = it.excel_neto ? Math.round((it.diferencia / it.excel_neto) * 1000) / 10 : null
                  const tonoItem = tonoDe(it.app_neto, it.excel_neto, pct)
                  return (
                    <tr key={it.id} className="border-t border-gray-200 text-xs">
                      <td className="py-1.5 pr-2">
                        {it.piso || 'Sin piso'}
                        {it.code && <span className="ml-2 font-mono text-[10px] text-gray-400">{it.code}</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtNum(it.cantidad)} {unidad}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtCurrency(it.excel_neto)}</td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtCurrency(it.app_neto)}</td>
                      <td className={`py-1.5 text-right whitespace-nowrap font-semibold ${COLOR[tonoItem]}`}>{fmtSigned(it.diferencia)}</td>
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

export default function DiferenciasExcel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ObraDiferencias | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sinTotales, setSinTotales] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')

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

  const trabajos = data?.trabajos || []
  const tonoTrabajo = (t: ObraDiferenciaTrabajo) => tonoDe(t.app_neto, t.excel_neto, t.diferencia_pct)
  const cuenta = {
    todos: trabajos.length,
    caro: trabajos.filter((t) => tonoTrabajo(t) === 'caro').length,
    barato: trabajos.filter((t) => tonoTrabajo(t) === 'barato').length,
    parecido: trabajos.filter((t) => tonoTrabajo(t) === 'parecido').length,
    sin_receta: trabajos.filter((t) => t.sin_receta).length,
  }
  const visibles = trabajos.filter((t) => {
    if (filtro === 'todos') return true
    if (filtro === 'sin_receta') return t.sin_receta
    return tonoTrabajo(t) === filtro
  })

  const total = data?.total
  const tonoTotal: Tono = total ? tonoDe(total.app_neto, total.excel_neto, total.diferencia_pct) : 'parecido'
  const muyDistinto = total?.diferencia_pct != null && Math.abs(total.diferencia_pct) > 20

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <GitCompare size={14} /> DIFERENCIAS CON EL EXCEL
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-extrabold text-gray-900">{data?.nombre || 'COMPARAR CON EL EXCEL'}</h1>
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
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2 rounded-lg text-sm"
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
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        {error && sinTotales && (
          <div className="bg-white border rounded-xl p-5">
            <p className="text-sm text-gray-800 mb-4">{error}</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white border rounded-xl p-4">
                <div className="text-[11px] text-gray-500">Excel de Sol</div>
                <div className="text-xl font-bold text-gray-900">{fmtCurrency(total.excel_neto)}</div>
              </div>
              <div className="bg-[#E8F5EE] rounded-xl p-4">
                <div className="text-[11px] text-gray-500">La app</div>
                <div className="text-xl font-bold text-[#2D8D68]">{fmtCurrency(total.app_neto)}</div>
              </div>
              <div className={`${FONDO[tonoTotal]} rounded-xl p-4`}>
                <div className="text-[11px] text-gray-500">Diferencia</div>
                <div className={`text-xl font-bold ${COLOR[tonoTotal]}`}>
                  {fmtSigned(total.diferencia)}
                  {total.diferencia_pct != null && (
                    <span className="text-sm font-semibold ml-2">{fmtPct(total.diferencia_pct)}</span>
                  )}
                </div>
              </div>
            </div>

            {muyDistinto && total.diferencia_pct != null && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg">
                El total da {new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(total.diferencia_pct))}%{' '}
                {total.diferencia_pct > 0 ? 'más caro' : 'más barato'} que tu Excel. Mirá las diferencias antes de usarlo.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {([
                ['todos', 'Todos', cuenta.todos],
                ['caro', 'Más caros', cuenta.caro],
                ['barato', 'Más baratos', cuenta.barato],
                ['parecido', 'Parecidos', cuenta.parecido],
                ['sin_receta', 'Sin receta', cuenta.sin_receta],
              ] as [Filtro, string, number][]).map(([k, txt, n]) => (
                <button
                  key={k}
                  onClick={() => setFiltro(k)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${filtro === k ? 'bg-[#143D34] text-white border-[#143D34]' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {txt} ({n})
                </button>
              ))}
            </div>

            <div className="bg-white border rounded-xl overflow-x-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="w-6" />
                    <th className="font-semibold py-2 pr-3">Trabajo</th>
                    <th className="font-semibold py-2 pr-3">Receta</th>
                    <th className="font-semibold py-2 pr-3 text-right">Excel</th>
                    <th className="font-semibold py-2 pr-3 text-right">App</th>
                    <th className="font-semibold py-2 pr-3 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((t) => <TrabajoRow key={t.clave} t={t} />)}
                </tbody>
              </table>
              {visibles.length === 0 && (
                <div className="px-4 py-4 text-xs text-gray-500 border-t">No hay trabajos en esta lista.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
