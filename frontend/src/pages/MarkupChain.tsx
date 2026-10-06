import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle, Settings } from 'lucide-react'
import { budgetApi, mensajeDeError } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { INDIRECTOS_DEFECTO, cascadaIndirectos, fmtPct, indirectosCompletos, pctIndirectos } from '../lib/cascada'
import { fmtNumber } from '../lib/format'
import type { CascadeResult, IndirectConfig } from '../types'

// Solo para tener la forma mientras carga: nunca se guarda sin haber leído los valores reales (ver `cargaFallo`)
const DEFAULT_CONFIG: IndirectConfig = { id: '', org_id: '', ...INDIRECTOS_DEFECTO }

/** Presupuestos que cambian de precio con los generales nuevos (lo que contesta /indirects/general/afectados) */
interface Afectado {
  id: string
  nombre: string
}

function listaNombres(ps: Afectado[], max = 5): string {
  const nombres = ps.slice(0, max).map((p) => p.nombre || 'Sin nombre')
  if (ps.length > max) return `${nombres.join(', ')} y ${ps.length - max} más`
  return nombres.join(', ')
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
  { key: 'ingresos_brutos_pct', label: 'Ingresos Brutos', hint: 'sobre el subtotal con beneficio' },
  { key: 'imp_cheque_pct', label: 'Impuesto al Cheque', hint: 'sobre el subtotal con beneficio' },
]

