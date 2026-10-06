import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, CheckSquare, Square, Check } from 'lucide-react'
import { GENERIC_TASK_TEMPLATE } from '../../data/genericTasks'
import type { GenericTaskCategory } from '../../data/genericTasks'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SelectedTask {
  categoryCode: string
  categoryName: string
  descripcion: string
  unidad: string
  cantidad: number
}

interface ItemSelection {
  selected: boolean
  cantidad: string
}

// Lo tildado y la cantidad escrita, por rubro y renglón. Lo guarda quien usa el selector,
// así no se pierde al ir y volver entre pasos.
export type SelectionState = Record<string, Record<number, ItemSelection>>

// ─── Helpers ────────────────────────────────────────────────────────────────

export function seleccionInicial(template: GenericTaskCategory[] = GENERIC_TASK_TEMPLATE): SelectionState {
  const state: SelectionState = {}
  for (const cat of template) {
    state[cat.code] = {}
    for (let i = 0; i < cat.items.length; i++) {
      state[cat.code][i] = {
        selected: false,
        cantidad: cat.items[i].cantidad_sugerida != null
          ? String(cat.items[i].cantidad_sugerida)
          : '',
      }
    }
  }
  return state
}

/** Los trabajos tildados, en el orden de la lista. Cantidad vacía o inválida = 1. */
export function trabajosElegidos(selection: SelectionState): SelectedTask[] {
  const tasks: SelectedTask[] = []
  for (const cat of GENERIC_TASK_TEMPLATE) {
    const catSel = selection[cat.code] ?? {}
    for (let i = 0; i < cat.items.length; i++) {
      const itemSel = catSel[i]
      if (itemSel?.selected) {
        tasks.push({
          categoryCode: cat.code,
          categoryName: cat.nombre,
          descripcion: cat.items[i].descripcion,
          unidad: cat.items[i].unidad,
          cantidad: parseFloat(itemSel.cantidad.replace(',', '.')) || 1,
        })
      }
    }
  }
  return tasks
}

// ─── Component ──────────────────────────────────────────────────────────────

interface GenericTaskSelectorProps {
  selection: SelectionState
  onChange: (next: SelectionState) => void
}

