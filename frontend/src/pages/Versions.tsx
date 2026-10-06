import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw, Eye, GitCompare, Plus, CalendarClock } from 'lucide-react'
import { budgetApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { fmtDate, fmtPesos } from '../lib/format'
import type { Budget, BudgetVersion, PriceUpdateResult } from '../types'

// neto: precio sin IVA de la versión (null = el servidor no lo mandó: no se inventa un $0)
type VersionRow = BudgetVersion & { neto: number | null; label: string; date: string }

function netoDe(v: BudgetVersion): number | null {
  if (typeof v.neto_total === 'number' && Number.isFinite(v.neto_total)) return v.neto_total
  const viejo = (v.data as Record<string, unknown> | null)?.neto_total
  return typeof viejo === 'number' && Number.isFinite(viejo) ? viejo : null
}

// La API contesta "409: {...json...}": mostrar solo el mensaje
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/"mensaje"\s*:\s*"((?:[^"\\]|\\.)*)"/) || msg.match(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  return m ? m[1].replace(/\\"/g, '"') : msg || 'Error al actualizar precios'
}

export default function Versions() {
  const { id } = useParams<{ id: string }>()
  const { puedeEditar } = useAuth()
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [budget, setBudget] = useState<Budget | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [priceResult, setPriceResult] = useState<PriceUpdateResult | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)

  function mapVersions(data: BudgetVersion[]): VersionRow[] {
    // La más nueva primero (la "Actual"), aunque el servidor las mande en otro orden
    return [...data].sort((a, b) => (b.version ?? 0) - (a.version ?? 0)).map((v) => ({
      ...v,
      neto: netoDe(v),
      label: v.notas || '',
      date: v.created_at ? new Date(v.created_at).toLocaleDateString('es-AR') : '',
    }))
  }

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    Promise.all([
      budgetApi.get(id),
      budgetApi.getVersions(id),
    ])
      .then(([b, data]) => {
        setBudget(b)
        if (data.length > 0) {
          setVersions(mapVersions(data))
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Error al cargar versiones')
      })
      .finally(() => setLoading(false))
  }, [id])

  async function createVersion() {
    if (!id) return
    setCreating(true)
    try {
      await budgetApi.createVersion(id)
      const data = await budgetApi.getVersions(id)
      setVersions(mapVersions(data))
    } catch {
      // ignore
    }
    setCreating(false)
  }

  async function updatePrices() {
    if (!id) return
    if (!window.confirm('Se toma el último precio de cada recurso y se recalcula el presupuesto. La versión actual queda guardada. ¿Seguir?')) return
    setUpdating(true)
    setPriceError(null)
    try {
      const result = await budgetApi.updatePrices(id)
      setPriceResult(result)
      setBudget((b) => (b ? { ...b, precios_al: result.precios_al } : b))
      setVersions(mapVersions(await budgetApi.getVersions(id)))
    } catch (err) {
      setPriceError(errorText(err))
    }
    setUpdating(false)
  }

  const budgetName = budget?.name ?? 'Presupuesto'
  const current = versions[0]

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <RefreshCw size={14} /> HISTORIAL
      </div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
          <h1 className="text-xl font-extrabold text-gray-900">VERSIONES — {budgetName.toUpperCase()}</h1>
          <span className="text-xs text-gray-500">Precios al {budget?.precios_al ? fmtDate(budget.precios_al) : 'sin fecha'}</span>
        </div>
        {puedeEditar && (
        <div className="flex gap-2">
        <button
          onClick={updatePrices}
          disabled={updating}
          className="border border-[#2D8D68] text-[#2D8D68] hover:bg-[#E8F5EE] disabled:opacity-60 font-semibold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
        >
          {updating ? (
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          ) : (
            <CalendarClock size={14} />
          )}
          Actualizar a precios de hoy
        </button>
        <button
          onClick={createVersion}
          disabled={creating}
          className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
        >
          {creating ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Guardar version actual
        </button>
        </div>
        )}
      </div>

      {priceError && (
        <div className="max-w-2xl bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{priceError}</div>
      )}

      {priceResult && (
        <div className="max-w-2xl bg-[#E8F5EE] border border-[#2D8D68]/30 rounded-xl p-4 mb-4 text-xs text-[#143D34]">
          <p className="font-semibold mb-1">
            Precios al {fmtDate(priceResult.precios_al)}: {priceResult.precios_actualizados} recursos actualizados.
            Nueva versión v{priceResult.version_nueva.version} (la anterior quedó en v{priceResult.version_anterior.version}).
          </p>
          {priceResult.sin_precio.length > 0 && (
            <p>
              Sin precio en el catálogo (quedan con el precio anterior):{' '}
              {priceResult.sin_precio.map((p) => `${p.codigo ?? p.descripcion}${p.motivo === 'duplicado' ? ' (código repetido)' : ''}`).join(', ')}
            </p>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando versiones...
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
          <p className="font-semibold mb-1">Error al cargar versiones</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      {!loading && versions.length === 0 ? (
        <div className="max-w-2xl bg-white rounded-xl border p-8 text-center text-gray-400">
          <RefreshCw size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No hay versiones guardadas todavia.</p>
          <p className="text-xs mt-1">Guarda una version para crear un punto de restauracion.</p>
        </div>
      ) : (
        <div className="max-w-2xl space-y-3">
          {versions.map((v, i) => {
            const isCurrent = i === 0
            // Diferencia de esta versión contra la actual (solo si se conocen los dos precios)
            const comparable = !isCurrent && current && v.neto !== null && current.neto !== null
            const deltaNeto = comparable ? (v.neto as number) - (current.neto as number) : 0
            const deltaPct = comparable && current.neto !== 0 ? (deltaNeto / (current.neto as number)) * 100 : null

            return (
              <div
                key={v.id}
                className={`bg-white rounded-xl border overflow-hidden ${isCurrent ? 'border-l-4 border-l-[#2D8D68]' : ''}`}
              >
                <div className="p-4 flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-sm text-gray-900">
                      v{v.version}{v.label ? ` — ${v.label}` : ''}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {[v.date && `Guardada el ${v.date}`, v.precios_al && `Precios al ${fmtDate(v.precios_al)}`].filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs text-gray-700 mt-1" data-testid="version-precio" data-valor={v.neto ?? ''}>
                      Precio sin IVA: <span className="font-semibold tabular-nums">{v.neto === null ? '—' : fmtPesos(v.neto)}</span>
                    </div>
                    {comparable && (
                      <div className={`text-[11px] mt-0.5 ${deltaNeto === 0 ? 'text-gray-400' : 'text-gray-600'}`}>
                        {deltaNeto === 0
                          ? `Igual que v${current.version}`
                          : <>
                              {deltaNeto > 0 ? '+' : '−'}{fmtPesos(Math.abs(deltaNeto))}
                              {deltaPct !== null && ` (${deltaPct > 0 ? '+' : '−'}${Math.abs(deltaPct).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%)`}
                              {' '}contra v{current.version}
                            </>}
                      </div>
                    )}
                  </div>
                  {isCurrent ? (
                    <span className="text-[10px] text-[#2D8D68] font-semibold bg-[#E8F5EE] px-2 py-0.5 rounded-full">
                      Actual
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <button className="text-xs text-[#2D8D68] border border-[#2D8D68] px-2.5 py-1 rounded-lg font-medium hover:bg-[#E8F5EE] transition-colors flex items-center gap-1">
                        <Eye size={12} /> Ver
                      </button>
                      <button className="text-xs text-blue-600 border px-2.5 py-1 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1">
                        <GitCompare size={12} /> Comparar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 max-w-2xl bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
        <p className="font-semibold mb-1">Acerca de las versiones</p>
        <p>Cada versión guarda una copia completa del presupuesto, con su precio sin IVA. Al lado de cada una ves cuánto cambió contra la actual.</p>
      </div>
    </div>
  )
}