function PctInput({
  value,
  onChange,
  readOnly = false,
}: {
  value: number
  onChange: (v: number) => void
  readOnly?: boolean
}) {
  if (readOnly) {
    return (
      <div className="flex items-center gap-1">
        <span className="w-16 text-right px-2 py-1 text-sm font-semibold text-gray-800 tabular-nums">{value}</span>
        <span className="text-sm text-gray-500 font-medium">%</span>
      </div>
    )
  }
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
  const { puedeEditar, esAdmin } = useAuth()
  // The route is /app/settings/markups?budget=<id> (older links used :id)
  const params = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const id = params.id ?? searchParams.get('budget') ?? undefined
  // Misma regla que el botón Guardar: con presupuesto edita quien carga; sin presupuesto (generales), solo admin
  const puedeGuardar = id ? puedeEditar : esAdmin
  const [cfg, setCfg] = useState<IndirectConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  // Lo que pasó al guardar: "Listo: …" en verde o el error en rojo
  const [saveMsg, setSaveMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  // Guardar los generales cambia el precio de otros presupuestos: primero se pregunta
  const [confirmar, setConfirmar] = useState<Afectado[] | null>(null)
  const [loading, setLoading] = useState(true)
  // No se pudieron leer los % guardados: no se deja guardar (se guardarían valores inventados)
  const [cargaFallo, setCargaFallo] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
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
    setLoading(true)
    setCargaFallo(null)
    if (id) {
      budgetApi
        .get(id)
        .then((b) => setBudgetWaste(b.desperdicio_pct === null || b.desperdicio_pct === undefined ? '' : String(b.desperdicio_pct)))
        .catch(() => {/* ignore */})
    }
    // With a budget: its own % (they start as the general ones). Without: the general ones.
    ;(id ? budgetApi.getIndirects(id) : budgetApi.getGeneralIndirects())
      .then((data) => {
        if (!data || typeof data !== 'object') throw new Error('El servidor no mandó los porcentajes')
        // Lo que falte o venga vacío vale lo mismo que en la cuenta del servidor (INDIRECT_DEFAULTS)
        setCfg({ ...DEFAULT_CONFIG, ...data, ...indirectosCompletos(data) })
        setGeneral(data.general ?? null)
        setOrgWaste(data.desperdicio_pct === null || data.desperdicio_pct === undefined ? '' : String(data.desperdicio_pct))
      })
      .catch((err) => setCargaFallo(mensajeDeError(err, 'No pude leer los porcentajes guardados.')))
      .finally(() => setLoading(false))
  }, [id, intento])

  function set(key: keyof IndirectConfig, val: number) {
    setCfg((prev) => ({ ...prev, [key]: val }))
  }

  function cuerpo() {
    return {
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
  }

  // Lo que se manda a los generales (sin presupuesto: con el desperdicio general; desde una obra: solo los %)
  function cuerpoGeneral() {
    return id ? cuerpo() : { ...cuerpo(), desperdicio_pct: wasteNum(orgWaste) ?? 0 }
  }

  const tocaGenerales = !id || alsoGeneral

  /** Guardar: si cambian los generales, antes se pregunta qué presupuestos cambian de precio. */
  async function handleSave() {
    if (cargaFallo || loading || saving) return
    setSaveMsg(null)
    setConfirmar(null)
    if (tocaGenerales) {
      setSaving(true)
      try {
        const r = await budgetApi.generalAfectados(cuerpoGeneral())
        // Esta obra pasa a tener sus propios %: no cuenta entre las que cambian por los generales
        const lista = (Array.isArray(r?.presupuestos) ? r.presupuestos : []).filter((p) => p.id !== id)
        if (lista.length > 0) {
          setConfirmar(lista)
          setSaving(false)
          return
        }
      } catch (err) {
        setSaveMsg({ tipo: 'error', texto: `No guardé nada: no pude ver qué presupuestos cambian. ${mensajeDeError(err)}` })
        setSaving(false)
        return
      }
    }
    await guardar()
  }

  async function guardar() {
    setSaving(true)
    setConfirmar(null)
    setSaveMsg(null)
    const partes: string[] = []
    // Generales sin ningún presupuesto que los siga: se explica la regla en vez de un "Listo" vacío
    let sinAfectados = false
    try {
      if (id) {
        // Los % de esta obra: el servidor la recalcula al guardar
        const data = await budgetApi.updateIndirects(id, { ...cuerpo(), desperdicio_pct: wasteNum(orgWaste) ?? 0 })
        setGeneral(data.general ?? null)
        // null = this budget inherits the general / template value
        await budgetApi.update(id, { desperdicio_pct: wasteNum(budgetWaste) })
        partes.push('precios actualizados')
      }
      if (tocaGenerales) {
        const data = await budgetApi.updateGeneralIndirects({ ...cuerpoGeneral(), aplicar: true })
        if (id) setGeneral(data)
        const n = typeof data?.actualizados === 'number' ? data.actualizados : 0
        if (n === 0) {
          if (id) partes.push('valores generales guardados')
          else sinAfectados = true
        } else {
          partes.push(`${n} ${n === 1 ? 'presupuesto actualizado' : 'presupuestos actualizados'}`)
        }
      }
      setSaveMsg({
        tipo: 'ok',
        texto: sinAfectados
          ? 'Guardado. Los presupuestos nuevos van a usar estos porcentajes. Los que ya estaban creados guardan los suyos y no cambian: para cambiar uno, entrá a su Coeficiente de pase.'
          : `Listo: ${partes.join('; ')}.`,
      })
    } catch (err) {
      const hecho = partes.length > 0 ? ` (sí se guardó: ${partes.join('; ')})` : ''
      setSaveMsg({ tipo: 'error', texto: `No se pudo guardar${hecho}. ${mensajeDeError(err)}` })
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
      setRecalcError(mensajeDeError(err, 'No se pudo recalcular. Probá de nuevo.'))
    }
    setRecalculating(false)
  }

  // Los 5 conceptos, con la misma cuenta que el resto de la app
  const subtotalIndirectosPct = pctIndirectos(cfg)

  // Por cada $100 de costo directo, el precio sin IVA (misma cuenta que la cascada del servidor)
  const precioPor100 = cascadaIndirectos(100, indirectosCompletos(cfg)).neto

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Settings size={14} /> CONFIGURACIÓN
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">COEFICIENTE DE PASE</h1>
      </div>
      <p className="text-gray-700 text-sm mb-1 ml-4 max-w-2xl">
        Lo que se le suma al costo directo para llegar al precio: indirectos, beneficio e impuestos. Por cada $100 de
        costo directo, el precio sin IVA es ${fmtNumber(precioPor100)}.
      </p>
      <p className="text-gray-500 text-sm mb-6 ml-4">
        {id
          ? 'Porcentajes de esta obra. Arrancan con los valores generales; cambiarlos acá no toca las otras obras. Al guardar, los precios de esta obra se actualizan solos.'
          : 'Los valores generales: con estos arranca cada presupuesto nuevo.'}
      </p>

      {cargaFallo && (
        <div role="alert" data-testid="carga-fallo" className="max-w-lg mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">No pude leer los porcentajes guardados</p>
              <p className="text-xs mt-1">
                Hasta leerlos no se puede guardar: se guardarían valores que no son los tuyos. {cargaFallo}
              </p>
              <button
                onClick={() => setIntento((n) => n + 1)}
                className="mt-2 text-xs font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100"
              >
                Probar de nuevo
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      )}

      <div className="max-w-lg">
        {!cargaFallo && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-[#E8F5EE] px-6 py-4 border-b border-[#2D8D68]/20">
            <h2 className="text-[#143D34] font-bold text-base">Parámetros de costos</h2>
            <p className="text-[#2D8D68] text-xs mt-0.5">
              Costo directo → + Indirectos → + Beneficio → + Impuestos = Precio sin IVA → + IVA = Precio con IVA
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
                    readOnly={!puedeGuardar}
                  />
                </div>
              ))}
            </div>
            {/* Subtotal indirectos */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed border-gray-200">
              <span className="text-sm font-semibold text-gray-600">Subtotal Indirectos:</span>
              <span className="text-sm font-bold text-[#E8663C]">{fmtPct(subtotalIndirectosPct)} %</span>
            </div>

            {/* ── BENEFICIO ── */}
            <SectionDivider label="Beneficio" />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-700">Beneficio</span>
                <span className="ml-2 text-[11px] text-gray-400">(sobre el subtotal con indirectos)</span>
              </div>
              <PctInput
                value={cfg.beneficio_pct ?? INDIRECTOS_DEFECTO.beneficio_pct}
                onChange={(v) => set('beneficio_pct', v)}
                readOnly={!puedeGuardar}
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
                    readOnly={!puedeGuardar}
                  />
                </div>
              ))}
            </div>

            {/* ── IVA ── */}
            <SectionDivider label="IVA" />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-700">IVA</span>
                <span className="ml-2 text-[11px] text-gray-400">(sobre el precio sin IVA)</span>
              </div>
              <PctInput
                value={cfg.iva_pct ?? 21}
                onChange={(v) => set('iva_pct', v)}
                readOnly={!puedeGuardar}
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
                  {puedeGuardar ? (
                  <input
                    value={orgWaste}
                    placeholder="0"
                    onChange={(e) => setOrgWaste(e.target.value)}
                    className="w-16 text-right px-2 py-1 text-sm font-semibold border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] tabular-nums"
                  />
                  ) : (
                    <span className="w-16 text-right px-2 py-1 text-sm font-semibold text-gray-800 tabular-nums">{orgWaste || '—'}</span>
                  )}
                  <span className="text-sm text-gray-500 font-medium">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-700">Este presupuesto</span>
                  <span className="ml-2 text-[11px] text-gray-400">(vacío = hereda fórmula / general)</span>
                </div>
                <div className="flex items-center gap-1">
                  {puedeGuardar ? (
                  <input
                    value={budgetWaste}
                    placeholder={orgWaste || '0'}
                    onChange={(e) => setBudgetWaste(e.target.value)}
                    className="w-16 text-right px-2 py-1 text-sm font-semibold border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] tabular-nums"
                  />
                  ) : (
                    <span className="w-16 text-right px-2 py-1 text-sm font-semibold text-gray-800 tabular-nums">{budgetWaste || '—'}</span>
                  )}
                  <span className="text-sm text-gray-500 font-medium">%</span>
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                Orden: recurso → presupuesto → fórmula → general. Se aplica al recalcular la obra.
              </p>
            </div>

            {/* La regla, antes de guardar los generales */}
            {!id && puedeGuardar && (
              <p className="mt-5 text-[11px] text-gray-500" data-testid="regla-generales">
                Cada presupuesto guarda los porcentajes con los que se creó. Cambiar estos solo toca los presupuestos
                nuevos y los que todavía siguen los generales; antes de guardar te digo cuáles.
              </p>
            )}

            {/* Save */}
            <div className={`${!id && puedeGuardar ? 'mt-3' : 'mt-6'} flex items-center justify-end gap-x-4 gap-y-2 flex-wrap`}>
              {id && esAdmin && (
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={alsoGeneral} onChange={(e) => setAlsoGeneral(e.target.checked)} />
                  Usar también como valores generales
                </label>
              )}
              {puedeGuardar && (
              <button
                onClick={handleSave}
                disabled={saving || loading || !!confirmar}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                {saving && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              )}
            </div>

            {/* Antes de cambiar el precio de otros presupuestos, se pregunta (en la página, no en una ventanita) */}
            {confirmar && (
              <div role="alertdialog" aria-labelledby="confirmar-titulo" data-testid="confirmar-afectados" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                <p id="confirmar-titulo" className="text-sm text-amber-900">
                  Esto cambia el precio de{' '}
                  <strong>{confirmar.length} {confirmar.length === 1 ? 'presupuesto' : 'presupuestos'}</strong> que{' '}
                  {confirmar.length === 1 ? 'usa' : 'usan'} estos porcentajes: {listaNombres(confirmar)}. ¿Seguir?
                </p>
                <p className="text-[11px] text-amber-800/80 mt-1">
                  Los presupuestos con porcentajes propios no cambian.
                </p>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <button
                    autoFocus
                    onClick={() => void guardar()}
                    className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2 rounded-xl text-sm"
                  >
                    Seguir
                  </button>
                  <button
                    onClick={() => setConfirmar(null)}
                    className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium px-5 py-2 rounded-xl text-sm"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {saveMsg && (
              <div
                role={saveMsg.tipo === 'error' ? 'alert' : 'status'}
                data-testid="resultado-guardar"
                className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
                  saveMsg.tipo === 'ok'
                    ? 'bg-[#E8F5EE] text-[#1B5E4B] border border-[#2D8D68]/20'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {saveMsg.tipo === 'ok'
                  ? <CheckCircle size={16} className="flex-shrink-0 mt-0.5 text-[#2D8D68]" />
                  : <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />}
                <span>{saveMsg.texto}</span>
              </div>
            )}
          </div>
        </div>}

        {/* Recalculate the whole budget (solo con una obra abierta) */}
        {puedeEditar && id && (
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
        )}

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
              <span className="text-[#E8663C] font-medium">Indirectos ({fmtPct(subtotalIndirectosPct)}%)</span>
              <span className="text-gray-400">= Subtotal 02</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-amber-600 font-medium">Beneficio ({fmtPct(cfg.beneficio_pct ?? INDIRECTOS_DEFECTO.beneficio_pct)}%)</span>
              <span className="text-gray-400">= Subtotal 03</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-rose-600 font-medium">
                Impuestos ({fmtPct((cfg.ingresos_brutos_pct ?? 7) + (cfg.imp_cheque_pct ?? 1.2))}%)
              </span>
              <span className="text-gray-400">= Precio sin IVA</span>
            </div>
            <div className="flex items-center gap-2 ml-3">
              <span className="text-gray-300">+</span>
              <span className="text-[#143D34] font-medium">IVA ({fmtPct(cfg.iva_pct ?? 21)}%)</span>
              <span className="text-gray-400">= Precio con IVA</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
