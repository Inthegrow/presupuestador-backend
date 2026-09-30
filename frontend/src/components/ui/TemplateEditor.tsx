import { useEffect, useState } from 'react'
import { X, Plus, Trash2, FlaskConical, AlertTriangle } from 'lucide-react'
import { templateApi } from '../../lib/api'
import type { Template, TemplateParam, TemplatePreviewRow, TemplateResource } from '../../types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TIPOS: { value: TemplateResource['tipo']; label: string }[] = [
  { value: 'material', label: 'Material' },
  { value: 'mano_obra', label: 'Mano de obra' },
  { value: 'equipo', label: 'Equipo' },
  { value: 'mo_material', label: 'Mat. indirecto' },
  { value: 'subcontrato', label: 'Subcontrato' },
]

const ORIGEN_LABEL: Record<string, string> = {
  recurso: 'propio',
  presupuesto: 'del presupuesto',
  plantilla: 'de la plantilla',
  organizacion: 'general',
}

/** Text from an input -> number, or null when empty. Accepts decimal comma. */
function toNum(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const s = String(text).trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function parseList<T>(value: T[] | string | undefined): T[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return value || []
}

/** Old resources had cantidad_por_unidad: show it as a formula. */
function toEditable(r: TemplateResource): TemplateResource {
  if (r.tipo !== 'mano_obra' && !r.formula && r.cantidad_por_unidad !== undefined && r.cantidad_por_unidad !== null) {
    const { cantidad_por_unidad, ...rest } = r
    return { ...rest, formula: `Q * ${cantidad_por_unidad}` }
  }
  return r
}

/** Clean a resource before saving: numbers as numbers, empty = missing (inherit). */
function toSave(r: TemplateResource): TemplateResource {
  const out: Record<string, unknown> = { ...r }
  for (const key of ['desperdicio_pct', 'trabajadores', 'cargas_sociales_pct', 'unidad_compra'] as const) {
    const n = toNum(r[key] as string | number | undefined)
    if (n === null) delete out[key]
    else out[key] = n
  }
  const rend = str(r.rendimiento).trim()
  if (rend === '') delete out.rendimiento
  else out.rendimiento = toNum(rend) ?? rend
  if (!str(r.formula).trim()) delete out.formula
  if (!r.redondear) delete out.unidad_compra
  return out as unknown as TemplateResource
}

function errorList(err: unknown): string[] {
  const msg = err instanceof Error ? err.message : String(err)
  const body = msg.replace(/^\d+:\s*/, '')
  try {
    const detail = JSON.parse(body).detail
    if (Array.isArray(detail)) {
      return detail.map((d) => (typeof d === 'string' ? d : d.msg || JSON.stringify(d)))
    }
    if (typeof detail === 'string') return [detail]
  } catch {
    /* not JSON */
  }
  return [msg]
}

const inputBase =
  'px-2 py-1 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20'
const inputCls = `w-full ${inputBase}`

// ─── Editor ────────────────────────────────────────────────────────────────────

export default function TemplateEditor({
  template,
  onSaved,
  onClose,
}: {
  template: Template | null // null = new template
  onSaved: (t: Template) => void
  onClose: () => void
}) {
  const [nombre, setNombre] = useState(template?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(template?.descripcion ?? '')
  const [unidad, setUnidad] = useState(template?.unidad ?? '')
  const [categoria, setCategoria] = useState(template?.categoria ?? '')
  const [desperdicio, setDesperdicio] = useState(str(template?.desperdicio_pct))
  const [params, setParams] = useState<TemplateParam[]>(parseList(template?.parametros))
  const [recursos, setRecursos] = useState<TemplateResource[]>(
    parseList(template?.recursos).map(toEditable),
  )

  // Try-out panel
  const [q, setQ] = useState('10')
  const [preview, setPreview] = useState<TemplatePreviewRow[]>([])
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [orgWaste, setOrgWaste] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  const cleanParams = params
    .filter((p) => p.clave.trim())
    .map((p) => ({ ...p, clave: p.clave.trim(), valor: toNum(p.valor) ?? 0 }))

  // Live preview (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      templateApi
        .preview({
          cantidad: toNum(q) ?? 0,
          recursos: recursos.map(toSave),
          parametros: cleanParams,
          desperdicio_pct: toNum(desperdicio),
        })
        .then((res) => {
          setPreview(res.recursos || [])
          setPreviewErrors(res.errores || [])
          if (res.desperdicio_organizacion !== undefined) setOrgWaste(res.desperdicio_organizacion)
        })
        .catch((err) => setPreviewErrors(errorList(err)))
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, JSON.stringify(recursos), JSON.stringify(params), desperdicio])

  function setParam(i: number, patch: Partial<TemplateParam>) {
    setParams((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }

  function setRecurso(i: number, patch: Partial<TemplateResource>) {
    setRecursos((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function handleSave() {
    if (!nombre.trim()) {
      setSaveErrors(['Falta el nombre'])
      return
    }
    setSaving(true)
    setSaveErrors([])
    const body = {
      nombre: nombre.trim(),
      descripcion: descripcion || null,
      unidad: unidad || null,
      categoria: categoria || null,
      desperdicio_pct: toNum(desperdicio),
      parametros: cleanParams,
      recursos: recursos.map(toSave),
    }
    try {
      const saved = template ? await templateApi.update(template.id, body) : await templateApi.create(body)
      onSaved(saved as Template)
    } catch (err) {
      setSaveErrors(errorList(err))
      setSaving(false)
    }
  }

  const inheritedLabel = orgWaste === null || orgWaste === undefined ? '0' : String(orgWaste)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl mx-4 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#E8F5EE] px-5 py-4 flex items-center justify-between border-b border-[#C3E5D3] flex-shrink-0">
          <span className="font-bold text-[#143D34] text-base">
            {template ? 'Editar plantilla' : 'Nueva plantilla'}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#C3E5D3] text-[#2D8D68]">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Datos */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="col-span-2 text-xs text-gray-500">
              Nombre
              <input className={inputCls} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="text-xs text-gray-500">
              Unidad (Q)
              <input className={inputCls} value={unidad} placeholder="m2" onChange={(e) => setUnidad(e.target.value)} />
            </label>
            <label className="text-xs text-gray-500">
              Categoría
              <input className={inputCls} value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            </label>
            <label className="text-xs text-gray-500">
              Desperdicio %
              <input
                className={inputCls}
                value={desperdicio}
                placeholder={`hereda ${inheritedLabel}`}
                onChange={(e) => setDesperdicio(e.target.value)}
              />
            </label>
            <label className="col-span-2 md:col-span-5 text-xs text-gray-500">
              Descripción
              <input className={inputCls} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            </label>
          </div>

          {/* Parámetros */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-[#1B5E4B] tracking-wide">PARÁMETROS</h3>
              <button
                onClick={() => setParams([...params, { clave: '', valor: 0 }])}
                className="text-xs text-[#2D8D68] hover:underline flex items-center gap-1"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mb-2">
              Valores por defecto. Se pueden cambiar en cada presupuesto. Úsalos en las fórmulas por su nombre.
            </p>
            {params.length === 0 && <p className="text-xs text-gray-400 italic">Sin parámetros.</p>}
            <div className="space-y-1.5">
              {params.map((p, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input className={`${inputCls} col-span-3 font-mono`} placeholder="espesor" value={p.clave}
                    onChange={(e) => setParam(i, { clave: e.target.value })} />
                  <input className={`${inputCls} col-span-2 text-right`} placeholder="0.20" value={str(p.valor)}
                    onChange={(e) => setParam(i, { valor: e.target.value })} />
                  <input className={`${inputCls} col-span-2`} placeholder="m" value={p.unidad ?? ''}
                    onChange={(e) => setParam(i, { unidad: e.target.value })} />
                  <input className={`${inputCls} col-span-4`} placeholder="Descripción" value={p.descripcion ?? ''}
                    onChange={(e) => setParam(i, { descripcion: e.target.value })} />
                  <button onClick={() => setParams(params.filter((_, j) => j !== i))}
                    className="col-span-1 text-gray-400 hover:text-red-600 justify-self-center">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Recursos */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-[#1B5E4B] tracking-wide">RECURSOS</h3>
              <button
                onClick={() => setRecursos([...recursos, { tipo: 'material', formula: 'Q' }])}
                className="text-xs text-[#2D8D68] hover:underline flex items-center gap-1"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mb-2">
              Fórmula: <span className="font-mono">Q</span> es la cantidad del ítem. Se permiten números,
              <span className="font-mono"> + - * / ( )</span> y parámetros. Mano de obra: días = Q / rendimiento.
              Desperdicio vacío = hereda.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                    <th className="px-2 py-1.5 text-left font-medium">Código</th>
                    <th className="px-2 py-1.5 text-left font-medium">Descripción</th>
                    <th className="px-2 py-1.5 text-left font-medium">Unidad</th>
                    <th className="px-2 py-1.5 text-left font-medium">Fórmula / Rendimiento</th>
                    <th className="px-2 py-1.5 text-right font-medium">Desp. %</th>
                    <th className="px-2 py-1.5 text-center font-medium" title="Lo compra el cliente">Cliente</th>
                    <th className="px-2 py-1.5 text-center font-medium" title="Redondear a unidad de compra">Redondeo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recursos.map((r, i) => {
                    const mo = r.tipo === 'mano_obra'
                    const legacyMo = mo && !str(r.rendimiento) && r.trabajadores_por_unidad !== undefined
                    return (
                      <tr key={i} className="border-b last:border-0 align-top">
                        <td className="px-1 py-1 w-36">
                          <select className={inputCls} value={r.tipo}
                            onChange={(e) => setRecurso(i, { tipo: e.target.value as TemplateResource['tipo'] })}>
                            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1 w-24">
                          <input className={`${inputCls} font-mono`} value={r.codigo ?? ''}
                            onChange={(e) => setRecurso(i, { codigo: e.target.value })} />
                        </td>
                        <td className="px-1 py-1">
                          <input className={inputCls} value={r.descripcion ?? ''}
                            onChange={(e) => setRecurso(i, { descripcion: e.target.value })} />
                        </td>
                        <td className="px-1 py-1 w-16">
                          {mo ? <span className="text-gray-400 px-2">jornal</span> : (
                            <input className={inputCls} value={r.unidad ?? ''}
                              onChange={(e) => setRecurso(i, { unidad: e.target.value })} />
                          )}
                        </td>
                        <td className="px-1 py-1 w-56">
                          {mo ? (
                            <div className="flex gap-1 items-center">
                              <input className={`${inputBase} w-12 text-right`} title="Trabajadores" placeholder="1"
                                value={str(r.trabajadores)} onChange={(e) => setRecurso(i, { trabajadores: e.target.value })} />
                              <span className="text-gray-400 whitespace-nowrap">trab ·</span>
                              <input className={`${inputCls} font-mono`} title="Rendimiento (unidades por día)" placeholder="rend./día"
                                value={str(r.rendimiento)} onChange={(e) => setRecurso(i, { rendimiento: e.target.value })} />
                            </div>
                          ) : (
                            <input className={`${inputCls} font-mono`} placeholder="Q * espesor" value={r.formula ?? ''}
                              onChange={(e) => setRecurso(i, { formula: e.target.value })} />
                          )}
                          {legacyMo && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              Formato anterior: {r.trabajadores_por_unidad} trab/u × {r.dias_por_unidad} días. Cargá un rendimiento.
                            </p>
                          )}
                        </td>
                        <td className="px-1 py-1 w-20">
                          {!mo && (
                            <input className={`${inputCls} text-right`} placeholder="hereda" value={str(r.desperdicio_pct)}
                              onChange={(e) => setRecurso(i, { desperdicio_pct: e.target.value })} />
                          )}
                        </td>
                        <td className="px-1 py-1 text-center">
                          {!mo && (
                            <input type="checkbox" checked={!!r.lo_compra_cliente}
                              onChange={(e) => setRecurso(i, { lo_compra_cliente: e.target.checked })} />
                          )}
                        </td>
                        <td className="px-1 py-1 w-24">
                          {!mo && (
                            <div className="flex items-center gap-1">
                              <input type="checkbox" checked={!!r.redondear}
                                onChange={(e) => setRecurso(i, { redondear: e.target.checked })} />
                              {r.redondear && (
                                <input className={`${inputCls} text-right`} title="Tamaño de la unidad de compra (ej. 50 kg por bolsa)"
                                  placeholder="1" value={str(r.unidad_compra)}
                                  onChange={(e) => setRecurso(i, { unidad_compra: e.target.value })} />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <button onClick={() => setRecursos(recursos.filter((_, j) => j !== i))}
                            className="text-gray-400 hover:text-red-600 p-1">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Prueba */}
          <section className="bg-gray-50 rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-3 mb-3">
              <FlaskConical size={14} className="text-[#2D8D68]" />
              <h3 className="text-xs font-bold text-[#1B5E4B] tracking-wide">PROBAR</h3>
              <label className="text-xs text-gray-500 flex items-center gap-1 whitespace-nowrap">
                Q =
                <input className={`${inputBase} w-20 text-right`} value={q} onChange={(e) => setQ(e.target.value)} />
                {unidad}
              </label>
            </div>
            {previewErrors.length > 0 ? (
              <ul className="text-xs text-red-700 space-y-0.5">
                {previewErrors.map((e, i) => (
                  <li key={i} className="flex gap-1"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> {e}</li>
                ))}
              </ul>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="text-gray-500">
                  <tr>
                    <th className="text-left font-medium py-1">Recurso</th>
                    <th className="text-right font-medium py-1">Cantidad</th>
                    <th className="text-right font-medium py-1">Desperdicio</th>
                    <th className="text-right font-medium py-1">Cant. efectiva</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-gray-200">
                      <td className="py-1">{row.codigo || row.descripcion || '—'}</td>
                      <td className="py-1 text-right tabular-nums">
                        {row.tipo === 'mano_obra'
                          ? `${row.trabajadores} trab × ${row.dias} días`
                          : `${row.cantidad} ${row.unidad || ''}`}
                      </td>
                      <td className="py-1 text-right text-gray-500">
                        {row.tipo === 'mano_obra' ? '—' : `${row.desperdicio_pct}% (${ORIGEN_LABEL[row.desperdicio_origen ?? ''] ?? ''})`}
                      </td>
                      <td className="py-1 text-right tabular-nums font-medium">{row.cantidad_efectiva}</td>
                      <td className="py-1 pl-2 space-x-1">
                        {row.lo_compra_cliente && <span className="bg-amber-100 text-amber-700 rounded px-1.5">cliente</span>}
                        {row.redondear && <span className="bg-blue-100 text-blue-700 rounded px-1.5">redondea x {row.unidad_compra}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-gray-400 mt-2">
              El redondeo a unidad de compra se aplica al recalcular la obra, sobre el total de todos los ítems.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-between gap-3 flex-shrink-0">
          <ul className="text-xs text-red-700 flex-1">
            {saveErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <button onClick={onClose} className="text-sm text-gray-500 px-4 py-2 hover:bg-gray-100 rounded-xl">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-6 py-2 rounded-xl text-sm"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
