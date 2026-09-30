import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { budgetApi } from '../lib/api'
import type { CascadeResult, IndirectConfig } from '../types'

const DEFAULT_CONFIG: IndirectConfig = {
  id: '',
  org_id: '',
  imprevistos_pct: 3,
  estructura_pct: 15,
  jefatura_pct: 8,
  logistica_pct: 5,
  herramientas_pct: 3,
  beneficio_pct: 25,
  ingresos_brutos_pct: 7,
  imp_cheque_pct: 1.2,
  iva_pct: 21,
}

interface FieldDef {
  key: keyof IndirectConfig
  label: string
  hint?: string
}

const INDIRECTO_FIELDS: FieldDef[] = [
  { key: 'imprevistos_pct', label: 'Imprevistos' },
  { key: 'estructura_pct', label: 'Estructura' },
  { key: 'jefatura_pct', label: 'Jefatura de Obra' },
  { key: 'logistica_pct', label: 'Logística' },
  { key: 'herramientas_pct', label: 'Herramientas' },
]

const IMPUESTO_FIELDS: FieldDef[] = [
  { key: 'ingresos_brutos_pct', label: 'Ingresos Brutos', hint: 'sobre Neto con Beneficio' },
  { key: 'imp_cheque_pct', label: 'Impuesto al Cheque', hint: 'sobre Neto con Beneficio' },
]

function PctInput({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step="0.1"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-16 text-right px-2 py-1 text-sm font-semibold border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20 tabular-nums"
      />
      <span className="text-sm text-gray-500 font-medium">%</span>
    </div>
  )
}

function wasteNum(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Shows the general value when this budget uses a different one. */
function GeneralHint({ general, field, value }: { general: Partial<IndirectConfig> | null; field: keyof IndirectConfig; value: number }) {
  const g = general?.[field]
  if (typeof g !== 'number' || g === value) return null
  return <span className="ml-2 text-[11px] text-amber-600">(general: {g}%)</span>
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-3">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase px-2">{label}</span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  )
}

