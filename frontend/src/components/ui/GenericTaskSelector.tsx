import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, CheckSquare, Square, Check, Library } from 'lucide-react'
import type { ModeloRubro, ModeloTrabajo } from '../../lib/api'

// Trabajos típicos del asistente «Nuevo presupuesto»: el modelo de presupuestación de Terrac (GET /modelo-terrac),
// con sus rubros (1 Tareas preliminares … 9 Cubierta), sus pisos (4.1 Fundaciones…) y los códigos de siempre.
// Un trabajo con fórmula entra con su fórmula y sus precios; los demás, sin fórmula (en rojo, con «Elegir fórmula»).

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SelectedTask {
  rubroCodigo: string
  rubroNombre: string
  // Piso del modelo (4.1 Fundaciones); null si el trabajo va directo en el rubro
  grupoCodigo: string | null
  grupoNombre: string | null
  codigo: string
  descripcion: string
  unidad: string
  cantidad: number
  // Código de la fórmula (null: entra sin fórmula)
  plantilla: string | null
}

interface ItemSelection {
  selected: boolean
  cantidad: string
}

// Lo tildado y la cantidad escrita, por trabajo (su código). Lo guarda quien usa el selector,
// así no se pierde al ir y volver entre pasos.
export type SelectionState = Record<string, ItemSelection>

// ─── Helpers ────────────────────────────────────────────────────────────────

/** La clave de un trabajo del modelo: su código (o, si no tiene, el rubro y la descripción). */
export function claveTrabajo(rubro: ModeloRubro, t: ModeloTrabajo): string {
  return t.codigo || `${rubro.codigo}:${t.descripcion}`
}

export function seleccionInicial(): SelectionState {
  return {}
}

/** Lo tildado de un borrador guardado; lo que tenga otra forma (el de la lista vieja) se descarta. */
export function normalizarSeleccion(x: unknown): SelectionState {
  const out: SelectionState = {}
  if (!x || typeof x !== 'object') return out
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (v && typeof v === 'object' && typeof (v as ItemSelection).selected === 'boolean' && typeof (v as ItemSelection).cantidad === 'string') {
      out[k] = { selected: (v as ItemSelection).selected, cantidad: (v as ItemSelection).cantidad }
    }
  }
  return out
}

