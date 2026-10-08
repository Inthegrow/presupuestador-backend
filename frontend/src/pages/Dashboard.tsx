import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, TrendingUp, DollarSign, Plus, Search, ArrowRight } from 'lucide-react'
import { budgetApi } from '../lib/api'
import { fmtCurrency } from '../lib/format'
import type { Budget, AnalysisResponse } from '../types'
import BudgetCard from '../components/ui/BudgetCard'
import { useAuth } from '../contexts/AuthContext'
import { FORMAS_DE_EMPEZAR } from '../components/layout/formasDeEmpezar'

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'ahora'
  if (diffMins < 60) return `hace ${diffMins} min`
  if (diffHours < 24) return `hace ${diffHours} hs`
  if (diffDays < 7) return `hace ${diffDays} días`
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

export default function Dashboard() {
  const { puedeEditar } = useAuth()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResponse>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('todos')
  const navigate = useNavigate()

  const STATUS_PILLS = [
    { key: 'todos', label: 'Todos' },
    { key: 'draft', label: 'Borrador' },
    { key: 'approved', label: 'Aprobado' },
    { key: 'sent', label: 'Enviado' },
  ]

  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === 'todos' || (b.status ?? '').toLowerCase() === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [budgets, search, statusFilter])

  function loadBudgets() {
    setLoading(true)
    budgetApi.list()
      .then((list) => {
        setBudgets(list)
        // Fetch analysis (totals) for each budget
        return Promise.allSettled(
          list.map((b) =>
            budgetApi.getAnalysis(b.id).then((a) => ({ id: b.id, analysis: a }))
          )
        )
      })
      .then((results) => {
        const map: Record<string, AnalysisResponse> = {}
        for (const r of results) {
          if (r.status === 'fulfilled') {
            map[r.value.id] = r.value.analysis
          }
        }
        setAnalyses(map)
      })
      .catch(() => setError('No se pudieron cargar los presupuestos.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadBudgets()
  }, [])

  const totalItems = Object.values(analyses).reduce((s, a) => s + (a.items_count ?? 0), 0)
  const totalNeto = Object.values(analyses).reduce((s, a) => s + (a.neto_total ?? 0), 0)

  return (
    <div className="p-4 md:p-6 fade-in">
      {/* Section header */}
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <LayoutGrid size={14} />
        CENTRO DE PRESUPUESTOS
      </div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-1 h-8 bg-[#2D8D68] rounded-full flex-shrink-0" />
          <h1 className="text-xl md:text-2xl font-extrabold text-gray-900">MIS PRESUPUESTOS</h1>
          <span className="bg-[#E8F5EE] text-[#1B5E4B] text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap">
            {budgets.length} {budgets.length === 1 ? 'obra' : 'obras'}
          </span>
        </div>
        {puedeEditar && (
          <button
            onClick={() => navigate('/app/new-project')}
            className="hidden md:flex bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-2 rounded-lg text-xs items-center gap-1.5 transition-colors flex-shrink-0"
          >
            <Plus size={14} /> Nuevo presupuesto
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5 md:mb-6 pl-4">
        Las obras cargadas. Entrá a una para ver el detalle o compararla con el Excel.
      </p>

      {/* KPI cards */}
      <div className="text-[10px] font-bold text-gray-400 tracking-wider mb-2">RESUMEN GENERAL</div>
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-6">
        <KpiCard icon={<LayoutGrid size={16} strokeWidth={1.5} className="text-[#2D8D68]" />} bg="bg-[#E8F5EE]" value={String(budgets.length)} label="OBRAS" />
        <KpiCard icon={<TrendingUp size={16} strokeWidth={1.5} className="text-blue-600" />} bg="bg-blue-50" value={String(totalItems)} label="TRABAJOS CARGADOS" valueClass="text-blue-600" />
        <KpiCard icon={<DollarSign size={16} strokeWidth={1.5} className="text-[#2D8D68]" />} bg="bg-[#E8F5EE]" value={totalNeto > 0 ? fmtCurrency(totalNeto) : '$0'} label="TOTAL DE LA CARTERA, SIN IVA" />
      </div>

      {/* Search and filter */}
      <div className="mb-4 flex flex-col gap-3">
        {/* Search input */}
        <div className="relative md:max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar presupuesto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 md:py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20 transition-all"
          />
        </div>
        {/* Status filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_PILLS.map((pill) => (
            <button
              key={pill.key}
              onClick={() => setStatusFilter(pill.key)}
              className={`px-4 md:px-3 min-h-10 md:min-h-0 py-1 rounded-full text-[13px] md:text-xs font-medium transition-all ${
                statusFilter === pill.key
                  ? 'bg-[#2D8D68] text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-[#2D8D68] hover:text-[#2D8D68]'
              }`}
            >
              {pill.label}
            </button>
          ))}
          <span className="w-full md:w-auto text-right md:ml-auto text-[11px] text-gray-400">
            Mostrando {filteredBudgets.length} de {budgets.length} presupuestos
          </span>
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando presupuestos...
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-4 py-2 rounded-lg flex items-center gap-3">
          <span>{error}</span>
          <button onClick={() => { setError(''); loadBudgets() }} className="font-semibold underline hover:no-underline">
            Probar de nuevo
          </button>
        </div>
      )}

      {/* Empty: the three ways to start, as cards */}
      {!loading && budgets.length === 0 && !error && (
        <div className="mb-6 bg-white rounded-xl border border-gray-100 shadow-sm p-6" data-testid="tablero-vacio">
          <p className="text-gray-900 font-semibold text-sm">Todavía no hay presupuestos.</p>
          {puedeEditar ? (
            <>
              <p className="text-gray-500 text-sm mb-4">Elegí cómo querés empezar:</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {FORMAS_DE_EMPEZAR.map((f) => (
                  <button
                    key={f.clave}
                    onClick={() => navigate(f.ruta)}
                    className="group text-left rounded-xl border border-gray-200 p-4 hover:border-[#2D8D68] hover:bg-[#F0FAF5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D8D68]/40 transition-all"
                  >
                    <span className="w-9 h-9 rounded-lg bg-[#E8F5EE] text-[#2D8D68] flex items-center justify-center mb-3">
                      <f.Icono size={18} />
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold text-[#143D34]">
                      {f.titulo}
                      <ArrowRight size={14} className="text-[#2D8D68] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{f.linea}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-sm">Los carga quien edita; cuando haya alguno, lo vas a ver acá.</p>
          )}
        </div>
      )}
      {!loading && budgets.length > 0 && filteredBudgets.length === 0 && (
        <div className="mb-6 text-center py-8 bg-white rounded-xl border border-gray-100 shadow-sm">
          <p className="text-gray-500 text-sm">No hay presupuestos que coincidan con la búsqueda.</p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-6">
        {filteredBudgets.map((b) => {
          const a = analyses[b.id]
          return (
            <BudgetCard
              key={b.id}
              budget={b}
              directTotal={a?.directo_total}
              netoTotal={a?.neto_total}
              subtitle={a ? `${a.items_count} ${a.items_count === 1 ? 'trabajo' : 'trabajos'}` : undefined}
              onDelete={() => loadBudgets()}
            />
          )
        })}
      </div>

      {/* Activity — real recent budgets */}
      {budgets.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">ACTIVIDAD RECIENTE</h3>
          <div className="space-y-2 text-sm">
            {budgets.slice(0, 5).map((b, i) => {
              const a = analyses[b.id]
              const dateStr = b.updated_at || b.created_at
              const itemsText = a ? `${a.items_count} ${a.items_count === 1 ? 'trabajo' : 'trabajos'}` : ''
              const STATUS_MAP: Record<string, string> = { draft: 'Borrador', active: 'Activo', approved: 'Aprobado', sent: 'Enviado', review: 'En revisión' }
              const statusText = STATUS_MAP[b.status?.toLowerCase() || ''] || b.status || ''
              const detail = [statusText, itemsText].filter(Boolean).join(' - ')
              return (
                <div
                  key={b.id}
                  className={`flex justify-between items-center gap-3 min-h-11 py-2 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors ${i < Math.min(budgets.length, 5) - 1 ? 'border-b border-gray-50' : ''}`}
                  onClick={() => navigate(`/app/budgets/${b.id}/editor`)}
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-900">{b.name}</span>
                    {detail && <span className="text-gray-500 ml-2">{detail}</span>}
                  </div>
                  <span className="text-gray-400 text-xs whitespace-nowrap">
                    {dateStr ? timeAgo(dateStr) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({
  icon, bg, value, label, valueClass = 'text-[#2D8D68]',
}: {
  icon: React.ReactNode
  bg: string
  value: string
  label: string
  valueClass?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl p-3 md:p-4 bg-gradient-to-br from-white to-gray-50/50 shadow-sm border border-gray-100">
      <div className={`absolute top-0 left-0 w-full h-0.5 ${bg}`} />
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-7 h-7 ${bg} rounded-lg flex items-center justify-center`}>{icon}</div>
      </div>
      <div className={`text-xl md:text-2xl font-bold tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider leading-snug">{label}</div>
    </div>
  )
}
