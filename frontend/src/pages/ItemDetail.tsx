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
  MoreHorizontal,
} from 'lucide-react'
import { budgetApi, templateApi, esFaltaConversion, esConfirmarReemplazo, esFalloAplicar, mensajeDeError } from '../lib/api'
import type { FaltaConversion, PrecioFaltante, TemplateSugerencias } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { escaleraDe, fmtPct, indirectosCompletos, pctsEscalera } from '../lib/cascada'
import { fmtNumber, fmtPercent, unidadEnPalabras } from '../lib/format'
import { ESTILO, estadoDeTrabajo, precioPorUnidad } from '../lib/semaforo'
import BuscadorFormulas from '../components/ui/BuscadorFormulas'
import BuscarPrecio, { IconoBuscarInternet, normalizarCodigo } from '../components/BuscarPrecio'
import type { PrecioGuardado } from '../components/BuscarPrecio'
import OrigenPrecio from '../components/OrigenPrecio'
import PreguntaConversion, { factorComoTexto, leerFactor } from '../components/ui/PreguntaConversion'
import { nombreParametro } from '../lib/textos'
import { usePantalla } from '../lib/pantalla'
import HojaInferior from '../components/editor/HojaInferior'
import type { ItemResource, BudgetItem, Budget, ItemAudit, IndirectConfig } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

type Tipo = ItemResource['tipo']

const TIPO_LABELS: Record<Tipo, string> = {
  material: 'Materiales',
  mano_obra: 'Mano de obra',
  equipo: 'Equipos',
  mo_material: 'Materiales indirectos',
  subcontrato: 'Subcontratos',
}

const TIPO_SECTIONS: Tipo[] = ['material', 'mano_obra', 'equipo', 'mo_material', 'subcontrato']

