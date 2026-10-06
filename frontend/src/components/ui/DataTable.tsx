import { useState, useRef, useEffect, useCallback } from 'react'
import { FileText, Pencil, Loader2, Trash2 } from 'lucide-react'
import type { BudgetItem } from '../../types'
import { fmtCurrency, fmtNumber } from '../../lib/format'
import { ESTILO } from '../../lib/semaforo'
import type { Semaforo } from '../../lib/semaforo'

interface Props {
  items: BudgetItem[]
  onEditItem?: (itemId: string, field: string, oldValue: number, newValue: number) => Promise<void>
  onViewDetail?: (itemId: string) => void
  onDeleteItem?: (itemId: string, description: string) => void
  // Punto de color de cada trabajo (null: no se sabe, sin punto)
  semaforo?: (item: BudgetItem) => { estado: Semaforo; frase: string } | null
}

type EditableField = 'cantidad' | 'mat_unitario' | 'mo_unitario'

const EDITABLE_FIELDS: EditableField[] = ['cantidad', 'mat_unitario', 'mo_unitario']

interface CellState {
  saving: boolean
  justSaved: boolean
  error: string | null
  hasAudit: boolean
}

export default function DataTable({ items, onEditItem, onViewDetail, onDeleteItem, semaforo }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const cellKey = (itemId: string, field: string) => `${itemId}:${field}`

  const getCellState = (itemId: string, field: string): CellState =>
    cellStates[cellKey(itemId, field)] ?? { saving: false, justSaved: false, error: null, hasAudit: false }

  const updateCellState = useCallback((itemId: string, field: string, partial: Partial<CellState>) => {
    setCellStates((prev) => ({
      ...prev,
      [cellKey(itemId, field)]: { ...getCellState(itemId, field), ...partial },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellStates])

  function startEdit(item: BudgetItem, field: EditableField) {
    if (!onEditItem) return
    const value = item[field]
    setEditing({ id: item.id, field })
    setEditValue(value !== undefined && value !== null ? String(value) : '')
  }

  function cancelEdit() {
    setEditing(null)
    setEditValue('')
  }

  async function commitEdit(item: BudgetItem) {
    if (!editing || !onEditItem) return

    const { field } = editing
    const newValue = parseFloat(editValue)
    const oldValue = item[field] ?? 0

    // Cancel if same value or invalid
    if (isNaN(newValue) || newValue === oldValue) {
      cancelEdit()
      return
    }

    const key = { id: item.id, field }
    setEditing(null)
    setEditValue('')
    updateCellState(item.id, field, { saving: true, error: null })

    try {
      await onEditItem(item.id, field, oldValue, newValue)
      updateCellState(item.id, field, { saving: false, justSaved: true, hasAudit: true })
      // Clear the green flash after 1.5 seconds
      setTimeout(() => {
        updateCellState(item.id, field, { justSaved: false })
      }, 1500)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al guardar'
      updateCellState(key.id, key.field, { saving: false, error: message })
      // Clear error after 4 seconds
      setTimeout(() => {
        updateCellState(key.id, key.field, { error: null })
      }, 4000)
    }
  }

  const totals = items.reduce(
    (acc, item) => ({
      directo: acc.directo + item.directo_total,
      indirecto: acc.indirecto + item.indirecto_total,
      beneficio: acc.beneficio + (item.beneficio_total ?? 0),
      neto: acc.neto + item.neto_total,
    }),
    { directo: 0, indirecto: 0, beneficio: 0, neto: 0 },
  )

  function renderEditableCell(item: BudgetItem, field: EditableField, format: (v: number) => string) {
    const isEditing = editing?.id === item.id && editing?.field === field
    const state = getCellState(item.id, field)
    const value = item[field]

    if (isEditing) {
      return (
        <td className="px-3 py-2">
          <input
            ref={inputRef}
            type="number"
            step="any"
            className="w-full max-w-[100px] ml-auto block border-2 border-[#2D8D68] rounded-lg px-2 py-1 text-right text-xs bg-white outline-none shadow-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitEdit(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit(item)
              if (e.key === 'Escape') cancelEdit()
            }}
          />
        </td>
      )
    }

    // Determine cell visual state
    let cellClass = 'px-3 py-2.5 cost-cell relative group'
    let borderStyle = ''

    if (state.error) {
      borderStyle = 'border border-red-400 rounded-lg'
    } else if (state.justSaved) {
      cellClass += ' animate-save-flash'
    }

    if (onEditItem) {
      cellClass += ' cursor-pointer'
    }

    return (
      <td
        className={cellClass}
        onClick={() => startEdit(item, field)}
        title={state.error ?? undefined}
      >
        <span className={`inline-flex items-center gap-1 ${borderStyle} ${onEditItem ? 'editable-cell' : ''}`}>
          {state.saving ? (
            <Loader2 size={10} className="animate-spin text-[#2D8D68]" />
          ) : null}
          {value !== undefined && value !== null ? format(value) : '--'}
          {onEditItem && !state.saving ? (
            <Pencil size={9} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          ) : null}
        </span>
        {state.hasAudit && !state.justSaved ? (
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-500" title="Editado manualmente" />
        ) : null}
      </td>
    )
  }

  return (
    <div className="overflow-auto max-h-full">
      {/* Save flash animation */}
      <style>{`
        @keyframes saveFlash {
          0% { background-color: transparent; }
          20% { background-color: rgb(187 247 208); }
          100% { background-color: transparent; }
        }
        .animate-save-flash {
          animation: saveFlash 1.5s ease-out;
        }
      `}</style>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#E8F5EE] text-[#143D34]">
            <th className="px-3 py-2 text-left font-semibold text-[11px] tracking-wide">Codigo</th>
            <th className="px-3 py-2 text-left font-semibold text-[11px] tracking-wide">Descripcion</th>
            <th className="px-3 py-2 text-left font-semibold text-[11px] tracking-wide">Unidad</th>
            <th className="px-3 py-2 text-right font-semibold text-[11px] tracking-wide">
              Cant.
              {onEditItem ? <Pencil size={8} className="inline ml-1 text-[#2D8D68]/50" /> : null}
            </th>
            <th className="px-3 py-2 text-right font-semibold text-[11px] tracking-wide">
              MAT Unit
              {onEditItem ? <Pencil size={8} className="inline ml-1 text-[#2D8D68]/50" /> : null}
            </th>
            <th className="px-3 py-2 text-right font-semibold text-[11px] tracking-wide">
              MO Unit
              {onEditItem ? <Pencil size={8} className="inline ml-1 text-[#2D8D68]/50" /> : null}
            </th>
            <th className="px-3 py-2 text-right font-semibold text-[11px] tracking-wide">Directo</th>
            <th className="px-3 py-2 text-right font-semibold text-[11px] tracking-wide">Indirecto</th>
            <th className="px-3 py-2 text-right font-semibold text-[11px] tracking-wide">Beneficio</th>
            <th className="px-3 py-2 text-right font-bold text-[11px] tracking-wide" title="Con indirectos, beneficio e impuestos (Ingresos Brutos y cheque). Sin IVA.">Precio sin IVA</th>
            <th className="px-3 py-2 w-16" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={item.id}
              className={`hover:bg-[#E8F5EE]/20 transition-colors duration-150 ${
                idx % 2 === 1 ? 'bg-gray-50/30' : 'bg-white'
              }`}
            >
              <td className="px-3 py-2.5 font-mono text-[10px] text-gray-400">{item.code}</td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  {(() => {
                    const s = semaforo?.(item)
                    return s ? (
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${ESTILO[s.estado].punto}`}
                        title={s.frase}
                        aria-label={s.frase}
                        role="img"
                        data-semaforo={s.estado}
                      />
                    ) : null
                  })()}
                  <span className="font-medium text-gray-800">{item.description}</span>
                </span>
              </td>
              <td className="px-3 py-2.5 text-gray-400 text-[10px] uppercase">{item.unidad}</td>
              {renderEditableCell(item, 'cantidad', (v) => fmtNumber(v, 0))}
              {renderEditableCell(item, 'mat_unitario', fmtCurrency)}
              {renderEditableCell(item, 'mo_unitario', fmtCurrency)}
              {/* Calculated columns — read-only */}
              <td className="px-3 py-2.5 cost-cell font-semibold text-blue-700/80">
                {fmtCurrency(item.directo_total)}
              </td>
              <td className="px-3 py-2.5 cost-cell text-gray-400">
                {fmtCurrency(item.indirecto_total)}
              </td>
              <td className="px-3 py-2.5 cost-cell text-gray-400">
                {fmtCurrency(item.beneficio_total)}
              </td>
              <td className="px-3 py-2.5 cost-cell font-bold text-[#143D34]">
                {fmtCurrency(item.neto_total)}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  {onViewDetail ? (
                    <button
                      onClick={() => onViewDetail(item.id)}
                      className="p-1 text-gray-300 hover:text-[#2D8D68] transition-colors rounded hover:bg-[#E8F5EE]"
                      title="Ver detalle del ítem"
                    >
                      <FileText size={13} />
                    </button>
                  ) : null}
                  {onDeleteItem ? (
                    deletingId === item.id ? (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => { onDeleteItem(item.id, item.description ?? ''); setDeletingId(null) }}
                          className="px-1.5 py-0.5 text-[9px] bg-red-500 text-white rounded font-medium hover:bg-red-600"
                        >
                          Si
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-1.5 py-0.5 text-[9px] bg-gray-200 text-gray-600 rounded font-medium hover:bg-gray-300"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(item.id)}
                        className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded hover:bg-red-50"
                        title="Eliminar item"
                      >
                        <Trash2 size={13} />
                      </button>
                    )
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        {items.length > 0 && (
          <tfoot className="sticky bottom-0 z-10">
            <tr className="bg-[#E8F5EE] font-semibold text-xs border-t border-[#2D8D68]/20">
              <td colSpan={6} className="px-3 py-2.5 text-right text-[#2D8D68] uppercase text-[10px] tracking-wider font-bold">Total de lo elegido</td>
              <td className="px-3 py-2.5 cost-cell text-blue-700 font-bold">{fmtCurrency(totals.directo)}</td>
              <td className="px-3 py-2.5 cost-cell text-[#E8663C] font-bold">{fmtCurrency(totals.indirecto)}</td>
              <td className="px-3 py-2.5 cost-cell text-gray-600 font-bold">{fmtCurrency(totals.beneficio)}</td>
              <td className="px-3 py-2.5 cost-cell text-[#143D34] font-extrabold text-sm">{fmtCurrency(totals.neto)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
