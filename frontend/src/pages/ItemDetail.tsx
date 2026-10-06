import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ChevronRight,
  ChevronDown,
  ClipboardList,
  History,
  Pencil,
  Upload,
  Cpu,
  BookOpen,
  Calculator,
  Check,
  X,
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  Library,
  AlertTriangle,
} from 'lucide-react'
import { budgetApi, templateApi, esFaltaConversion, esConfirmarReemplazo } from '../lib/api'
import type { FaltaConversion, PrecioFaltante } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { fmtCurrency, fmtNumber, fmtPercent } from '../lib/format'
import type { ItemResource, BudgetItem, Budget, ItemAudit, IndirectConfig } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

type Tipo = ItemResource['tipo']

const TIPO_LABELS: Record<Tipo, string> = {
  material: 'Materiales',
  mano_obra: 'Mano de Obra - Personas',
  equipo: 'Mano de Obra - Equipos',
  mo_material: 'Materiales Indirectos',
  subcontrato: 'Subcontratos',
}

const TIPO_SECTIONS: Tipo[] = ['material', 'mano_obra', 'equipo', 'mo_material', 'subcontrato']

const FIELD_LABELS: Record<string, string> = {
  cantidad: 'Cantidad',
  mat_unitario: 'MAT Unitario',
  mo_unitario: 'MO Unitario',
  description: 'Descripcion',
  unidad: 'Unidad',
  code: 'Codigo',
  notas_calculo: 'Memoria de Calculo',
}

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Pencil; color: string }> = {
  manual_edit: { label: 'Edicion manual', icon: Pencil, color: 'text-blue-600' },
  ai_suggestion: { label: 'Sugerencia IA', icon: Cpu, color: 'text-purple-600' },
  excel_import: { label: 'Importacion Excel', icon: Upload, color: 'text-green-600' },
  catalog_update: { label: 'Lista de precios', icon: BookOpen, color: 'text-orange-600' },
}

const fmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})
const fmtARS = (v: number | null | undefined) => fmt.format(v ?? 0)

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORIGEN_LABEL: Record<string, string> = {
  presupuesto: 'presupuesto',
  plantilla: 'fórmula',
  organizacion: 'general',
}

function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)
  if (diffMin < 1) return 'hace un momento'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffHr < 24) return `hace ${diffHr}h`
  if (diffDays < 7) return `hace ${diffDays}d`
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function emptyResource(tipo: Tipo, itemId: string): Partial<ItemResource> {
  return {
    tipo,
    item_id: itemId,
    codigo: null,
    descripcion: null,
    unidad: tipo === 'mano_obra' ? 'jornal' : null,
    cantidad: 0,
    desperdicio_pct: 0,
    precio_unitario: 0,
    trabajadores: tipo === 'mano_obra' ? 1 : 0,
    dias: tipo === 'mano_obra' ? 1 : 0,
    cargas_sociales_pct: tipo === 'mano_obra' ? 25 : 0,
    catalog_entry_id: null,
  }
}

// ─── ResourceRow ──────────────────────────────────────────────────────────────