/** "12,5" → 12.5; vacío o inválido = 0 (la cantidad la pone Sol) */
function leerCantidad(t: string): number {
  const n = parseFloat(t.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Los trabajos tildados, en el orden del modelo. */
export function trabajosElegidos(selection: SelectionState, modelo: ModeloRubro[] | null): SelectedTask[] {
  const tasks: SelectedTask[] = []
  for (const rubro of modelo ?? []) {
    for (const g of rubro.grupos) {
      for (const t of g.trabajos) {
        const sel = selection[claveTrabajo(rubro, t)]
        if (!sel?.selected) continue
        tasks.push({
          rubroCodigo: rubro.codigo,
          rubroNombre: rubro.nombre,
          grupoCodigo: g.codigo,
          grupoNombre: g.nombre,
          codigo: t.codigo,
          descripcion: t.descripcion,
          unidad: t.unidad || 'gl',
          cantidad: leerCantidad(sel.cantidad),
          plantilla: t.plantilla,
        })
      }
    }
  }
  return tasks
}

const trabajosDe = (rubro: ModeloRubro) => rubro.grupos.flatMap((g) => g.trabajos)

// ─── Component ──────────────────────────────────────────────────────────────

interface GenericTaskSelectorProps {
  modelo: ModeloRubro[]
  selection: SelectionState
  onChange: (next: SelectionState) => void
}

export default function GenericTaskSelector({ modelo, selection, onChange }: GenericTaskSelectorProps) {
  const [cerrados, setCerrados] = useState<Record<string, boolean>>({})

  const selectedTasks = useMemo(() => trabajosElegidos(selection, modelo), [selection, modelo])

  const sel = (rubro: ModeloRubro, t: ModeloTrabajo): ItemSelection =>
    selection[claveTrabajo(rubro, t)] ?? { selected: false, cantidad: '' }

  function setTrabajos(cambios: [string, Partial<ItemSelection>][]) {
    const next = { ...selection }
    for (const [k, c] of cambios) next[k] = { ...(next[k] ?? { selected: false, cantidad: '' }), ...c }
    onChange(next)
  }

  function toggleItem(rubro: ModeloRubro, t: ModeloTrabajo) {
    setTrabajos([[claveTrabajo(rubro, t), { selected: !sel(rubro, t).selected }]])
  }

  function updateCantidad(rubro: ModeloRubro, t: ModeloTrabajo, value: string) {
    setTrabajos([[claveTrabajo(rubro, t), { cantidad: value }]])
  }

  // Tildar o destildar muchos: la cantidad escrita se conserva
  function marcar(rubros: ModeloRubro[], value: boolean) {
    setTrabajos(rubros.flatMap((r) => trabajosDe(r).map((t) => [claveTrabajo(r, t), { selected: value }] as [string, Partial<ItemSelection>])))
  }

  const totalSelected = selectedTasks.length
  const totalItems = modelo.reduce((s, r) => s + trabajosDe(r).length, 0)
  const conFormula = selectedTasks.filter((t) => t.plantilla).length

  return (
    <div className="space-y-3" data-testid="trabajos-tipicos">
      <p className="text-xs text-gray-500 leading-relaxed">
        Los rubros y trabajos del modelo de Terrac, con sus códigos. Los que dicen <span className="font-semibold text-[#1B5E4B]">con fórmula</span> entran
        con su fórmula y los precios de la lista; los demás entran sin fórmula, para elegirla después en el presupuesto.
      </p>
      {/* Header with bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-[#2D8D68]">{totalSelected}</span> de {totalItems} trabajos elegidos
          {totalSelected > 0 && <span className="text-gray-400"> ({conFormula} con fórmula)</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => marcar(modelo, true)}
            className="min-h-10 md:min-h-0 text-xs font-medium text-[#2D8D68] hover:text-[#1B5E4B] bg-[#E8F5EE] hover:bg-[#D4EDDF] px-3 py-1.5 rounded-md transition-colors"
          >
            Tildar todos
          </button>
          <button
            onClick={() => marcar(modelo, false)}
            className="min-h-10 md:min-h-0 text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors"
          >
            Destildar todos
          </button>
        </div>
      </div>

      {/* Rubros */}
      {modelo.map((rubro) => {
        const clave = rubro.codigo || rubro.nombre
        const isExpanded = !cerrados[clave]
        const trabajos = trabajosDe(rubro)
        const catCount = trabajos.filter((t) => sel(rubro, t).selected).length
        const allSelected = trabajos.length > 0 && catCount === trabajos.length
        const someSelected = catCount > 0 && !allSelected

        return (
          <div key={clave} className="border border-gray-200 rounded-lg overflow-hidden" data-testid="rubro-tipico" data-codigo={rubro.codigo}>
            {/* Rubro header */}
            <div
              className="bg-gray-50 px-3 md:px-4 py-3 flex items-center gap-2.5 md:gap-3 cursor-pointer select-none hover:bg-gray-100 transition-colors"
              onClick={() => setCerrados((prev) => ({ ...prev, [clave]: isExpanded }))}
            >
              <div className="text-gray-400">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  marcar([rubro], !allSelected)
                }}
                role="checkbox"
                aria-checked={allSelected ? true : someSelected ? 'mixed' : false}
                aria-label={`Todo el rubro ${rubro.nombre}`}
                disabled={trabajos.length === 0}
                className={`relative after:absolute after:-inset-2.5 after:content-[''] w-6 h-6 md:w-5 md:h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-40 ${
                  allSelected
                    ? 'bg-[#2D8D68] border-[#2D8D68] text-white'
                    : someSelected
                      ? 'bg-[#2D8D68]/30 border-[#2D8D68] text-white'
                      : 'border-gray-300 hover:border-[#2D8D68]'
                }`}
              >
                {(allSelected || someSelected) && <Check size={12} strokeWidth={3} />}
              </button>

              <span className="text-xs font-bold text-[#2D8D68] min-w-5">{rubro.codigo}.</span>
              <span className="text-sm font-semibold text-gray-800 flex-1 min-w-0 [overflow-wrap:anywhere]">{rubro.nombre}</span>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {catCount}/{trabajos.length}
              </span>
            </div>

            {isExpanded && (
              <div className="px-2 md:px-4 py-2 space-y-1">
                {trabajos.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-gray-400">El modelo no trae trabajos en este rubro: agregalos en el presupuesto.</p>
                )}
                {rubro.grupos.map((g, gi) => (
                  <div key={g.codigo ?? `g${gi}`}>
                    {g.codigo || g.nombre ? (
                      <div className="px-2 pt-2 pb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide [overflow-wrap:anywhere]">
                        {[g.codigo, g.nombre].filter(Boolean).join(' ')}
                      </div>
                    ) : null}
                    {g.trabajos.length === 0 && (g.codigo || g.nombre) && (
                      <p className="px-2 pb-1 text-xs text-gray-400">Sin trabajos en el modelo.</p>
                    )}
                    {g.trabajos.map((t) => {
                      const itemSel = sel(rubro, t)
                      const nombre = [t.codigo, t.descripcion].filter(Boolean).join(' ')
                      return (
                        <div
                          key={claveTrabajo(rubro, t)}
                          data-testid="trabajo-tipico"
                          data-codigo={t.codigo}
                          className={`flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1.5 min-h-11 md:min-h-0 py-1.5 px-2 rounded-md transition-colors ${
                            itemSel.selected ? 'bg-[#E8F5EE]/50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <button
                            onClick={() => toggleItem(rubro, t)}
                            role="checkbox"
                            aria-checked={itemSel.selected}
                            aria-label={nombre}
                            className="relative after:absolute after:-inset-2.5 after:content-[''] flex-shrink-0 text-gray-400 hover:text-[#2D8D68] transition-colors"
                          >
                            {itemSel.selected ? <CheckSquare size={18} className="text-[#2D8D68]" /> : <Square size={18} />}
                          </button>

                          <span
                            onClick={() => toggleItem(rubro, t)}
                            className={`flex-1 min-w-0 text-sm cursor-pointer md:cursor-auto [overflow-wrap:anywhere] ${itemSel.selected ? 'text-gray-800' : 'text-gray-600'}`}
                          >
                            {t.codigo && <span className="font-mono text-[11px] text-gray-400 mr-1.5">{t.codigo}</span>}
                            {t.descripcion}
                          </span>

                          {t.plantilla && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#1B5E4B] bg-[#E8F5EE] border border-[#2D8D68]/20 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              title={`Entra con la fórmula ${[t.plantilla, t.plantillaNombre].filter(Boolean).join(' ')} y sus precios`}
                              data-testid="con-formula"
                            >
                              <Library size={10} /> con fórmula
                            </span>
                          )}

                          {t.unidad && (
                            <span className="text-[10px] font-mono font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                              {t.unidad}
                            </span>
                          )}

                          {itemSel.selected && (
                            <input
                              type="number"
                              value={itemSel.cantidad}
                              onChange={(e) => updateCantidad(rubro, t, e.target.value)}
                              placeholder="0"
                              aria-label={`Cantidad de ${nombre}`}
                              min={0}
                              step="any"
                              inputMode="decimal"
                              className="w-24 md:w-20 min-h-10 md:min-h-0 border border-gray-200 rounded px-2 py-1 text-base md:text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68] transition-all"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