const FIELD_LABELS: Record<string, string> = {
  cantidad: 'Cantidad',
  mat_unitario: 'Materiales por unidad',
  mo_unitario: 'Mano de obra por unidad',
  description: 'Descripción',
  unidad: 'Unidad',
  code: 'Código',
  notas_calculo: 'Memoria de cálculo',
}

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Pencil; color: string }> = {
  manual_edit: { label: 'Cambio a mano', icon: Pencil, color: 'text-blue-600' },
  ai_suggestion: { label: 'Sugerencia de la IA', icon: Cpu, color: 'text-purple-600' },
  excel_import: { label: 'Importación del Excel', icon: Upload, color: 'text-green-600' },
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

const VER_CUENTA_KEY = 'presupuestador.verComoSeCalcula'

function leerVerCuenta(): boolean {
  try {
    return localStorage.getItem(VER_CUENTA_KEY) === '1'
  } catch {
    return false
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
  // Muestra la cuenta, el redondeo y la cantidad con desperdicio ("Ver cómo se calcula")
  verCuenta: boolean
  // Sin precio (en rojo): ofrece buscarlo en internet
  sinPrecio?: boolean
  onBuscar?: (r: ItemResource) => void
}

/** "Sin precio" en rojo y, para quien edita, "Buscar en internet". */
function SinPrecio({ resource, onBuscar }: { resource: ItemResource; onBuscar?: (r: ItemResource) => void }) {
  const { puedeEditar } = useAuth()
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="recurso-sin-precio">
      <span className="text-[10px] max-md:text-[12px] font-semibold text-red-600">Sin precio</span>
      {puedeEditar && onBuscar && (
        <button
          onClick={() => onBuscar(resource)}
          data-testid="buscar-en-internet"
          className="inline-flex items-center gap-1 text-[10px] max-md:text-[13px] max-md:min-h-10 max-md:px-3.5 font-semibold text-sky-700 bg-white border border-sky-200 hover:bg-sky-50 rounded-full px-2 py-0.5"
        >
          <IconoBuscarInternet size={11} /> Buscar en internet
        </button>
      )}
    </div>
  )
}

function ResourceRow({ resource, tipo, onSave, onDelete, startEditing, onEditDone, verCuenta, sinPrecio, onBuscar }: ResourceRowProps) {
  const { puedeEditar } = useAuth()
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState<Partial<ItemResource>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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
    setSaveError(null)
    try {
      await onSave(resource.id, draft)
      setEditing(false)
      setDraft({})
      onEditDone()
    } catch (err) {
      setSaveError(`No se guardó: ${mensajeDeError(err)}`)
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
            <input className={inputCls} value={draft.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value || null)} placeholder="Descripción" />
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
          <td className="px-2 py-1.5 text-right text-xs text-gray-400">{saveError ? <span role="alert" className="text-red-600">{saveError}</span> : '—'}</td>
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
          <input className={inputCls} value={draft.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value || null)} placeholder="Descripción" />
          {!verCuenta && (
            <div className="mt-1">
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-500" title="Lo compra el cliente: se ve pero no suma al costo">
                <input
                  type="checkbox"
                  checked={!!draft.lo_compra_cliente}
                  onChange={(e) => setDraft((prev) => ({ ...prev, lo_compra_cliente: e.target.checked }))}
                />
                cliente
              </label>
            </div>
          )}
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
        {verCuenta && (
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
        )}
        <td className="px-2 py-1.5">
          <input className={numCls} type="number" step="1" min="0" value={draft.precio_unitario ?? 0} onChange={(e) => set('precio_unitario', parseFloat(e.target.value) || 0)} />
        </td>
        <td className="px-2 py-1.5 text-right text-xs text-gray-400">{saveError ? <span role="alert" className="text-red-600">{saveError}</span> : '—'}</td>
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
      <tr className={`border-b border-gray-100 transition-colors ${sinPrecio ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-[#E8F5EE]/20'}`}>
        <td className={`px-3 py-1.5 font-mono text-[10px] ${sinPrecio ? 'text-red-500' : 'text-gray-400'}`}>{resource.codigo ?? '—'}</td>
        <td className={`px-3 py-1.5 ${sinPrecio ? 'text-red-700' : 'text-gray-800'}`}>
          {resource.descripcion ?? '—'}
          {sinPrecio && <SinPrecio resource={resource} onBuscar={onBuscar} />}
        </td>
        <td className="px-3 py-1.5 text-right text-gray-700">{fmtNumber(resource.trabajadores, 0)}</td>
        <td className="px-3 py-1.5 text-right text-gray-700">
          {fmtNumber(resource.dias, 2)}
          {verCuenta && resource.rendimiento && <div className="text-[9px] text-gray-400 font-mono">Q / {resource.rendimiento}</div>}
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
    <tr className={`border-b border-gray-100 transition-colors ${sinPrecio ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-[#E8F5EE]/20'}`}>
      <td className={`px-3 py-1.5 font-mono text-[10px] ${sinPrecio ? 'text-red-500' : 'text-gray-400'}`}>{resource.codigo ?? '—'}</td>
      <td className={`px-3 py-1.5 ${sinPrecio ? 'text-red-700' : 'text-gray-800'}`}>
        {resource.descripcion ?? '—'}
        {verCuenta && resource.formula && (
          <span className="ml-1.5 font-mono text-[10px] text-gray-400" title="Cantidad (Q = cantidad del trabajo)">= {resource.formula}</span>
        )}
        {verCuenta && resource.rendimiento && (
          <span className="ml-1.5 font-mono text-[10px] text-gray-400" title="Días = Q / rendimiento">días = Q / {resource.rendimiento}</span>
        )}
        {resource.lo_compra_cliente && (
          <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 rounded px-1.5" title="No suma al costo">lo compra el cliente</span>
        )}
        {verCuenta && resource.redondear && (
          <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 rounded px-1.5" title="Se redondea sobre el total de la obra">
            redondeo{resource.cantidad_redondeo ? ` +${fmtNumber(resource.cantidad_redondeo, 2)}` : ''}
          </span>
        )}
        {sinPrecio && <SinPrecio resource={resource} onBuscar={onBuscar} />}
      </td>
      <td className="px-3 py-1.5 text-gray-500 text-[10px] uppercase">{resource.unidad ?? '—'}</td>
      <td className="px-3 py-1.5 text-right text-gray-700">{fmtNumber(resource.cantidad, 2)}</td>
      <td className="px-3 py-1.5 text-right text-orange-500">
        {fmtPercent(resource.desperdicio_pct)}
        {resource.desperdicio_origen && resource.desperdicio_origen !== 'recurso' && (
          <div className="text-[9px] text-gray-400">hereda {ORIGEN_LABEL[resource.desperdicio_origen]}</div>
        )}
      </td>
      {verCuenta && (
        <td className="px-3 py-1.5 text-right font-medium text-gray-700">{fmtNumber(resource.cantidad_efectiva, 2)}</td>
      )}
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

// ─── Recursos en el celular ───────────────────────────────────────────────────

const fmtCant = (v: number | null | undefined) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(v ?? 0)

/** Un recurso como tarjeta (celular): descripción, código chico, la cuenta y el desperdicio en una línea chica. */
function RecursoTarjeta({ resource, tipo, verCuenta, sinPrecio, onBuscar, onMenu }: {
  resource: ItemResource
  tipo: Tipo
  verCuenta: boolean
  sinPrecio: boolean
  onBuscar: (r: ItemResource) => void
  onMenu?: () => void
}) {
  const r = resource
  const chico: string[] = []
  if (tipo === 'mano_obra') {
    chico.push(`${fmtCant(r.trabajadores)} ${r.trabajadores === 1 ? 'trabajador' : 'trabajadores'} × ${fmtCant(r.dias)} ${r.dias === 1 ? 'día' : 'días'}`)
    chico.push(`cargas sociales ${fmtPercent(r.cargas_sociales_pct)}`)
    if (verCuenta && r.rendimiento) chico.push(`días = Q / ${r.rendimiento}`)
  } else {
    chico.push(`${fmtCant(r.cantidad)} ${r.unidad ?? ''} + desperdicio ${fmtPercent(r.desperdicio_pct)}${r.desperdicio_origen && r.desperdicio_origen !== 'recurso' ? ` (hereda ${ORIGEN_LABEL[r.desperdicio_origen]})` : ''}`.replace(/\s+/g, ' '))
    if (r.lo_compra_cliente) chico.push('Lo compra el cliente')
    if (verCuenta && r.redondear) chico.push(`redondeo${r.cantidad_redondeo ? ` +${fmtNumber(r.cantidad_redondeo, 2)}` : ''}`)
  }
  // La cuenta con la cantidad que se compra (con desperdicio y redondeo): así cierra con el subtotal
  const cantidad = r.cantidad_efectiva ?? r.cantidad
  const unidad = tipo === 'mano_obra' ? 'jornales' : (r.unidad ?? '')
  return (
    <li data-testid="recurso-tarjeta" className={`relative px-4 py-3 ${sinPrecio ? 'bg-red-50/70' : ''}`}>
      <div className={`pr-10 text-[15px] font-medium leading-snug ${sinPrecio ? 'text-red-700' : 'text-gray-900'}`}>{r.descripcion ?? '—'}</div>
      <div className={`font-mono text-[11px] mt-0.5 ${sinPrecio ? 'text-red-500' : 'text-gray-400'}`}>{r.codigo ?? 'sin código'}</div>
      {verCuenta && r.formula && <div className="font-mono text-[11px] text-gray-400 mt-0.5">= {r.formula}</div>}
      <div className="mt-1.5 text-[14px] text-gray-700 tabular-nums flex flex-wrap items-baseline gap-x-1">
        <span>{fmtCant(cantidad)} {unidad}</span>
        <span className="text-gray-400">×</span>
        <span>{fmtARS(r.precio_unitario)}</span>
        <span className="text-gray-400">=</span>
        <b className="font-bold text-gray-900">{fmtARS(r.subtotal)}</b>
      </div>
      <div className="mt-0.5 text-[12px] text-gray-500">{chico.join(' · ')}</div>
      {sinPrecio && <SinPrecio resource={r} onBuscar={onBuscar} />}
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          aria-label={`Opciones de ${r.descripcion ?? r.codigo ?? 'el recurso'}`}
          className="absolute top-2 right-2 w-10 h-10 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-100"
        >
          <MoreHorizontal size={20} />
        </button>
      )}
    </li>
  )
}