export default function GenericTaskSelector({ selection, onChange }: GenericTaskSelectorProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const e: Record<string, boolean> = {}
    for (const cat of GENERIC_TASK_TEMPLATE) e[cat.code] = true
    return e
  })

  const selectedTasks = useMemo(() => trabajosElegidos(selection), [selection])

  function toggleItem(catCode: string, itemIdx: number) {
    const next = { ...selection }
    next[catCode] = { ...next[catCode] }
    next[catCode][itemIdx] = {
      ...next[catCode][itemIdx],
      selected: !next[catCode][itemIdx].selected,
    }
    onChange(next)
  }

  function updateCantidad(catCode: string, itemIdx: number, value: string) {
    const next = { ...selection }
    next[catCode] = { ...next[catCode] }
    next[catCode][itemIdx] = { ...next[catCode][itemIdx], cantidad: value }
    onChange(next)
  }

  function toggleCategory(catCode: string) {
    setExpanded((prev) => ({ ...prev, [catCode]: !prev[catCode] }))
  }

  function selectAll() {
    const next: SelectionState = {}
    for (const cat of GENERIC_TASK_TEMPLATE) {
      next[cat.code] = {}
      for (let i = 0; i < cat.items.length; i++) {
        next[cat.code][i] = { ...selection[cat.code][i], selected: true }
      }
    }
    onChange(next)
  }

  function deselectAll() {
    // Keeps the quantities already typed
    const next: SelectionState = {}
    for (const cat of GENERIC_TASK_TEMPLATE) {
      next[cat.code] = {}
      for (let i = 0; i < cat.items.length; i++) {
        next[cat.code][i] = { ...selection[cat.code][i], selected: false }
      }
    }
    onChange(next)
  }

  function selectCategory(catCode: string, value: boolean) {
    const next = { ...selection }
    next[catCode] = { ...next[catCode] }
    const cat = GENERIC_TASK_TEMPLATE.find((c) => c.code === catCode)!
    for (let i = 0; i < cat.items.length; i++) {
      next[catCode][i] = { ...next[catCode][i], selected: value }
    }
    onChange(next)
  }

  // Count helpers
  const totalSelected = selectedTasks.length
  const totalItems = GENERIC_TASK_TEMPLATE.reduce((s, c) => s + c.items.length, 0)

  function categorySelectedCount(catCode: string): number {
    const catSel = selection[catCode]
    return Object.values(catSel).filter((v) => v.selected).length
  }

  return (
    <div className="space-y-3">
      {/* Header with bulk actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-[#2D8D68]">{totalSelected}</span> de {totalItems} trabajos elegidos
        </div>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="text-xs font-medium text-[#2D8D68] hover:text-[#1B5E4B] bg-[#E8F5EE] hover:bg-[#D4EDDF] px-3 py-1.5 rounded-md transition-colors"
          >
            Tildar todos
          </button>
          <button
            onClick={deselectAll}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
          >
            Destildar todos
          </button>
        </div>
      </div>

      {/* Category list */}
      {GENERIC_TASK_TEMPLATE.map((cat) => {
        const isExpanded = expanded[cat.code]
        const catCount = categorySelectedCount(cat.code)
        const allSelected = catCount === cat.items.length
        const someSelected = catCount > 0 && !allSelected

        return (
          <div
            key={cat.code}
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            {/* Category header */}
            <div
              className="bg-gray-50 px-4 py-3 flex items-center gap-3 cursor-pointer select-none hover:bg-gray-100 transition-colors"
              onClick={() => toggleCategory(cat.code)}
            >
              {/* Expand/collapse arrow */}
              <div className="text-gray-400">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>

              {/* Category checkbox */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  selectCategory(cat.code, !allSelected)
                }}
                role="checkbox"
                aria-checked={allSelected ? true : someSelected ? 'mixed' : false}
                aria-label={`Todo el rubro ${cat.nombre}`}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                  allSelected
                    ? 'bg-[#2D8D68] border-[#2D8D68] text-white'
                    : someSelected
                      ? 'bg-[#2D8D68]/30 border-[#2D8D68] text-white'
                      : 'border-gray-300 hover:border-[#2D8D68]'
                }`}
              >
                {(allSelected || someSelected) && <Check size={12} strokeWidth={3} />}
              </button>

              <span className="text-xs font-bold text-[#2D8D68] w-5">{cat.code}.</span>
              <span className="text-sm font-semibold text-gray-800 flex-1">{cat.nombre}</span>
              <span className="text-xs text-gray-400">
                {catCount}/{cat.items.length}
              </span>
            </div>

            {/* Items */}
            {isExpanded && (
              <div className="px-4 py-2 space-y-1">
                {cat.items.map((item, idx) => {
                  const itemSel = selection[cat.code][idx]
                  return (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 py-1.5 px-2 rounded-md transition-colors ${
                        itemSel.selected ? 'bg-[#E8F5EE]/50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleItem(cat.code, idx)}
                        role="checkbox"
                        aria-checked={itemSel.selected}
                        aria-label={item.descripcion}
                        className="flex-shrink-0 text-gray-400 hover:text-[#2D8D68] transition-colors"
                      >
                        {itemSel.selected ? (
                          <CheckSquare size={18} className="text-[#2D8D68]" />
                        ) : (
                          <Square size={18} />
                        )}
                      </button>

                      {/* Description */}
                      <span
                        className={`flex-1 text-sm ${
                          itemSel.selected ? 'text-gray-800' : 'text-gray-500'
                        }`}
                      >
                        {item.descripcion}
                      </span>

                      {/* Unit badge */}
                      <span className="text-[10px] font-mono font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {item.unidad}
                      </span>

                      {/* Quantity input (shown when selected) */}
                      {itemSel.selected && (
                        <input
                          type="number"
                          value={itemSel.cantidad}
                          onChange={(e) => updateCantidad(cat.code, idx, e.target.value)}
                          placeholder="1"
                          aria-label={`Cantidad de ${item.descripcion}`}
                          min={0}
                          step="any"
                          className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68] transition-all"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