interface ResourceRowProps {
  resource: ItemResource
  tipo: Tipo
  onSave: (id: string, data: Partial<ItemResource>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  startEditing: boolean
  onEditDone: () => void
}

function ResourceRow({ resource, tipo, onSave, onDelete, startEditing, onEditDone }: ResourceRowProps) {
  const { puedeEditar } = useAuth()
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState<Partial<ItemResource>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (startEditing) {
      setEditing(true)
      setDraft({ ...resource })
    }
  }, [startEditing, resource])

  const handleEdit = () => {
    setDraft({ ...resource })
    setEditing(true)
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft({})
    onEditDone()
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(resource.id, draft)
      setEditing(false)
      setDraft({})
      onEditDone()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este recurso?')) return
    setDeleting(true)
    try {
      await onDelete(resource.id)
    } finally {
      setDeleting(false)
    }
  }

  const set = (field: keyof ItemResource, value: string | number | null) =>
    setDraft((prev) => ({ ...prev, [field]: value }))

  const inputCls = 'w-full border border-[#2D8D68] rounded px-1.5 py-0.5 text-xs bg-white outline-none focus:ring-1 focus:ring-[#2D8D68]'
  const numCls = inputCls + ' text-right'

  if (editing && puedeEditar) {
    if (tipo === 'mano_obra') {
      return (
        <tr className="bg-[#E8F5EE]/40">
          <td className="px-2 py-1.5">
            <input className={inputCls} value={draft.codigo ?? ''} onChange={(e) => set('codigo', e.target.value || null)} placeholder="COD" />
          </td>
          <td className="px-2 py-1.5">
            <input className={inputCls} value={draft.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value || null)} placeholder="Descripcion" />
          </td>
          <td className="px-2 py-1.5">
            <input className={numCls} type="number" step="1" min="0" value={draft.trabajadores ?? 0} onChange={(e) => set('trabajadores', parseFloat(e.target.value) || 0)} />
          </td>
          <td className="px-2 py-1.5">
            <input className={numCls} type="number" step="1" min="0" value={draft.dias ?? 0} onChange={(e) => set('dias', parseFloat(e.target.value) || 0)} />
          </td>
          <td className="px-2 py-1.5">
            <input className={numCls} type="number" step="0.1" min="0" value={draft.cargas_sociales_pct ?? 25} onChange={(e) => set('cargas_sociales_pct', parseFloat(e.target.value) || 0)} />
          </td>
          <td className="px-2 py-1.5 text-right text-xs text-gray-400">—</td>
          <td className="px-2 py-1.5">
            <input className={numCls} type="number" step="1" min="0" value={draft.precio_unitario ?? 0} onChange={(e) => set('precio_unitario', parseFloat(e.target.value) || 0)} />
          </td>
          <td className="px-2 py-1.5 text-right text-xs text-gray-400">—</td>
          <td className="px-2 py-1.5">
            <div className="flex items-center gap-1 justify-center">
              <button disabled={saving} onClick={handleSave} className="p-1 bg-[#2D8D68] hover:bg-[#1E6B4E] text-white rounded disabled:opacity-50 transition-colors">
                <Save size={12} />
              </button>
              <button disabled={saving} onClick={handleCancel} className="p-1 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded transition-colors">
                <X size={12} />
              </button>
            </div>
          </td>
        </tr>
      )
    }

    return (
      <tr className="bg-[#E8F5EE]/40">
        <td className="px-2 py-1.5">
          <input className={inputCls} value={draft.codigo ?? ''} onChange={(e) => set('codigo', e.target.value || null)} placeholder="COD" />
        </td>
        <td className="px-2 py-1.5">
          <input className={inputCls} value={draft.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value || null)} placeholder="Descripcion" />
        </td>
        <td className="px-2 py-1.5">
          <input className={inputCls} value={draft.unidad ?? ''} onChange={(e) => set('unidad', e.target.value || null)} placeholder="m2" />
        </td>
        <td className="px-2 py-1.5">
          <input className={numCls} type="number" step="any" min="0" value={draft.cantidad ?? 0} onChange={(e) => set('cantidad', parseFloat(e.target.value) || 0)} />
        </td>
        <td className="px-2 py-1.5">
          <input className={numCls} type="number" step="0.1" min="0" value={draft.desperdicio_pct ?? 0} onChange={(e) => set('desperdicio_pct', parseFloat(e.target.value) || 0)} />
        </td>
        <td className="px-2 py-1.5 text-center">
          <label className="inline-flex items-center gap-1 text-[10px] text-gray-500" title="Lo compra el cliente: se ve pero no suma al costo">
            <input
              type="checkbox"
              checked={!!draft.lo_compra_cliente}
              onChange={(e) => setDraft((prev) => ({ ...prev, lo_compra_cliente: e.target.checked }))}
            />
            cliente
          </label>
        </td>
        <td className="px-2 py-1.5">
          <input className={numCls} type="number" step="1" min="0" value={draft.precio_unitario ?? 0} onChange={(e) => set('precio_unitario', parseFloat(e.target.value) || 0)} />
        </td>
        <td className="px-2 py-1.5 text-right text-xs text-gray-400">—</td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1 justify-center">
            <button disabled={saving} onClick={handleSave} className="p-1 bg-[#2D8D68] hover:bg-[#1E6B4E] text-white rounded disabled:opacity-50 transition-colors">
              <Save size={12} />
            </button>
            <button disabled={saving} onClick={handleCancel} className="p-1 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded transition-colors">
              <X size={12} />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  // Read mode
  if (tipo === 'mano_obra') {
    return (
      <tr className="border-b border-gray-100 hover:bg-[#E8F5EE]/20 transition-colors">
        <td className="px-3 py-1.5 font-mono text-[10px] text-gray-400">{resource.codigo ?? '—'}</td>
        <td className="px-3 py-1.5 text-gray-800">{resource.descripcion ?? '—'}</td>
        <td className="px-3 py-1.5 text-right text-gray-700">{fmtNumber(resource.trabajadores, 0)}</td>
        <td className="px-3 py-1.5 text-right text-gray-700">
          {fmtNumber(resource.dias, 2)}
          {resource.rendimiento && <div className="text-[9px] text-gray-400 font-mono">Q / {resource.rendimiento}</div>}
        </td>
        <td className="px-3 py-1.5 text-right text-orange-500">{fmtPercent(resource.cargas_sociales_pct)}</td>
        <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmtNumber(resource.cantidad_efectiva, 2)}</td>
        <td className="px-3 py-1.5 text-right text-gray-700">{fmtARS(resource.precio_unitario)}</td>
        <td className="px-3 py-1.5 text-right font-bold text-gray-900">{fmtARS(resource.subtotal)}</td>
        <td className="px-3 py-1.5">
          {puedeEditar && (
          <div className="flex items-center gap-1 justify-center">
            <button onClick={handleEdit} className="p-1 text-gray-300 hover:text-[#2D8D68] transition-colors rounded hover:bg-[#E8F5EE]">
              <Pencil size={12} />
            </button>
            <button disabled={deleting} onClick={handleDelete} className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded hover:bg-red-50 disabled:opacity-50">
              <Trash2 size={12} />
            </button>
          </div>
          )}
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-[#E8F5EE]/20 transition-colors">
      <td className="px-3 py-1.5 font-mono text-[10px] text-gray-400">{resource.codigo ?? '—'}</td>
      <td className="px-3 py-1.5 text-gray-800">
        {resource.descripcion ?? '—'}
        {resource.formula && (
          <span className="ml-1.5 font-mono text-[10px] text-gray-400" title="Cantidad (Q = cantidad del ítem)">= {resource.formula}</span>
        )}
        {resource.rendimiento && (
          <span className="ml-1.5 font-mono text-[10px] text-gray-400" title="Días = Q / rendimiento">días = Q / {resource.rendimiento}</span>
        )}
        {resource.lo_compra_cliente && (
          <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 rounded px-1.5" title="No suma al costo">lo compra el cliente</span>
        )}
        {resource.redondear && (
          <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 rounded px-1.5" title="Se redondea sobre el total de la obra">
            redondeo{resource.cantidad_redondeo ? ` +${fmtNumber(resource.cantidad_redondeo, 2)}` : ''}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-gray-500 text-[10px] uppercase">{resource.unidad ?? '—'}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{fmtNumber(resource.cantidad, 2)}</td>
      <td className="px-3 py-1.5 text-right text-orange-500">
        {fmtPercent(resource.desperdicio_pct)}
        {resource.desperdicio_origen && resource.desperdicio_origen !== 'recurso' && (
          <div className="text-[9px] text-gray-400">hereda {ORIGEN_LABEL[resource.desperdicio_origen]}</div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmtNumber(resource.cantidad_efectiva, 2)}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{fmtARS(resource.precio_unitario)}</td>
      <td className="px-3 py-1.5 text-right font-bold text-gray-900">{fmtARS(resource.subtotal)}</td>
      <td className="px-3 py-1.5">
        {puedeEditar && (
        <div className="flex items-center gap-1 justify-center">
          <button onClick={handleEdit} className="p-1 text-gray-300 hover:text-[#2D8D68] transition-colors rounded hover:bg-[#E8F5EE]">
            <Pencil size={12} />
          </button>
          <button disabled={deleting} onClick={handleDelete} className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded hover:bg-red-50 disabled:opacity-50">
            <Trash2 size={12} />
          </button>
        </div>
        )}
      </td>
    </tr>
  )
}

// ─── ResourceSection ──────────────────────────────────────────────────────────

interface SectionProps {
  tipo: Tipo
  recursos: ItemResource[]
  itemQty: number
  budgetId: string
  itemId: string
  onReload: () => void
}

function ResourceSection({ tipo, recursos, itemQty, budgetId, itemId, onReload }: SectionProps) {
  const { puedeEditar } = useAuth()
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newResource, setNewResource] = useState<Partial<ItemResource> | null>(null)
  const [newEditStarted, setNewEditStarted] = useState(false)

  const filtered = recursos.filter((r) => r.tipo === tipo)
  const total = filtered.reduce((s, r) => s + r.subtotal, 0)
  const unitPrice = itemQty > 0 ? total / itemQty : 0

  const handleSave = async (id: string, data: Partial<ItemResource>) => {
    await budgetApi.updateResource(budgetId, itemId, id, data)
    onReload()
  }

  const handleDelete = async (id: string) => {
    await budgetApi.deleteResource(budgetId, itemId, id)
    onReload()
  }

  const handleAddNew = () => {
    setNewResource(emptyResource(tipo, itemId))
    setAdding(true)
    setNewEditStarted(true)
  }

  const handleSaveNew = async (_id: string, data: Partial<ItemResource>) => {
    await budgetApi.createResource(budgetId, itemId, { ...data, tipo })
    setAdding(false)
    setNewResource(null)
    setNewEditStarted(false)
    onReload()
  }

  const handleCancelNew = () => {
    setAdding(false)
    setNewResource(null)
    setNewEditStarted(false)
  }

  const moHeaders = ['Codigo', 'Descripcion', 'Trabajadores', 'Dias', 'Cargas %', 'Jornales Efect.', 'Jornal', 'Subtotal', '']
  const matHeaders = ['Codigo', 'Descripcion', 'Unidad', 'Cantidad', 'Desperdicio %', 'Qty Efectiva', 'Precio Unit.', 'Subtotal', '']
  const headers = tipo === 'mano_obra' ? moHeaders : matHeaders

  const tipoUnitLabel =
    tipo === 'material' ? 'MAT'
    : tipo === 'mano_obra' ? 'MO'
    : tipo === 'equipo' ? 'EQ'
    : tipo === 'mo_material' ? 'Mat.Ind'
    : 'Sub'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-[#E8F5EE]/30 px-4 py-2.5 flex items-center gap-2 border-b hover:bg-[#E8F5EE]/60 transition-colors"
      >
        {open
          ? <ChevronDown size={14} className="text-[#2D8D68] flex-shrink-0" />
          : <ChevronRight size={14} className="text-[#2D8D68] flex-shrink-0" />}
        <span className="font-bold text-sm text-[#2D8D68]">{TIPO_LABELS[tipo]}</span>
        <span className="text-[10px] text-gray-400 ml-1">{filtered.length} recursos</span>
        {!open && total > 0 && (
          <span className="ml-auto text-sm font-bold text-[#143D34]">{fmtARS(total)}</span>
        )}
      </button>

      {open && (
        <>
          {filtered.length === 0 && !adding ? (
            <div className="p-6 text-center text-gray-400 text-sm italic">
              No hay recursos cargados. Agregá recursos para calcular el precio unitario.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#E8F5EE] text-[#143D34]">
                    {headers.map((h) => (
                      <th
                        key={h}
                        className={`px-3 py-2 text-[10px] uppercase font-semibold tracking-wide ${h === '' ? 'w-16' : h === 'Descripcion' ? 'text-left' : h === 'Codigo' ? 'text-left' : h === 'Unidad' ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <ResourceRow
                      key={r.id}
                      resource={r}
                      tipo={tipo}
                      onSave={handleSave}
                      onDelete={handleDelete}
                      startEditing={false}
                      onEditDone={() => {}}
                    />
                  ))}
                  {/* New resource row (inline) */}
                  {adding && newResource && (
                    <ResourceRow
                      key="__new__"
                      resource={{ ...emptyResource(tipo, itemId), id: '__new__', org_id: '', subtotal: 0, cantidad_efectiva: 0 } as ItemResource}
                      tipo={tipo}
                      onSave={handleSaveNew}
                      onDelete={async () => { handleCancelNew() }}
                      startEditing={newEditStarted}
                      onEditDone={handleCancelNew}
                    />
                  )}
                </tbody>
                {/* Footer with total */}
                <tfoot>
                  <tr className="bg-[#E8F5EE]">
                    <td colSpan={headers.length - 2} className="px-3 py-2 text-right text-[10px] font-bold text-[#1B5E4B] uppercase tracking-wide">
                      Total {TIPO_LABELS[tipo]}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-[#2D8D68]">
                      {fmtARS(total)}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                  {itemQty > 0 && (
                    <tr className="bg-[#E8F5EE]/60">
                      <td colSpan={headers.length} className="px-3 py-1.5 text-right text-[10px] text-[#1B5E4B]">
                        {fmtARS(total)} ÷ {fmtNumber(itemQty, 2)} =&nbsp;
                        <strong>Precio Unitario {tipoUnitLabel}: {fmtARS(unitPrice)}</strong>
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}

          {/* Add resource button */}
          {puedeEditar && (
          <div className="px-4 py-2 border-t">
            <button
              onClick={handleAddNew}
              disabled={adding}
              className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <Plus size={12} />
              Agregar recurso
            </button>
          </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── AuditHistory ─────────────────────────────────────────────────────────────

function AuditHistory({ audits, loading }: { audits: ItemAudit[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 p-4">
        <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
        Cargando historial...
      </div>
    )
  }

  if (audits.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400 text-sm">
        Sin cambios registrados para este item.
      </div>
    )
  }

  return (
    <div className="divide-y">
      {audits.map((audit) => {
        const config = SOURCE_CONFIG[audit.source] ?? SOURCE_CONFIG.manual_edit
        const Icon = config.icon
        const fieldLabel = FIELD_LABELS[audit.field] ?? audit.field

        return (
          <div key={audit.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
            <div className={`mt-0.5 p-1 rounded-full bg-gray-100 ${config.color}`}>
              <Icon size={12} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-800">
                <span className="font-medium">{fieldLabel}</span>
                {' cambio de '}
                <span className="font-mono bg-red-50 text-red-700 px-1 rounded text-[10px]">
                  {audit.old_value ?? '—'}
                </span>
                {' a '}
                <span className="font-mono bg-green-50 text-green-700 px-1 rounded text-[10px]">
                  {audit.new_value ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-gray-400">{timeAgo(audit.created_at)}</span>
                <span className={`text-[10px] ${config.color}`}>{config.label}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── GrandTotal ───────────────────────────────────────────────────────────────

interface GrandTotalProps {
  item: BudgetItem
  indirects: IndirectConfig | null
  recursos: ItemResource[]
}

function GrandTotal({ item, indirects, recursos }: GrandTotalProps) {
  const matTotal = recursos.filter((r) => r.tipo === 'material').reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const moTotal = recursos.filter((r) => r.tipo === 'mano_obra').reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const eqTotal = recursos.filter((r) => r.tipo === 'equipo').reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const matIndTotal = recursos.filter((r) => r.tipo === 'mo_material').reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const subTotal = recursos.filter((r) => r.tipo === 'subcontrato').reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const directo = matTotal + moTotal + eqTotal + matIndTotal + subTotal

  // Prefer item's calculated values if available, otherwise derive from indirects config
  const indirectoTotal = item.indirecto_total ?? 0
  const beneficioTotal = item.beneficio_total ?? 0
  const impuestosTotal = item.impuestos_total ?? 0
  const netoTotal = item.neto_total ?? 0
  const ivaTotal = item.iva_total ?? 0
  const totalFinal = item.total_final ?? 0

  const indirectoPct = indirects
    ? (indirects.estructura_pct || 0) + (indirects.jefatura_pct || 0) + (indirects.logistica_pct || 0) + (indirects.herramientas_pct || 0)
    : 0
  const beneficioPct = indirects?.beneficio_pct ?? 10
  const impuestosPct = (indirects?.ingresos_brutos_pct ?? 7) + (indirects?.imp_cheque_pct ?? 1.2)
  const ivaPct = indirects?.iva_pct ?? 21

  const Row = ({ label, value, sub, highlight }: { label: string; value: number; sub?: string; highlight?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 px-4 ${highlight ? 'bg-[#E8F5EE] rounded-lg' : ''}`}>
      <span className={`text-xs ${highlight ? 'font-bold text-[#143D34]' : 'text-gray-600'}`}>
        {label}
        {sub && <span className="ml-1 text-[10px] text-gray-400">({sub})</span>}
      </span>
      <span className={`font-bold tabular-nums ${highlight ? 'text-[#2D8D68] text-base' : 'text-xs text-gray-900'}`}>
        {fmtARS(value)}
      </span>
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-[#E8F5EE]/30 px-4 py-2.5 border-b flex items-center gap-2">
        <Calculator size={14} className="text-[#2D8D68]" />
        <span className="font-bold text-sm text-[#2D8D68]">Resumen de Costos</span>
      </div>
      <div className="py-2 space-y-0.5">
        {/* Resource breakdown */}
        {matTotal > 0 && <Row label="+ MAT (Materiales)" value={matTotal} />}
        {moTotal > 0 && <Row label="+ MO (Mano de Obra)" value={moTotal} />}
        {eqTotal > 0 && <Row label="+ EQ (Equipos)" value={eqTotal} />}
        {matIndTotal > 0 && <Row label="+ Mat.Ind (Materiales Indirectos)" value={matIndTotal} />}
        {subTotal > 0 && <Row label="+ Sub (Subcontratos)" value={subTotal} />}
        <div className="mx-4 my-1 border-t border-dashed border-gray-200" />
        <Row label="= Costo Directo" value={directo} />
        {indirectoTotal > 0 && <Row label="+ Indirectos" value={indirectoTotal} sub={`${indirectoPct.toFixed(1)}%`} />}
        {beneficioTotal > 0 && <Row label="+ Beneficio" value={beneficioTotal} sub={`${beneficioPct}%`} />}
        {impuestosTotal > 0 && <Row label="+ Impuestos" value={impuestosTotal} sub={`${impuestosPct.toFixed(1)}%`} />}
        {netoTotal > 0 && (
          <>
            <div className="mx-4 my-1 border-t border-dashed border-gray-200" />
            <Row label="= NETO" value={netoTotal} />
          </>
        )}
        {ivaTotal > 0 && <Row label="+ IVA" value={ivaTotal} sub={`${ivaPct}%`} />}
        {totalFinal > 0 && (
          <>
            <div className="mx-4 my-1 border-t-2 border-gray-300" />
            <Row label="= TOTAL FINAL" value={totalFinal} highlight />
          </>
        )}
        {/* Fallback if totals not calculated yet */}
        {netoTotal === 0 && directo > 0 && (
          <>
            <div className="mx-4 my-1 border-t-2 border-gray-300" />
            <div className="px-4 py-2 text-[10px] text-gray-400 italic">
              Los totales con indirectos y beneficio se calculan al recalcular el presupuesto.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── ItemParams ───────────────────────────────────────────────────────────────

/** Recipe parameters of this item (ej. espesor). Changing them recalculates the resources. */
function ItemParams({
  budgetId,
  item,
  onSaved,
}: {
  budgetId: string
  item: BudgetItem
  onSaved: () => void
}) {
  const { puedeEditar } = useAuth()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const params = item.parametros ?? {}

  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(item.parametros ?? {}).map(([k, v]) => [k, String(v)])))
  }, [item.parametros])

  const changed = Object.entries(draft).some(([k, v]) => String(params[k]) !== v)

  async function handleSave() {
    const values: Record<string, number> = {}
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v.trim().replace(',', '.'))
      if (v.trim() === '' || !Number.isFinite(n)) {
        setError(`"${k}" tiene que ser un número`)
        return
      }
      values[k] = n
    }
    setSaving(true)
    setError(null)
    try {
      await budgetApi.updateItemParams(budgetId, item.id, values)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    }
    setSaving(false)
  }

  if (Object.keys(params).length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11px] font-bold text-[#2D8D68] tracking-wider">PARÁMETROS</span>
        {Object.keys(draft).map((k) => (
          <label key={k} className="flex items-center gap-1 text-xs text-gray-600">
            <span className="font-mono">{k}</span>
            {puedeEditar ? (
              <input
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                className="w-20 text-right px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#2D8D68]"
              />
            ) : (
              <span className="font-semibold text-gray-800">{draft[k]}</span>
            )}
          </label>
        ))}
        {changed && puedeEditar && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white px-3 py-1 rounded-lg font-medium"
          >
            {saving ? 'Recalculando...' : 'Guardar y recalcular'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// ─── TemplateModal ────────────────────────────────────────────────────────────

interface TemplateModalProps {
  budgetId: string
  itemId: string
  // true si el trabajo ya tiene fórmula o recursos: aplicar otra los reemplaza
  reemplaza: boolean
  // cuántos recursos tiene cargados ahora (para el texto de la confirmación)
  recursosCargados: number
  onApplied: () => Promise<void> | void
  onClose: () => void
}

// Paso intermedio antes de aplicar: confirmar el reemplazo o responder la conversión de unidades
type Paso =
  | { tipo: 'confirmar'; tmpl: any; mensaje: string }
  | { tipo: 'conversion'; tmpl: any; det: FaltaConversion; valor: string; reemplazar: boolean }

function TemplateModal({ budgetId, itemId, reemplaza, recursosCargados, onApplied, onClose }: TemplateModalProps) {
  const [templates, setTemplates] = useState<any[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paso, setPaso] = useState<Paso | null>(null)

  useEffect(() => {
    Promise.all([templateApi.list(), templateApi.categories()])
      .then(([tmplList, cats]) => {
        setTemplates(Array.isArray(tmplList) ? tmplList : [])
        const catList = Array.isArray(cats) ? cats : []
        setCategories(catList)
        if (catList.length > 0) setSelectedCat(catList[0])
      })
      .catch(() => setError('Error cargando las fórmulas.'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = selectedCat
    ? templates.filter((t) => t.categoria === selectedCat)
    : templates

  // Texto de la confirmación según lo que la pantalla sabe del trabajo
  const mensajeReemplazo = () =>
    recursosCargados > 0
      ? recursosCargados === 1
        ? 'Este trabajo ya tiene 1 recurso cargado (material, mano de obra o subcontrato). La fórmula lo reemplaza.'
        : `Este trabajo ya tiene ${recursosCargados} recursos cargados (materiales, mano de obra o subcontratos). La fórmula los reemplaza.`
      : 'Reemplaza los materiales y la mano de obra que tiene ahora.'

  // Pide al servidor aplicar la fórmula. Si el trabajo ya tiene recursos pide confirmar (409 CONFIRMAR_REEMPLAZO);
  // si falta la conversión de unidades, abre el recuadro para responderla. `reemplazar` se arrastra en todos los reenvíos.
  const aplicar = async (tmpl: any, opts: { factor?: number; reemplazar?: boolean } = {}) => {
    setApplying(tmpl.id)
    setError(null)
    try {
      const body: { factor?: number; reemplazar?: boolean } = {}
      if (opts.factor !== undefined) body.factor = opts.factor
      if (opts.reemplazar) body.reemplazar = true
      await templateApi.apply(tmpl.id, budgetId, itemId, Object.keys(body).length ? body : undefined)
      await onApplied()
      onClose()
    } catch (err) {
      if (esConfirmarReemplazo(err)) {
        setPaso({ tipo: 'confirmar', tmpl, mensaje: err.detail.mensaje || mensajeReemplazo() })
      } else if (esFaltaConversion(err)) {
        const prop = err.detail.factor_propuesto
        setPaso({
          tipo: 'conversion',
          tmpl,
          det: err.detail,
          valor: prop != null ? String(prop).replace('.', ',') : '',
          reemplazar: !!opts.reemplazar,
        })
      } else {
        setPaso(null)
        setError('Error al aplicar la fórmula. Intentá de nuevo.')
      }
      setApplying(null)
    }
  }

  // Al elegir una fórmula: si el trabajo ya tiene una, primero se pide confirmación en la misma ventana
  const handleElegir = (tmpl: any) => {
    setError(null)
    if (reemplaza) setPaso({ tipo: 'confirmar', tmpl, mensaje: mensajeReemplazo() })
    else aplicar(tmpl)
  }

  const enviarConversion = () => {
    if (!paso || paso.tipo !== 'conversion') return
    const n = Number(paso.valor.trim().replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      setError('Escribí un número mayor que cero.')
      return
    }
    aplicar(paso.tmpl, { factor: n, reemplazar: paso.reemplazar })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal header */}
        <div className="bg-[#E8F5EE] px-5 py-4 flex items-center justify-between border-b border-[#C3E5D3] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Library size={16} className="text-[#2D8D68]" />
            <span className="font-bold text-[#143D34] text-base">Fórmulas</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#C3E5D3] text-[#2D8D68] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Category tabs */}
        {!paso && categories.length > 0 && (
          <div className="px-4 pt-3 pb-2 flex gap-2 flex-wrap flex-shrink-0 border-b border-gray-100">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`text-xs px-3 py-1 rounded-full font-medium capitalize transition-colors ${
                  selectedCat === cat
                    ? 'bg-[#2D8D68] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-[#E8F5EE] hover:text-[#2D8D68]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Confirmar el reemplazo */}
        {paso?.tipo === 'confirmar' && (
          <div className="px-4 py-4 flex-shrink-0">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <div className="font-semibold text-[#143D34] mb-1">{paso.tmpl.nombre}</div>
              <p>{paso.mensaje}</p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => aplicar(paso.tmpl, { reemplazar: true })}
                  disabled={applying !== null}
                  className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {applying !== null ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Aplicando...
                    </>
                  ) : (
                    'Reemplazar'
                  )}
                </button>
                <button
                  onClick={() => { setPaso(null); setError(null) }}
                  disabled={applying !== null}
                  className="text-xs bg-white border text-gray-700 px-3 py-1.5 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* La unidad de la fórmula no es la del trabajo: preguntar cuánto es */}
        {paso?.tipo === 'conversion' && (
          <div className="px-4 py-4 flex-shrink-0">
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-700">
              <div className="font-semibold text-[#143D34] text-sm mb-1">{paso.tmpl.nombre}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span>{paso.det.mensaje}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={paso.valor}
                  onChange={(e) => setPaso({ ...paso, valor: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') enviarConversion() }}
                  className="border rounded-lg px-2 py-1 w-24 bg-white"
                />
                <span className="text-gray-500">{paso.det.unidad_formula}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Para contrapisos y carpetas es el espesor en metros: 10 cm = 0,10
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={enviarConversion}
                  disabled={applying !== null}
                  className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {applying !== null ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Aplicando...
                    </>
                  ) : (
                    <>
                      <Check size={12} />
                      Aplicar
                    </>
                  )}
                </button>
                <button
                  onClick={() => { setPaso(null); setError(null) }}
                  disabled={applying !== null}
                  className="text-xs bg-white border text-gray-700 px-3 py-1.5 rounded-lg font-semibold hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Template list */}
        {!paso && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
              <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
              Cargando fórmulas...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-sm text-gray-400 italic py-8">
              No hay fórmulas en esta categoría.
            </div>
          )}
          {!loading && filtered.map((tmpl) => {
            const recursoCount = Array.isArray(tmpl.recursos) ? tmpl.recursos.length : 0
            const isApplying = applying === tmpl.id
            return (
              <div
                key={tmpl.id}
                className="border border-gray-200 rounded-xl p-3.5 hover:border-[#2D8D68] hover:bg-[#E8F5EE]/30 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[#143D34] text-sm">{tmpl.nombre}</div>
                    {tmpl.descripcion && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{tmpl.descripcion}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      {tmpl.unidad && (
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono uppercase">
                          {tmpl.unidad}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">
                        {recursoCount} {recursoCount === 1 ? 'recurso' : 'recursos'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleElegir(tmpl)}
                    disabled={isApplying || applying !== null}
                    className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {isApplying ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Aplicando...
                      </>
                    ) : (
                      <>
                        <Check size={12} />
                        Aplicar
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 pb-3 flex-shrink-0">
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ItemDetail() {
  const { id, itemId } = useParams<{ id: string; itemId: string }>()
  const navigate = useNavigate()
  const { puedeEditar } = useAuth()
  const [budget, setBudget] = useState<Budget | null>(null)
  const [item, setItem] = useState<BudgetItem | null>(null)
  const [recursos, setRecursos] = useState<ItemResource[]>([])
  const [audits, setAudits] = useState<ItemAudit[]>([])
  const [indirects, setIndirects] = useState<IndirectConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [auditsLoading, setAuditsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [memoriaOpen, setMemoriaOpen] = useState(false)
  const [editingMemoria, setEditingMemoria] = useState(false)
  const [memoriaDraft, setMemoriaDraft] = useState('')
  const [memoriaSaving, setMemoriaSaving] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  // Materiales sin precio, tal como los calcula el servidor sobre lo guardado
  const [faltantes, setFaltantes] = useState<PrecioFaltante[]>([])
  const faltantesReq = useRef(0)

  // Pide el aviso al servidor; si falla, sin aviso. Se ignoran respuestas viejas si hubo un pedido más nuevo.
  const refrescarFaltantes = useCallback(async () => {
    if (!id || !itemId) return
    const req = ++faltantesReq.current
    let lista: PrecioFaltante[] = []
    try {
      const r = await budgetApi.preciosFaltantes(id, itemId)
      lista = Array.isArray(r?.precios_faltantes) ? r.precios_faltantes : []
    } catch {
      lista = []
    }
    if (req === faltantesReq.current) setFaltantes(lista)
  }, [id, itemId])

  const loadData = useCallback(async (cancelled?: { v: boolean }) => {
    if (!id || !itemId) {
      setLoading(false)
      setAuditsLoading(false)
      setError('Faltan parametros de presupuesto o item.')
      return
    }

    try {
      const [b, items, res, ind] = await Promise.all([
        budgetApi.get(id).catch(() => null),
        budgetApi.getItems(id).catch(() => [] as BudgetItem[]),
        budgetApi.getItemResources(id, itemId).catch(() => [] as ItemResource[]),
        budgetApi.getIndirects(id).catch(() => null),
      ])
      if (cancelled?.v) return
      const it = Array.isArray(items) ? items.find((i) => i.id === itemId) ?? null : null
      if (b) setBudget(b)
      if (it) setItem(it)
      setRecursos(Array.isArray(res) ? res : [])
      if (ind) setIndirects(ind)
      if (!it) setError('No se encontro el item.')
      refrescarFaltantes()
    } catch {
      if (!cancelled?.v) setError('Error cargando datos del item.')
    } finally {
      if (!cancelled?.v) setLoading(false)
    }
  }, [id, itemId, refrescarFaltantes])

  const reloadResources = useCallback(async () => {
    if (!id || !itemId) return
    try {
      const [res, items] = await Promise.all([
        budgetApi.getItemResources(id, itemId),
        budgetApi.getItems(id),
      ])
      setRecursos(Array.isArray(res) ? res : [])
      const it = Array.isArray(items) ? items.find((i) => i.id === itemId) ?? null : null
      if (it) setItem(it)
    } catch {
      // silent
    }
    refrescarFaltantes()
  }, [id, itemId, refrescarFaltantes])

  useEffect(() => {
    const cancelled = { v: false }
    loadData(cancelled)

    // Load audits separately
    if (id && itemId) {
      setAuditsLoading(true)
      budgetApi.getItemAudits(id, itemId)
        .then((data) => { if (!cancelled.v) setAudits(Array.isArray(data) ? data : []) })
        .catch(() => { if (!cancelled.v) setAudits([]) })
        .finally(() => { if (!cancelled.v) setAuditsLoading(false) })
    }

    return () => { cancelled.v = true }
  }, [id, itemId, loadData])

  const cantidad = item?.cantidad ?? 0

  // Unit prices from item record (backend calculated)
  const matUnit = item?.mat_unitario ?? 0
  const moUnit = item?.mo_unitario ?? 0
  const eqUnit = item?.eq_unitario ?? 0
  const matIndUnit = item?.mat_ind_unitario ?? 0
  const subUnit = item?.sub_unitario ?? 0

  if (loading) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando detalle del item...
        </div>
      </div>
    )
  }

  if (error && !item) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-1.5 text-xs mb-4">
          <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate('/app/dashboard')}>Presupuestos</span>
          <ChevronRight size={12} className="text-gray-300" />
          <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate(`/app/budgets/${id ?? '1'}/editor`)}>{budget?.name ?? 'Presupuesto'}</span>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 text-center">
          <div className="text-orange-700 font-medium text-sm mb-2">{error}</div>
          <button
            onClick={() => navigate(`/app/budgets/${id ?? '1'}/editor`)}
            className="text-xs bg-[#2D8D68] hover:bg-[#1B5E4B] text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Volver al editor
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 fade-in max-w-6xl mx-auto">
      {!puedeEditar && (
        <div className="mb-3 rounded-lg bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs text-gray-600">
          Tu usuario solo puede mirar. Los cambios los hace quien carga y edita.
        </div>
      )}
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs mb-2">
        <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate('/app/dashboard')}>Presupuestos</span>
        <ChevronRight size={12} className="text-gray-300" />
        <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate(`/app/budgets/${id ?? '1'}/editor`)}>{budget?.name ?? 'Presupuesto'}</span>
        <ChevronRight size={12} className="text-gray-300" />
        <span className="font-semibold text-gray-900">{item ? `${item.code ?? ''} ${item.description ?? ''}`.trim() : 'Item'}</span>
      </div>

      {/* Back button + section label */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/app/budgets/${id ?? '1'}/editor`)}
            className="flex items-center gap-1 text-xs text-[#2D8D68] hover:text-[#1B5E4B] font-medium transition-colors"
          >
            <ArrowLeft size={13} />
            Volver al editor
          </button>
          {puedeEditar && (
          <button
            onClick={() => setTemplateModalOpen(true)}
            className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            <Library size={13} />
            {item?.template_id ? 'Cambiar fórmula' : 'Cargar fórmula'}
          </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider">
          <ClipboardList size={14} /> DETALLE DE RECURSOS
        </div>
      </div>

      {/* Template modal */}
      {templateModalOpen && puedeEditar && id && itemId && (
        <TemplateModal
          budgetId={id}
          itemId={itemId}
          reemplaza={!!item?.template_id || recursos.length > 0}
          recursosCargados={recursos.length}
          onApplied={reloadResources}
          onClose={() => setTemplateModalOpen(false)}
        />
      )}

      {/* Page header */}
      <div className="bg-[#E8F5EE] rounded-xl p-4 mb-4 border border-[#C3E5D3]">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-1 h-8 bg-[#2D8D68] rounded-full flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h1 className="text-xl font-extrabold text-[#143D34]">
              {item ? `${item.code ?? ''} ${item.description ?? ''}`.trim().toUpperCase() : 'DETALLE DE ITEM'}
            </h1>
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#2D8D68] uppercase font-semibold">Unidad</span>
                <span className="font-bold text-[#143D34] text-sm">{item?.unidad ?? '—'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#2D8D68] uppercase font-semibold">Cantidad</span>
                <span className="font-bold text-[#143D34] text-sm">{fmtNumber(cantidad, 2)}</span>
              </div>
              {item?.notas_calculo && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  <Calculator size={9} />
                  Con memoria de calculo
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Summary bar: 5 mini cards */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'MAT Unit', value: matUnit },
            { label: 'MO Unit', value: moUnit },
            { label: 'EQ Unit', value: eqUnit },
            { label: 'Mat.Ind Unit', value: matIndUnit },
            { label: 'Sub Unit', value: subUnit },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg p-2 text-center border border-[#C3E5D3]">
              <div className="text-[9px] text-[#2D8D68] uppercase font-semibold mb-0.5">{label}</div>
              <div className="font-bold text-[#143D34] text-xs">{fmtARS(value)}</div>
            </div>
          ))}
        </div>
      </div>

      {faltantes.length > 0 && (
        <div className="mb-4 flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <div>
            Faltan precios:{' '}
            {faltantes.slice(0, 5).map((f) => f.descripcion || f.codigo).join(', ')}
            {faltantes.length > 5 && ` y ${faltantes.length - 5} más`}.{' '}
            <Link to="/app/catalogs" className="underline font-semibold">Cargalos en Lista de precios.</Link>
          </div>
        </div>
      )}

      {item && id && <ItemParams budgetId={id} item={item} onSaved={reloadResources} />}

      {/* 5 Resource sections */}
      <div className="space-y-4 mb-6">
        {TIPO_SECTIONS.map((tipo) => (
          <ResourceSection
            key={tipo}
            tipo={tipo}
            recursos={recursos}
            itemQty={cantidad}
            budgetId={id ?? ''}
            itemId={itemId ?? ''}
            onReload={reloadResources}
          />
        ))}
      </div>

      {/* Grand total */}
      {item && (
        <div className="mb-6">
          <GrandTotal item={item} indirects={indirects} recursos={recursos} />
        </div>
      )}

      {/* Memoria de Calculo */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setMemoriaOpen(!memoriaOpen)}
          className="w-full bg-[#E8F5EE]/30 px-4 py-2.5 flex items-center gap-2 border-b hover:bg-[#E8F5EE]/60 transition-colors"
        >
          <Calculator size={14} className="text-[#2D8D68]" />
          <span className="font-bold text-sm text-[#2D8D68]">Memoria de Calculo</span>
          {item?.notas_calculo && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
              con datos
            </span>
          )}
          <span className="ml-auto">
            {memoriaOpen
              ? <ChevronDown size={14} className="text-gray-400" />
              : <ChevronRight size={14} className="text-gray-400" />}
          </span>
        </button>
        {memoriaOpen && (
          <div className="p-4">
            {editingMemoria && puedeEditar ? (
              <div className="space-y-3">
                <textarea
                  value={memoriaDraft}
                  onChange={(e) => setMemoriaDraft(e.target.value)}
                  rows={8}
                  className="w-full border rounded-lg p-3 text-sm font-mono text-gray-700 focus:ring-2 focus:ring-[#2D8D68] focus:border-[#2D8D68] outline-none resize-y"
                  placeholder="Ej: Largo 4.50m x Ancho 3.20m = 14.40 m2&#10;Desperdicio 5%: 14.40 x 1.05 = 15.12 m2"
                />
                <div className="flex items-center gap-2">
                  <button
                    disabled={memoriaSaving}
                    onClick={async () => {
                      if (!id || !itemId) return
                      setMemoriaSaving(true)
                      try {
                        const result = await budgetApi.updateItem(id, itemId, { notas_calculo: memoriaDraft } as Partial<BudgetItem>)
                        if (result && typeof result === 'object' && 'item' in result) {
                          setItem((result as { item: BudgetItem }).item)
                        } else {
                          setItem((prev) => prev ? { ...prev, notas_calculo: memoriaDraft } : prev)
                        }
                        setEditingMemoria(false)
                        budgetApi.getItemAudits(id, itemId)
                          .then((data) => setAudits(Array.isArray(data) ? data : []))
                          .catch(() => {})
                      } catch {
                        // silently fail
                      } finally {
                        setMemoriaSaving(false)
                      }
                    }}
                    className="flex items-center gap-1 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    <Check size={12} />
                    {memoriaSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    disabled={memoriaSaving}
                    onClick={() => setEditingMemoria(false)}
                    className="flex items-center gap-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    <X size={12} />
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {item?.notas_calculo ? (
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-3 mb-3">{item.notas_calculo}</pre>
                ) : (
                  <p className="text-sm text-gray-400 italic mb-3">Sin memoria de calculo para este item.</p>
                )}
                {puedeEditar && (
                <button
                  onClick={() => {
                    setMemoriaDraft(item?.notas_calculo ?? '')
                    setEditingMemoria(true)
                  }}
                  className="flex items-center gap-1 text-xs text-[#2D8D68] hover:text-[#1B5E4B] font-medium transition-colors"
                >
                  <Pencil size={12} />
                  {item?.notas_calculo ? 'Editar memoria' : 'Agregar memoria de calculo'}
                </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Audit History */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-[#E8F5EE]/30 px-4 py-2.5 flex items-center gap-2 border-b">
          <History size={14} className="text-[#2D8D68]" />
          <span className="font-bold text-sm text-[#2D8D68]">Historial de cambios</span>
          {audits.length > 0 && (
            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
              {audits.length}
            </span>
          )}
        </div>
        <AuditHistory audits={audits} loading={auditsLoading} />
      </div>
    </div>
  )
}