export default function MarkupChain() {
  // The route is /app/settings/markups?budget=<id> (older links used :id)
  const params = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const id = params.id ?? searchParams.get('budget') ?? undefined
  const [cfg, setCfg] = useState<IndirectConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  // Waste: general (org) and this budget. '' = not set / inherit
  const [orgWaste, setOrgWaste] = useState('')
  const [budgetWaste, setBudgetWaste] = useState('')
  // Also save these % as the general values (the ones new budgets start with)
  const [alsoGeneral, setAlsoGeneral] = useState(false)
  const [general, setGeneral] = useState<Partial<IndirectConfig> | null>(null)
  const [recalculating, setRecalculating] = useState(false)
  const [recalc, setRecalc] = useState<CascadeResult | null>(null)
  const [recalcError, setRecalcError] = useState<string | null>(null)

  useEffect(() => {
    if (id) {
      budgetApi
        .get(id)
        .then((b) => setBudgetWaste(b.desperdicio_pct === null || b.desperdicio_pct === undefined ? '' : String(b.desperdicio_pct)))
        .catch(() => {/* ignore */})
    }
    // With a budget: its own % (they start as the general ones). Without: the general ones.
    ;(id ? budgetApi.getIndirects(id) : budgetApi.getGeneralIndirects())
      .then((data) => {
        setCfg({
          ...DEFAULT_CONFIG,
          ...data,
          // ensure new fields have defaults if backend returns null/undefined
          imprevistos_pct: data.imprevistos_pct ?? DEFAULT_CONFIG.imprevistos_pct,
          beneficio_pct: data.beneficio_pct ?? DEFAULT_CONFIG.beneficio_pct,
          ingresos_brutos_pct: data.ingresos_brutos_pct ?? DEFAULT_CONFIG.ingresos_brutos_pct,
          imp_cheque_pct: data.imp_cheque_pct ?? DEFAULT_CONFIG.imp_cheque_pct,
          iva_pct: data.iva_pct ?? DEFAULT_CONFIG.iva_pct,
        })
        setGeneral(data.general ?? null)
        setOrgWaste(data.desperdicio_pct === null || data.desperdicio_pct === undefined ? '' : String(data.desperdicio_pct))
      })
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false))
  }, [id])

  function set(key: keyof IndirectConfig, val: number) {
    setCfg((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const pct = {
        imprevistos_pct: cfg.imprevistos_pct,
        estructura_pct: cfg.estructura_pct,
        jefatura_pct: cfg.jefatura_pct,
        logistica_pct: cfg.logistica_pct,
        herramientas_pct: cfg.herramientas_pct,
        beneficio_pct: cfg.beneficio_pct,
        ingresos_brutos_pct: cfg.ingresos_brutos_pct,
        imp_cheque_pct: cfg.imp_cheque_pct,
        iva_pct: cfg.iva_pct,
      }
      const desperdicio_pct = wasteNum(orgWaste) ?? 0
      if (id) {
        // Only this budget: the other budgets keep their numbers
        const data = await budgetApi.updateIndirects(id, { ...pct, desperdicio_pct })
        setGeneral(data.general ?? null)
        if (alsoGeneral) setGeneral(await budgetApi.updateGeneralIndirects(pct))
        // null = this budget inherits the general / template value
        await budgetApi.update(id, { desperdicio_pct: wasteNum(budgetWaste) })
      } else {
        await budgetApi.updateGeneralIndirects({ ...pct, desperdicio_pct })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // ignore
    }
    setSaving(false)
  }

  async function handleRecalc() {
    if (!id) return
    setRecalculating(true)
    setRecalcError(null)
    try {
      setRecalc(await budgetApi.cascadeRecalculate(id))
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : 'Error al recalcular')
    }
    setRecalculating(false)
  }

  const subtotalIndirectosPct = INDIRECTO_FIELDS.reduce(
    (s, f) => s + ((cfg[f.key] as number) ?? 0),
    0,
  )

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Settings size={14} /> CONFIGURACIÓN
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">CADENA DE COSTOS INDIRECTOS</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6 ml-4">
        {id
          ? 'Porcentajes de esta obra. Arrancan con los valores generales; cambiarlos acá no toca las otras obras.'
          : 'Valores generales: con estos porcentajes arranca cada obra nueva.'}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      )}

      <div className="max-w-lg">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-[#E8F5EE] px-6 py-4 border-b border-[#2D8D68]/20">
            <h2 className="text-[#143D34] font-bold text-base">Parámetros de costos</h2>
            <p className="text-[#2D8D68] text-xs mt-0.5">
              Directo → + Indirectos → + Beneficio → + Impuestos → + IVA = Total Final
            </p>
          </div>

          <div className="px-6 pb-6">
            {/* ── COSTOS INDIRECTOS ── */}
            <SectionDivider label="Costos Indirectos" />
            <div className="space-y-2">
              {INDIRECTO_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">
                    {f.label}
                    <GeneralHint general={general} field={f.key} value={cfg[f.key] as number} />
                  </span>
                  <PctInput
                    value={(cfg[f.key] as number) ?? 0}
                    onChange={(v) => set(f.key, v)}
                  />
                </div>
              ))}
            </div>
            {/* Subtotal indirectos */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed border-gray-200">
              <span className="text-sm font-semibold text-gray-600">Subtotal Indirectos:</span>
              <span className="text-sm font-bold text-[#E8663C]">{subtotalIndirectosPct.toFixed(1)} %</span>
            </div>

            {/* ── BENEFICIO ── */}
            <SectionDivider label="Beneficio" />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-700">Beneficio</span>
                <span className="ml-2 text-[11px] text-gray-400">(sobre Subt. con Indirectos)</span>
              </div>
              <PctInput
                value={cfg.beneficio_pct ?? 25}
                onChange={(v) => set('beneficio_pct', v)}
              />
            </div>

            {/* ── IMPUESTOS ── */}
            <SectionDivider label="Impuestos" />
            <div className="space-y-2">
              {IMPUESTO_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-700">{f.label}</span>
                    {f.hint && (
                      <span className="ml-2 text-[11px] text-gray-400">({f.hint})</span>
                    )}
                  </div>
                  <PctInput
                    value={(cfg[f.key] as number) ?? 0}
                    onChange={(v) => set(f.key, v)}
                  />
                </div>
              ))}
            </div>

            {/* ── IVA ── */}
            <SectionDivider label="IVA" />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-700">IVA</span>
                <span className="ml-2 text-[11px] text-gray-400">(sobre Neto)</span>
              </div>
              <PctInput
                value={cfg.iva_pct ?? 21}
                onChange={(v) => set('iva_pct', v)}
              />
            </div>

            {/* ── DESPERDICIO ── */}
            <SectionDivider label="Desperdicio" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-700">General</span>
                  <span className="ml-2 text-[11px] text-gray-400">(toda la empresa)</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    value={orgWaste}
                    placeholder="0"
                    onChange={(e) => setOrgWaste(e.target.value)}
                    className="w-16 text-right px-2 py-1 text-sm font-semibold border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] tabular-nums"
                  />
                  <span className="text-sm text-gray-500 font-medium">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-700">Este presupuesto</span>
                  <span className="ml-2 text-[11px] text-gray-400">(vacío = hereda plantilla / general)</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    value={budgetWaste}
                    placeholder={orgWaste || '0'}
                    onChange={(e) => setBudgetWaste(e.target.value)}
                    className="w-16 text-right px-2 py-1 text-sm font-semibold border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] tabular-nums"
                  />
                  <span className="text-sm text-gray-500 font-medium">%</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                Orden: recurso → presupuesto → plantilla → general. Se aplica al recalcular la obra.
              </p>
            </div>

            {/* Save */}
            <div className="mt-6 flex items-center justify-end gap-4">
              {id && (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={alsoGeneral} onChange={(e) => setAlsoGeneral(e.target.checked)} />
                  Usar también como valores generales
                </label>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                {saving && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {saved ? 'Guardado' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>

        {/* Recalculate the whole budget */}
        <div className="mt-4 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Recalcular obra</div>
              <div className="text-[11px] text-gray-400">Fórmulas, desperdicio heredado, redondeo a unidad de compra e indirectos.</div>
            </div>
            <button
              onClick={handleRecalc}
              disabled={recalculating}
              className="border border-[#2D8D68] text-[#2D8D68] hover:bg-[#E8F5EE] disabled:opacity-60 font-semibold px-4 py-2 rounded-xl text-sm"
            >
              {recalculating ? 'Recalculando...' : 'Recalcular'}
            </button>
          </div>
          {recalcError && <p className="text-xs text-red-600 mt-2">{recalcError}</p>}
          {recalc && (
            <div className="mt-3 text-xs text-gray-600 space-y-2">
              <p>{recalc.items_updated} ítems y {recalc.resources_updated} recursos recalculados.</p>
              {recalc.errores.length > 0 && (
                <ul className="text-red-700 list-disc ml-4">
                  {recalc.errores.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              {recalc.redondeos.length > 0 && (
                <table className="w-full text-[11px]">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left font-medium py-1">Material</th>
                      <th className="text-right font-medium py-1">Necesario</th>
                      <th className="text-right font-medium py-1">A comprar</th>
                      <th className="text-right font-medium py-1">Envases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recalc.redondeos.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1">{r.codigo || r.descripcion}</td>
                        <td className="py-1 text-right tabular-nums">{r.cantidad_necesaria} {r.unidad}</td>
                        <td className="py-1 text-right tabular-nums">{r.cantidad_compra} {r.unidad}</td>
                        <td className="py-1 text-right tabular-nums">{r.envases} × {r.unidad_compra}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Visual cascade summary */}
        <div className="mt-4 bg-gray-50 rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-[11px] font-bold text-gray-500 tracking-wider mb-3">CASCADA DE CÁLCULO</div>
          <div className="space-y-1.5 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              <span>Costo Directo (MAT + MO)</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-[#E8663C] font-medium">Indirectos ({subtotalIndirectosPct.toFixed(1)}%)</span>
              <span className="text-gray-400">= Subtotal 02</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-amber-600 font-medium">Beneficio ({(cfg.beneficio_pct ?? 25).toFixed(1)}%)</span>
              <span className="text-gray-400">= Subtotal 03</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-rose-600 font-medium">
                Impuestos ({((cfg.ingresos_brutos_pct ?? 7) + (cfg.imp_cheque_pct ?? 1.2)).toFixed(1)}%)
              </span>
              <span className="text-gray-400">= Neto</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-[#143D34] font-medium">IVA ({(cfg.iva_pct ?? 21).toFixed(1)}%)</span>
              <span className="text-gray-400">= Total Final</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