/** Editar (o agregar) un recurso en el celular: una hoja con los campos grandes y los botones fijos abajo. */
function HojaRecurso({ inicial, tipo, titulo, onGuardar, onCerrar }: {
  inicial: Partial<ItemResource>
  tipo: Tipo
  titulo: string
  onGuardar: (data: Partial<ItemResource>) => Promise<void>
  onCerrar: () => void
}) {
  const [draft, setDraft] = useState<Partial<ItemResource>>({ ...inicial })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (field: keyof ItemResource, value: string | number | boolean | null) => setDraft((prev) => ({ ...prev, [field]: value }))
  const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
  const campo = 'w-full h-11 px-3 text-base border border-gray-300 rounded-xl bg-white outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20'
  const etiqueta = 'block text-[13px] font-medium text-gray-600 mb-1'
  const guardar = async () => {
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(draft)
      onCerrar()
    } catch (err) {
      setError(`No se guardó: ${mensajeDeError(err)}`)
    } finally {
      setGuardando(false)
    }
  }
  const numero = (field: keyof ItemResource, label: string) => (
    <label className="block">
      <span className={etiqueta}>{label}</span>
      <input
        className={`${campo} text-right tabular-nums`}
        type="text"
        inputMode="decimal"
        defaultValue={String(draft[field] ?? 0).replace('.', ',')}
        onChange={(e) => set(field, num(e.target.value))}
      />
    </label>
  )
  return (
    <HojaInferior
      titulo={titulo}
      onCerrar={onCerrar}
      testId="hoja-recurso"
      pie={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="h-12 rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 active:bg-gray-100">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={guardando} className="h-12 rounded-xl bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] text-white text-[15px] font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
            <Save size={16} /> {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-3">
        <label className="block">
          <span className={etiqueta}>Descripción</span>
          <input className={campo} value={draft.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value || null)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={etiqueta}>Código</span>
            <input className={campo} value={draft.codigo ?? ''} onChange={(e) => set('codigo', e.target.value || null)} />
          </label>
          {tipo === 'mano_obra' ? numero('precio_unitario', 'Jornal') : (
            <label className="block">
              <span className={etiqueta}>Unidad</span>
              <input className={campo} value={draft.unidad ?? ''} onChange={(e) => set('unidad', e.target.value || null)} placeholder="m2" />
            </label>
          )}
        </div>
        {tipo === 'mano_obra' ? (
          <div className="grid grid-cols-3 gap-3">
            {numero('trabajadores', 'Trabajadores')}
            {/* textos-ok: 'dias' es el nombre del campo */}
            {numero('dias', 'Días')}
            {numero('cargas_sociales_pct', 'Cargas %')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {numero('cantidad', 'Cantidad')}
              {numero('desperdicio_pct', 'Desperdicio %')}
              {numero('precio_unitario', 'Precio')}
            </div>
            <label className="flex items-center gap-3 min-h-11 text-[15px] text-gray-700">
              <input
                type="checkbox"
                className="w-5 h-5 accent-[#2D8D68]"
                checked={!!draft.lo_compra_cliente}
                onChange={(e) => set('lo_compra_cliente', e.target.checked)}
              />
              <span>
                Lo compra el cliente
                <span className="block text-[12px] text-gray-500">Se ve, pero no suma al costo</span>
              </span>
            </label>
          </>
        )}
        {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
      </div>
    </HojaInferior>
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
  verCuenta: boolean
  // Códigos sin precio (normalizados) y qué hacer al tocar "Buscar en internet"
  faltantes: Set<string>
  onBuscar: (r: ItemResource) => void
}

function ResourceSection({ tipo, recursos, itemQty, budgetId, itemId, onReload, verCuenta, faltantes, onBuscar }: SectionProps) {
  const { puedeEditar } = useAuth()
  const { celular } = usePantalla()
  // Celular: opciones de un recurso (⋯), editar o agregar en una hoja
  const [menuRecurso, setMenuRecurso] = useState<ItemResource | null>(null)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [hojaRecurso, setHojaRecurso] = useState<{ recurso: ItemResource | null } | null>(null)
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

  const moHeaders = ['Código', 'Descripción', 'Trabajadores', 'Días', 'Cargas sociales %', 'Jornales', 'Jornal', 'Subtotal', '']
  const matHeaders = verCuenta
    ? ['Código', 'Descripción', 'Unidad', 'Cantidad', 'Desperdicio %', 'Cantidad con desperdicio', 'Precio por unidad', 'Subtotal', '']
    : ['Código', 'Descripción', 'Unidad', 'Cantidad', 'Desperdicio %', 'Precio por unidad', 'Subtotal', '']
  const headers = tipo === 'mano_obra' ? moHeaders : matHeaders

  const esSinPrecio = (r: ItemResource) =>
    !!r.codigo && faltantes.has(normalizarCodigo(r.codigo)) && !r.lo_compra_cliente && !(r.precio_unitario > 0)

  const tipoUnitLabel =
    tipo === 'material' ? 'Materiales por unidad'
    : tipo === 'mano_obra' ? 'Mano de obra por unidad'
    : tipo === 'equipo' ? 'Equipos por unidad'
    : tipo === 'mo_material' ? 'Materiales indirectos por unidad'
    : 'Subcontratos por unidad'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-[#E8F5EE]/30 px-4 py-2.5 max-md:min-h-12 flex items-center gap-2 border-b hover:bg-[#E8F5EE]/60 transition-colors"
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
          {celular ? (
            filtered.length === 0 ? (
              <div className="px-4 py-5 text-center text-gray-400 text-[13px] italic">
                No hay recursos cargados. Agregá recursos para calcular el precio unitario.
              </div>
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {filtered.map((r) => (
                    <RecursoTarjeta
                      key={r.id}
                      resource={r}
                      tipo={tipo}
                      verCuenta={verCuenta}
                      sinPrecio={esSinPrecio(r)}
                      onBuscar={onBuscar}
                      onMenu={puedeEditar ? () => { setConfirmarBorrar(false); setMenuRecurso(r) } : undefined}
                    />
                  ))}
                </ul>
                <div className="bg-[#E8F5EE] px-4 py-2.5 text-[13px] text-[#1B5E4B]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-bold uppercase text-[11px] tracking-wide">Total {TIPO_LABELS[tipo]}</span>
                    <b className="text-[15px] text-[#2D8D68] tabular-nums">{fmtARS(total)}</b>
                  </div>
                  {itemQty > 0 && (
                    <div className="text-[12px] mt-0.5">
                      {fmtARS(total)} ÷ {fmtNumber(itemQty, 2)} = <strong>{tipoUnitLabel}: {fmtARS(unitPrice)}</strong>
                    </div>
                  )}
                </div>
              </>
            )
          ) : filtered.length === 0 && !adding ? (
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
                        className={`px-3 py-2 text-[10px] uppercase font-semibold tracking-wide ${h === '' ? 'w-16' : h === 'Descripción' ? 'text-left' : h === 'Código' ? 'text-left' : h === 'Unidad' ? 'text-left' : 'text-right'}`}
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
                      verCuenta={verCuenta}
                      sinPrecio={!!r.codigo && faltantes.has(normalizarCodigo(r.codigo)) && !r.lo_compra_cliente && !(r.precio_unitario > 0)}
                      onBuscar={onBuscar}
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
                      verCuenta={verCuenta}
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
                        <strong>{tipoUnitLabel}: {fmtARS(unitPrice)}</strong>
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )
          }
          {/* Add resource button */}
          {puedeEditar && (
          <div className="px-4 py-2 border-t">
            <button
              onClick={celular ? () => setHojaRecurso({ recurso: null }) : handleAddNew}
              disabled={adding}
              className="flex items-center gap-1.5 text-xs max-md:text-[14px] max-md:min-h-10 max-md:px-4 max-md:rounded-xl bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <Plus size={12} />
              Agregar recurso
            </button>
          </div>
          )}
        </>
      )}

      {menuRecurso && (
        <HojaInferior
          titulo={menuRecurso.descripcion ?? menuRecurso.codigo ?? 'Recurso'}
          onCerrar={() => setMenuRecurso(null)}
          alto="max-h-[80dvh]"
        >
          {confirmarBorrar ? (
            <div className="px-5 py-4">
              <p className="text-[15px] text-gray-800">¿Borrar este recurso?</p>
              <p className="text-[13px] text-gray-500 mt-1">El trabajo se recalcula sin él.</p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button type="button" onClick={() => setConfirmarBorrar(false)} disabled={borrando} className="h-12 rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 active:bg-gray-100">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={borrando}
                  onClick={async () => {
                    setBorrando(true)
                    try { await handleDelete(menuRecurso.id) } finally { setBorrando(false); setMenuRecurso(null) }
                  }}
                  className="h-12 rounded-xl bg-red-500 text-white text-[15px] font-semibold active:bg-red-600 disabled:opacity-60"
                >
                  {borrando ? 'Borrando…' : 'Borrar'}
                </button>
              </div>
            </div>
          ) : (
            <div role="menu" className="px-3 py-2">
              <button
                type="button"
                role="menuitem"
                onClick={() => { const r = menuRecurso; setMenuRecurso(null); setHojaRecurso({ recurso: r }) }}
                className="w-full text-left px-3 min-h-[52px] rounded-xl text-[15px] font-medium text-gray-800 flex items-center gap-3 active:bg-gray-100"
              >
                <span className="w-9 h-9 rounded-full bg-[#E8F5EE] text-[#2D8D68] flex items-center justify-center"><Pencil size={17} /></span>
                Editar
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmarBorrar(true)}
                className="w-full text-left px-3 min-h-[52px] rounded-xl text-[15px] font-medium text-red-600 flex items-center gap-3 active:bg-gray-100"
              >
                <span className="w-9 h-9 rounded-full bg-red-50 text-red-500 flex items-center justify-center"><Trash2 size={17} /></span>
                Borrar
              </button>
            </div>
          )}
        </HojaInferior>
      )}

      {hojaRecurso && (
        <HojaRecurso
          tipo={tipo}
          titulo={hojaRecurso.recurso ? 'Editar el recurso' : `Agregar a ${TIPO_LABELS[tipo]}`}
          inicial={hojaRecurso.recurso ?? emptyResource(tipo, itemId)}
          onGuardar={async (data) => {
            if (hojaRecurso.recurso) await handleSave(hojaRecurso.recurso.id, data)
            else { await budgetApi.createResource(budgetId, itemId, { ...data, tipo }); onReload() }
          }}
          onCerrar={() => setHojaRecurso(null)}
        />
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
        Sin cambios registrados para este trabajo.
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
  const sumaTipo = (tipo: ItemResource['tipo']) =>
    recursos.filter((r) => r.tipo === tipo).reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const matTotal = sumaTipo('material')
  const moTotal = sumaTipo('mano_obra')
  const eqTotal = sumaTipo('equipo')
  const matIndTotal = sumaTipo('mo_material')
  const subTotal = sumaTipo('subcontrato')

  // Lo guardado por el servidor (la misma cuenta para todo el presupuesto). Los % solo si se pudieron leer.
  const pcts = pctsEscalera(indirects)
  const e = escaleraDe([item], indirects ? indirectosCompletos(indirects).iva_pct : null)
  const sinPrecio = e.neto === 0 && e.directo > 0

  const Row = ({ label, value, sub, highlight, fuerte, testId }: {
    label: string; value: number | null; sub?: string; highlight?: boolean; fuerte?: boolean; testId?: string
  }) => (
    <div
      className={`flex items-center justify-between gap-3 py-1.5 px-4 ${highlight ? 'bg-[#E8F5EE] rounded-lg mx-2 px-2' : ''}`}
      data-testid={testId}
      data-valor={value ?? ''}
    >
      <span className={`text-xs ${highlight || fuerte ? 'font-bold text-[#143D34]' : 'text-gray-600'}`}>
        {label}
        {sub && <span className="ml-1 text-[10px] text-gray-400 font-normal">({sub})</span>}
      </span>
      <span className={`font-bold tabular-nums whitespace-nowrap ${highlight ? 'text-[#2D8D68] text-base' : fuerte ? 'text-sm text-[#143D34]' : 'text-xs text-gray-900'}`}>
        {value === null ? '—' : fmtARS(value)}
      </span>
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden" data-testid="resumen-costos">
      <div className="bg-[#E8F5EE]/30 px-4 py-2.5 border-b flex items-center gap-2">
        <Calculator size={14} className="text-[#2D8D68]" />
        <span className="font-bold text-sm text-[#2D8D68]">Del costo al precio</span>
      </div>
      <div className="py-2 space-y-0.5">
        {/* De qué está hecho el costo directo */}
        {matTotal > 0 && <Row label="Materiales" value={matTotal} />}
        {moTotal > 0 && <Row label="Mano de obra" value={moTotal} />}
        {eqTotal > 0 && <Row label="Equipos" value={eqTotal} />}
        {matIndTotal > 0 && <Row label="Materiales indirectos" value={matIndTotal} />}
        {subTotal > 0 && <Row label="Subcontratos" value={subTotal} />}
        {recursos.length > 0 && <div className="mx-4 my-1 border-t border-dashed border-gray-200" />}
        <Row label="Costo directo" value={e.directo} fuerte testId="detalle-directo" />
        {sinPrecio ? (
          <div className="px-4 py-2 text-[11px] text-amber-700">
            Este trabajo todavía no tiene el precio calculado. Tocá «Recálculo completo» en el editor.
          </div>
        ) : (
          <>
            <Row label="+ Indirectos" value={e.indirecto} sub={pcts ? `${fmtPct(pcts.indirecto)}%` : undefined} testId="detalle-indirectos" />
            <Row label="+ Beneficio" value={e.beneficio} sub={pcts ? `${fmtPct(pcts.beneficio)}%` : undefined} testId="detalle-beneficio" />
            <Row
              label="+ Impuestos"
              value={e.impuestos}
              sub={`Ingresos Brutos y cheque${pcts ? `, ${fmtPct(pcts.impuestos)}%` : ''}`}
              testId="detalle-impuestos"
            />
            <div className="mx-4 my-1 border-t border-dashed border-gray-200" />
            <Row label="= Precio sin IVA" value={e.neto} fuerte testId="detalle-precio-sin-iva" />
            <Row label="+ IVA" value={e.iva} sub={pcts ? `${fmtPct(pcts.iva)}%` : undefined} testId="detalle-iva" />
            <div className="mx-4 my-1 border-t-2 border-gray-200" />
            <Row label="= Precio con IVA" value={e.total_final} highlight testId="detalle-precio-con-iva" />
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
        setError(`${nombreParametro(k)} tiene que ser un número.`)
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
      setError(mensajeDeError(err, 'No se pudo guardar.'))
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
            <span title={`En la fórmula: ${k}`}>{nombreParametro(k)}</span>
            {puedeEditar ? (
              <input
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                aria-label={nombreParametro(k)}
                className="w-20 max-md:w-24 max-md:h-10 text-right px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#2D8D68]"
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
            className="text-xs max-md:text-[14px] max-md:h-10 max-md:px-4 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white px-3 py-1 rounded-lg font-medium"
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
  // Nombre y unidad del trabajo: con eso el servidor propone una fórmula ("Quizás sea:")
  descripcion: string
  unidad: string | null
  onApplied: () => Promise<void> | void
  onClose: () => void
}

// Paso intermedio antes de aplicar: confirmar el reemplazo o responder la conversión de unidades
type Paso =
  | { tipo: 'confirmar'; tmpl: any; mensaje: string }
  | { tipo: 'conversion'; tmpl: any; det: FaltaConversion; valor: string; reemplazar: boolean }

function TemplateModal({ budgetId, itemId, reemplaza, recursosCargados, descripcion, unidad, onApplied, onClose }: TemplateModalProps) {
  const [templates, setTemplates] = useState<any[]>([])
  const [sugerencias, setSugerencias] = useState<TemplateSugerencias | null>(null)
  // Conversión que trae la propuesta (si la regla o la memoria la conocen): solo vale para esa fórmula
  const factorPropuesto = useRef<{ id: string; factor: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paso, setPaso] = useState<Paso | null>(null)

  useEffect(() => {
    templateApi.list()
      .then((tmplList) => setTemplates(Array.isArray(tmplList) ? tmplList : []))
      .catch(() => setError('No se pudieron cargar las fórmulas.'))
      .finally(() => setLoading(false))
  }, [])

  // Si el pedido falla, la ventana funciona igual, sin "Quizás sea:"
  useEffect(() => {
    let vigente = true
    if (!descripcion.trim()) return
    templateApi.sugerir(descripcion, unidad)
      .then((r) => { if (vigente && r && typeof r === 'object') setSugerencias(r) })
      .catch(() => {})
    return () => { vigente = false }
  }, [descripcion, unidad])

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
        // Si Sol eligió la propuesta y trae su conversión, arranca con ese valor; si no, con la del servidor
        const guardado = factorPropuesto.current
        const deLaPropuesta = guardado && guardado.id === tmpl.id ? guardado.factor : null
        const prop = deLaPropuesta ?? err.detail.factor_propuesto
        setPaso({
          tipo: 'conversion',
          tmpl,
          det: err.detail,
          valor: factorComoTexto(prop),
          reemplazar: !!opts.reemplazar,
        })
      } else if (esFalloAplicar(err)) {
        setPaso(null)
        // El mensaje del servidor dice si quedó como estaba o si hay que revisar antes de seguir
        setError(err.detail.mensaje)
        // Si pudo quedar a medias, mostrar lo que hay guardado de verdad (sin cerrar el aviso)
        if (err.detail.codigo === 'A_MEDIAS') Promise.resolve(onApplied()).catch(() => {})
      } else {
        setPaso(null)
        setError('No se pudo aplicar la fórmula. Probá de nuevo.')
      }
      setApplying(null)
    }
  }

  // Al elegir una fórmula: si el trabajo ya tiene una, primero se pide confirmación en la misma ventana
  const handleElegir = (tmpl: any, factor: number | null = null) => {
    setError(null)
    factorPropuesto.current = factor != null ? { id: tmpl.id, factor } : null
    if (reemplaza) setPaso({ tipo: 'confirmar', tmpl, mensaje: mensajeReemplazo() })
    else aplicar(tmpl)
  }

  // Una de "Quizás sea:": se cruza con la lista completa por id o código (si no está, sirve la sugerencia misma)
  const elegirSugerida = (s: { id?: string; codigo: string; nombre: string }, esPropuesta: boolean) => {
    const tmpl = templates.find((t) => t.id === s.id) ?? templates.find((t) => t.codigo && t.codigo === s.codigo) ?? s
    handleElegir(tmpl, esPropuesta ? sugerencias?.propuesta?.factor ?? null : null)
  }

  const enviarConversion = () => {
    if (!paso || paso.tipo !== 'conversion') return
    const n = leerFactor(paso.valor)
    if (n === null) {
      setError('Escribí un número mayor que cero.')
      return
    }
    aplicar(paso.tmpl, { factor: n, reemplazar: paso.reemplazar })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh] max-md:mx-0 max-md:max-w-none max-md:rounded-none max-md:h-[100dvh] max-md:max-h-none">
        {/* Modal header */}
        <div className="bg-[#E8F5EE] px-5 py-4 flex items-center justify-between border-b border-[#C3E5D3] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Library size={16} className="text-[#2D8D68]" />
            <span className="font-bold text-[#143D34] text-base">Fórmulas</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 max-md:w-10 max-md:h-10 max-md:flex max-md:items-center max-md:justify-center rounded-lg hover:bg-[#C3E5D3] text-[#2D8D68] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

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
            <PreguntaConversion
              titulo={paso.tmpl.nombre}
              det={paso.det}
              valor={paso.valor}
              onValor={(v) => setPaso({ ...paso, valor: v })}
              onEnviar={enviarConversion}
              onCancelar={() => { setPaso(null); setError(null) }}
              ocupado={applying !== null}
            />
          </div>
        )}

        {/* Buscador: "Quizás sea:" arriba y la lista completa por rubro debajo */}
        {!paso && (
          <div className="flex-1 min-h-0 flex flex-col">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
                <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                Cargando fórmulas...
              </div>
            ) : (
              <BuscadorFormulas
                recetas={templates}
                onElegir={(t) => handleElegir(t)}
                deshabilitado={applying !== null}
                ayuda="Elegí la fórmula correcta para este trabajo."
                quizas={sugerencias ? {
                  propuesta: sugerencias.propuesta,
                  parecidas: sugerencias.parecidas,
                  onElegir: elegirSugerida,
                } : undefined}
                className="flex-1 min-h-0 flex flex-col max-md:[&_button]:min-h-11 max-md:[&_input]:min-h-8"
                listaClassName="flex-1 overflow-y-auto min-h-[10rem]"
              />
            )}
            {applying !== null && (
              <div className="px-4 py-2 flex items-center gap-2 text-xs text-gray-500 border-t">
                <div className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                Aplicando...
              </div>
            )}
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
  const [memoriaError, setMemoriaError] = useState<string | null>(null)
  // No se pudieron traer los números nuevos después de un cambio (el cambio sí se guardó)
  const [refreshError, setRefreshError] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  // Buscar en internet el precio de un recurso sin precio, y lo que pasó al guardarlo
  const [buscarPrecio, setBuscarPrecio] = useState<ItemResource | null>(null)
  const [precioBuscado, setPrecioBuscado] = useState<
    | { tipo: 'ok'; g: PrecioGuardado; codigo: string; recursos: number }
    | { tipo: 'error'; g: PrecioGuardado; codigo: string; mensaje: string }
    | null
  >(null)
  // Materiales sin precio, tal como los calcula el servidor sobre lo guardado
  const [faltantes, setFaltantes] = useState<PrecioFaltante[]>([])
  // 'cargando' hasta que el servidor contesta por lo guardado ahora; 'error' si no se pudo revisar.
  // Solo 'ok' permite el verde: una consulta fallida nunca cuenta como "no falta ningún precio".
  const [faltantesEstado, setFaltantesEstado] = useState<'cargando' | 'ok' | 'error'>('cargando')
  const faltantesReq = useRef(0)
  const [verCuenta, setVerCuenta] = useState<boolean>(leerVerCuenta)
  const alternarVerCuenta = () => {
    const nuevo = !verCuenta
    setVerCuenta(nuevo)
    try { localStorage.setItem(VER_CUENTA_KEY, nuevo ? '1' : '0') } catch { /* sin almacenamiento: vale solo por ahora */ }
  }

  // Pide los faltantes al servidor. Mientras tanto, la verificación anterior deja de valer (el chip se
  // esconde); si falla o la respuesta no sirve, queda en 'error' (amarillo, con Reintentar), nunca en verde.
  // Se ignoran respuestas viejas si hubo un pedido más nuevo.
  const refrescarFaltantes = useCallback(async () => {
    if (!id || !itemId) return
    const req = ++faltantesReq.current
    setFaltantesEstado('cargando')
    let lista: PrecioFaltante[] | null = null
    try {
      const r = await budgetApi.preciosFaltantes(id, itemId)
      if (Array.isArray(r?.precios_faltantes)) lista = r.precios_faltantes
    } catch {
      lista = null
    }
    if (req === faltantesReq.current) {
      setFaltantes(lista ?? [])
      setFaltantesEstado(lista ? 'ok' : 'error')
    }
  }, [id, itemId])

  const loadData = useCallback(async (cancelled?: { v: boolean }) => {
    if (!id || !itemId) {
      setLoading(false)
      setAuditsLoading(false)
      setError('Falta el presupuesto o el trabajo en la dirección.')
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
      if (!it) setError('No encontré este trabajo.')
      refrescarFaltantes()
    } catch {
      if (!cancelled?.v) setError('No se pudieron cargar los datos del trabajo.')
    } finally {
      if (!cancelled?.v) setLoading(false)
    }
  }, [id, itemId, refrescarFaltantes])

  // Después de tocar recursos, parámetros, fórmula o la memoria: el servidor ya hizo la cuenta del trabajo,
  // así que se traen el trabajo y sus recursos tal como quedaron guardados.
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
      setRefreshError(false)
    } catch {
      setRefreshError(true)
    }
    refrescarFaltantes()
  }, [id, itemId, refrescarFaltantes])

  // El precio quedó en la lista: los recursos de este trabajo con ese código lo toman (como un precio cargado a mano)
  const tomarPrecio = useCallback(async (g: PrecioGuardado, codigo: string) => {
    if (!id || !itemId) return
    const cod = normalizarCodigo(codigo)
    const mismos = recursos.filter((r) => normalizarCodigo(r.codigo) === cod)
    try {
      for (const r of mismos) {
        await budgetApi.updateResource(id, itemId, r.id, { precio_unitario: g.precio, catalog_entry_id: g.entrada.id })
      }
      setPrecioBuscado({ tipo: 'ok', g, codigo, recursos: mismos.length })
    } catch (err) {
      setPrecioBuscado({ tipo: 'error', g, codigo, mensaje: mensajeDeError(err) })
    }
    await reloadResources()
  }, [id, itemId, recursos, reloadResources])

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
  const codigosSinPrecio = new Set(faltantes.map((f) => normalizarCodigo(f.codigo)))

  // Unit prices from item record (backend calculated)
  const matUnit = item?.mat_unitario ?? 0
  const moUnit = item?.mo_unitario ?? 0
  const eqUnit = item?.eq_unitario ?? 0
  const matIndUnit = item?.mat_ind_unitario ?? 0
  const subUnit = item?.sub_unitario ?? 0
  const porUnidad = unidadEnPalabras(item?.unidad)
  const estado = estadoDeTrabajo({
    tieneFormula: !!item?.template_id,
    recursos: recursos.length,
    preciosFaltantes: faltantes.length,
    preciosVerificados: faltantesEstado === 'ok',
    precioAMano: item ? precioPorUnidad(item) : 0,
  })

  if (loading) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando el trabajo…
        </div>
      </div>
    )
  }

  if (error && !item) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-1.5 text-xs mb-4">
          <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate('/app/dashboard')}>Mis presupuestos</span>
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
    <div className="p-4 md:p-6 pb-10 fade-in max-w-6xl mx-auto">
      {!puedeEditar && (
        <div className="mb-3 rounded-lg bg-gray-100 border border-gray-200 px-3 py-1.5 text-xs text-gray-600">
          Tu usuario solo puede mirar. Los cambios los hace quien carga y edita.
        </div>
      )}
      {/* Breadcrumb (en el celular alcanza con "Volver al editor") */}
      <div className="hidden md:flex items-center gap-1.5 text-xs mb-2">
        <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate('/app/dashboard')}>Mis presupuestos</span>
        <ChevronRight size={12} className="text-gray-300" />
        <span className="text-gray-400 cursor-pointer hover:text-[#2D8D68]" onClick={() => navigate(`/app/budgets/${id ?? '1'}/editor`)}>{budget?.name ?? 'Presupuesto'}</span>
        <ChevronRight size={12} className="text-gray-300" />
        <span className="font-semibold text-gray-900">{item ? `${item.code ?? ''} ${item.description ?? ''}`.trim() : 'Trabajo'}</span>
      </div>

      {/* Back button + section label */}
      <div className="flex items-center justify-between gap-2 mb-1 max-md:mb-3">
        <div className="flex items-center gap-3 max-md:w-full max-md:justify-between">
          <button
            onClick={() => navigate(`/app/budgets/${id ?? '1'}/editor`)}
            className="flex items-center gap-1 text-xs max-md:text-[14px] max-md:min-h-10 text-[#2D8D68] hover:text-[#1B5E4B] font-medium transition-colors"
          >
            <ArrowLeft size={13} />
            Volver al editor
          </button>
          {puedeEditar && (
          <button
            onClick={() => setTemplateModalOpen(true)}
            className="flex items-center gap-1.5 text-xs max-md:text-[14px] max-md:h-10 max-md:px-4 max-md:rounded-xl bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            <Library size={13} />
            {item?.template_id ? 'Cambiar fórmula' : 'Cargar fórmula'}
          </button>
          )}
        </div>
        <div className="hidden md:flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider">
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
          descripcion={item?.description ?? ''}
          unidad={item?.unidad ?? null}
          onApplied={reloadResources}
          onClose={() => setTemplateModalOpen(false)}
        />
      )}

      {/* Page header */}
      <div className="bg-[#E8F5EE] rounded-xl p-4 mb-4 border border-[#C3E5D3]">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-1 h-8 bg-[#2D8D68] rounded-full flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-start gap-x-3 gap-y-1 flex-wrap">
              <h1 className="text-xl max-md:text-[19px] max-md:leading-snug font-extrabold text-[#143D34] min-w-0 break-words [overflow-wrap:anywhere]">
                {item ? `${item.code ?? ''} ${item.description ?? ''}`.trim().toUpperCase() : 'DETALLE DEL TRABAJO'}
              </h1>
              {item && faltantesEstado !== 'cargando' && (
                <div className="flex items-center gap-2 flex-wrap pt-1" data-testid="estado-trabajo">
                  <span className={`inline-block text-[10px] font-bold rounded px-1.5 py-0.5 ${ESTILO[estado.estado].chip}`}>
                    {ESTILO[estado.estado].texto}
                  </span>
                  <span className="text-xs max-md:text-[13px] text-gray-700">{estado.frase}</span>
                  {faltantesEstado === 'error' && (
                    <button
                      onClick={() => refrescarFaltantes()}
                      className="text-xs font-semibold text-[#2D8D68] underline hover:text-[#143D34] max-md:min-h-10 max-md:text-[13px]"
                    >
                      Reintentar
                    </button>
                  )}
                </div>
              )}
            </div>
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
                  Con memoria de cálculo
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Summary bar: 5 mini cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-sm:[&>*:last-child]:col-span-2">
          {[
            { label: 'Materiales', value: matUnit },
            { label: 'Mano de obra', value: moUnit },
            { label: 'Equipos', value: eqUnit },
            { label: 'Materiales indirectos', value: matIndUnit },
            { label: 'Subcontratos', value: subUnit },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg p-2 text-center border border-[#C3E5D3] min-w-0">
              <div className="text-[10px] max-md:text-[11px] leading-tight text-[#2D8D68] font-semibold mb-0.5 break-words">{label} por {porUnidad}</div>
              <div className="font-bold text-[#143D34] text-xs max-md:text-[15px] tabular-nums">{fmtARS(value)}</div>
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
            <Link to="/app/catalogs" className="underline font-semibold">Cargalos en Lista de precios</Link>
            {puedeEditar ? ' o buscalos en internet desde cada renglón en rojo.' : '.'}
          </div>
        </div>
      )}

      {precioBuscado && (
        <div
          role={precioBuscado.tipo === 'ok' ? 'status' : 'alert'}
          data-testid="precio-buscado"
          className={`mb-4 flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${
            precioBuscado.tipo === 'ok' ? 'bg-[#E8F5EE] border-[#2D8D68]/30 text-[#143D34]' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {precioBuscado.tipo === 'ok'
            ? <Check size={14} className="flex-shrink-0 mt-0.5 text-[#2D8D68]" />
            : <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <p>
              <strong>{precioBuscado.codigo}: {fmtARS(precioBuscado.g.precio)} sin IVA</strong>, guardado en «{precioBuscado.g.catalogo}».{' '}
              {precioBuscado.tipo === 'ok'
                ? 'Este trabajo ya lo usa.'
                : `Pero este trabajo no lo pudo tomar: ${precioBuscado.mensaje}`}
            </p>
            <OrigenPrecio entrada={precioBuscado.g.entrada} className="mt-0.5" />
            {precioBuscado.g.sinOrigen && (
              <p className="mt-1 text-amber-800">El servidor todavía no guarda de dónde salió el precio (falta actualizarlo).</p>
            )}
            {precioBuscado.tipo === 'error' && (
              <button
                onClick={() => void tomarPrecio(precioBuscado.g, precioBuscado.codigo)}
                className="mt-1.5 font-semibold underline"
              >
                Probá de nuevo
              </button>
            )}
          </div>
          <button onClick={() => setPrecioBuscado(null)} aria-label="Cerrar" className="opacity-60 hover:opacity-100 flex-shrink-0"><X size={14} /></button>
        </div>
      )}

      {buscarPrecio && (
        <BuscarPrecio
          destino={{
            modo: 'recurso',
            codigo: buscarPrecio.codigo ?? '',
            descripcion: buscarPrecio.descripcion ?? buscarPrecio.codigo ?? '',
            unidad: buscarPrecio.tipo === 'mano_obra' ? 'jornal' : buscarPrecio.unidad,
            tipo: buscarPrecio.tipo,
          }}
          onGuardado={(g) => {
            const codigo = buscarPrecio.codigo ?? ''
            setBuscarPrecio(null)
            void tomarPrecio(g, codigo)
          }}
          onClose={() => setBuscarPrecio(null)}
        />
      )}

      {item && id && <ItemParams budgetId={id} item={item} onSaved={reloadResources} />}

      <div className="mb-2 text-right">
        <button
          onClick={alternarVerCuenta}
          className="text-xs max-md:text-[14px] max-md:min-h-10 text-[#2D8D68] hover:text-[#1B5E4B] hover:underline font-medium"
        >
          {verCuenta ? 'Ocultar cómo se calcula' : 'Ver cómo se calcula'}
        </button>
      </div>

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
            verCuenta={verCuenta}
            faltantes={codigosSinPrecio}
            onBuscar={setBuscarPrecio}
          />
        ))}
      </div>

      {/* Grand total */}
      {refreshError && (
        <div role="alert" className="mb-2 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="flex-1">El cambio se guardó, pero no pude traer los números nuevos de este trabajo.</span>
          <button onClick={() => reloadResources()} className="font-semibold underline">Probá de nuevo</button>
        </div>
      )}
      {item && (
        <div className="mb-6">
          <GrandTotal item={item} indirects={indirects} recursos={recursos} />
        </div>
      )}

      {/* Memoria de Calculo */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <button
          onClick={() => setMemoriaOpen(!memoriaOpen)}
          className="w-full bg-[#E8F5EE]/30 px-4 py-2.5 max-md:min-h-12 flex items-center gap-2 border-b hover:bg-[#E8F5EE]/60 transition-colors"
        >
          <Calculator size={14} className="text-[#2D8D68]" />
          <span className="font-bold text-sm text-[#2D8D68]">Memoria de cálculo</span>
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
                      setMemoriaError(null)
                      try {
                        await budgetApi.updateItem(id, itemId, { notas_calculo: memoriaDraft } as Partial<BudgetItem>)
                        setItem((prev) => prev ? { ...prev, notas_calculo: memoriaDraft } : prev)
                        setEditingMemoria(false)
                        // El trabajo como quedó guardado (un texto no cambia los números)
                        await reloadResources()
                        budgetApi.getItemAudits(id, itemId)
                          .then((data) => setAudits(Array.isArray(data) ? data : []))
                          .catch(() => {})
                      } catch (err) {
                        setMemoriaError(`No se guardó la memoria: ${mensajeDeError(err)}`)
                      } finally {
                        setMemoriaSaving(false)
                      }
                    }}
                    className="flex items-center gap-1 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white text-xs max-md:text-[14px] max-md:h-10 max-md:px-4 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    <Check size={12} />
                    {memoriaSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    disabled={memoriaSaving}
                    onClick={() => setEditingMemoria(false)}
                    className="flex items-center gap-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs max-md:text-[14px] max-md:h-10 max-md:px-4 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    <X size={12} />
                    Cancelar
                  </button>
                </div>
                {memoriaError && <p role="alert" className="text-xs text-red-600">{memoriaError}</p>}
              </div>
            ) : (
              <div>
                {item?.notas_calculo ? (
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-3 mb-3">{item.notas_calculo}</pre>
                ) : (
                  <p className="text-sm text-gray-400 italic mb-3">Sin memoria de cálculo para este trabajo.</p>
                )}
                {puedeEditar && (
                <button
                  onClick={() => {
                    setMemoriaDraft(item?.notas_calculo ?? '')
                    setEditingMemoria(true)
                  }}
                  className="flex items-center gap-1 text-xs max-md:text-[14px] max-md:min-h-10 text-[#2D8D68] hover:text-[#1B5E4B] font-medium transition-colors"
                >
                  <Pencil size={12} />
                  {item?.notas_calculo ? 'Editar memoria' : 'Agregar memoria de cálculo'}
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
