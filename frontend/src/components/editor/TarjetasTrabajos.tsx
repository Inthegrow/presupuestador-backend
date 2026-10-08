import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, ChevronRight, FileText, Loader2, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import type { BudgetItem } from '../../types'
import { fmtPesos } from '../../lib/format'
import { ESTILO } from '../../lib/semaforo'
import type { Semaforo } from '../../lib/semaforo'
import HojaInferior from './HojaInferior'

interface Props {
  items: BudgetItem[]
  // La misma cuenta que la celda de la tabla: el servidor guarda la cantidad y recalcula el trabajo
  onEditItem?: (itemId: string, field: string, oldValue: number, newValue: number) => Promise<void>
  onViewDetail: (itemId: string) => void
  onDeleteItem?: (itemId: string, description: string) => void
  semaforo?: (item: BudgetItem) => { estado: Semaforo; frase: string } | null
}

const fmtCantidad = (v: number | null | undefined) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(v ?? 0)

/** "12,5" o "12.5" → 12.5; null si no es un número de 0 para arriba */
function leerCantidad(t: string): number | null {
  const limpio = t.trim().replace(/\s/g, '')
  if (!limpio) return null
  // Con coma decimal, los puntos son de miles ("1.250,5")
  const n = Number(limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function Tarjeta({
  item, puedeEditar, editando, onEditar, onDejarDeEditar, onGuardar, onVer, onMenu, semaforo,
}: {
  item: BudgetItem
  puedeEditar: boolean
  editando: boolean
  onEditar: () => void
  onDejarDeEditar: () => void
  onGuardar: (nueva: number) => Promise<void>
  onVer: () => void
  onMenu: () => void
  semaforo: { estado: Semaforo; frase: string } | null
}) {
  const [valor, setValor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recien, setRecien] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editando) return
    setValor(fmtCantidad(item.cantidad).replace(/\./g, ''))
    setError(null)
    // El foco después de montar el campo (en el celular abre el teclado numérico)
    const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando])

  const guardar = async (e?: FormEvent) => {
    e?.preventDefault()
    const n = leerCantidad(valor)
    if (n === null) {
      setError('Escribí un número: 0 o más.')
      return
    }
    if (n === (item.cantidad ?? 0)) {
      onDejarDeEditar()
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(n)
      onDejarDeEditar()
      setRecien(true)
      setTimeout(() => setRecien(false), 1500)
    } catch (err) {
      setError(err instanceof Error && err.message ? `No se guardó: ${err.message}` : 'No se guardó. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const unidad = item.unidad || 's/u'

  return (
    <li
      data-testid="tarjeta-trabajo"
      data-id={item.id}
      className={`relative bg-white rounded-2xl border shadow-sm transition-colors duration-500 ${
        recien ? 'border-[#2D8D68] bg-[#F2FBF6]' : error ? 'border-red-300' : 'border-gray-100'}`}
    >
      <button
        type="button"
        onClick={onVer}
        className="w-full text-left pl-4 pr-14 pt-3 pb-1.5 rounded-t-2xl active:bg-gray-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 flex-shrink-0">{item.code || '—'}</span>
          {semaforo && (
            <span className="inline-flex items-center gap-1.5 min-w-0 text-[12px] text-gray-500" title={semaforo.frase}>
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${ESTILO[semaforo.estado].punto}`}
                role="img"
                aria-label={semaforo.frase}
                data-semaforo={semaforo.estado}
              />
              <span className="truncate" aria-hidden>{semaforo.frase}</span>
            </span>
          )}
        </span>
        <span className="block mt-1 text-[15px] font-semibold text-gray-900 leading-snug line-clamp-2">
          {item.description || '(sin nombre)'}
        </span>
      </button>

      <button
        type="button"
        onClick={onMenu}
        aria-label={`Más opciones de ${item.code ?? ''} ${item.description ?? ''}`.replace(/\s+/g, ' ').trim()}
        className="absolute top-1.5 right-1.5 w-10 h-10 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-100"
      >
        <MoreHorizontal size={20} />
      </button>

      {editando ? (
        <form onSubmit={guardar} className="px-4 pb-3.5 pt-1">
          <label className="block text-[12px] font-medium text-gray-500 mb-1" htmlFor={`cantidad-${item.id}`}>
            Cantidad, en {unidad}
          </label>
          <div className="flex items-stretch gap-2">
            <input
              id={`cantidad-${item.id}`}
              ref={inputRef}
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              value={valor}
              onChange={(e) => { setValor(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Escape') onDejarDeEditar() }}
              disabled={guardando}
              data-testid="tarjeta-cantidad"
              className="flex-1 min-w-0 h-12 px-3 text-[20px] font-semibold text-right tabular-nums text-gray-900 border-2 border-[#2D8D68] rounded-xl bg-white outline-none focus:ring-4 focus:ring-[#2D8D68]/15 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onDejarDeEditar}
              disabled={guardando}
              aria-label="Cancelar"
              className="w-12 h-12 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 active:bg-gray-100 disabled:opacity-50"
            >
              <X size={20} />
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="h-12 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] text-white text-[15px] font-semibold disabled:opacity-70"
            >
              {guardando ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          <p className="text-[12px] text-gray-500 mt-1.5">Al guardar se recalcula el precio del trabajo con el Coeficiente de pase.</p>
          {error && <p role="alert" className="text-[13px] text-red-600 mt-1">{error}</p>}
        </form>
      ) : (
        <div className="flex items-end justify-between gap-3 pl-4 pr-4 pb-3">
          {puedeEditar ? (
            <button
              type="button"
              onClick={onEditar}
              aria-label={`Cambiar la cantidad: ${fmtCantidad(item.cantidad)} ${unidad}`}
              data-testid="tarjeta-cambiar-cantidad"
              className="min-h-10 -ml-1 px-2.5 flex items-center gap-1.5 rounded-xl border border-dashed border-gray-300 text-[14px] text-gray-700 active:bg-[#FEFCE8] active:border-[#2D8D68]"
            >
              <span className="text-gray-500">{unidad}</span>
              <span className="text-gray-300" aria-hidden>·</span>
              <span className="font-semibold tabular-nums">{fmtCantidad(item.cantidad)}</span>
              <Pencil size={13} className="text-[#2D8D68] ml-0.5" />
            </button>
          ) : (
            <span className="min-h-10 flex items-center gap-1.5 text-[14px] text-gray-700">
              <span className="text-gray-500">{unidad}</span>
              <span className="text-gray-300" aria-hidden>·</span>
              <span className="font-semibold tabular-nums">{fmtCantidad(item.cantidad)}</span>
            </span>
          )}
          <button type="button" onClick={onVer} tabIndex={-1} aria-hidden className="text-right min-w-0">
            <span className="block text-[11px] text-gray-500">Precio sin IVA</span>
            <span className="flex items-center gap-0.5 text-[16px] font-bold text-[#143D34] tabular-nums whitespace-nowrap" data-testid="tarjeta-precio" data-valor={item.neto_total ?? 0}>
              {fmtPesos(item.neto_total)}
              <ChevronRight size={16} className="text-gray-300 -mr-1" />
            </span>
          </button>
        </div>
      )}
    </li>
  )
}

/** Los trabajos como tarjetas (celular): tocar abre el detalle; la cantidad se cambia desde la tarjeta. */
export default function TarjetasTrabajos({ items, onEditItem, onViewDetail, onDeleteItem, semaforo }: Props) {
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [menu, setMenu] = useState<BudgetItem | null>(null)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)

  const cerrarMenu = () => { setMenu(null); setConfirmarBorrar(false) }
  const trabajos = items.filter((i) => i.notas !== 'Seccion')

  return (
    <>
      <ul className="space-y-2.5" aria-label="Trabajos">
        {trabajos.map((item) => (
          <Tarjeta
            key={item.id}
            item={item}
            puedeEditar={!!onEditItem}
            editando={editandoId === item.id}
            onEditar={() => setEditandoId(item.id)}
            onDejarDeEditar={() => setEditandoId((id) => (id === item.id ? null : id))}
            onGuardar={async (n) => { if (onEditItem) await onEditItem(item.id, 'cantidad', item.cantidad ?? 0, n) }}
            onVer={() => onViewDetail(item.id)}
            onMenu={() => { setConfirmarBorrar(false); setMenu(item) }}
            semaforo={semaforo?.(item) ?? null}
          />
        ))}
      </ul>

      {menu && (
        <HojaInferior
          titulo={`${menu.code ? menu.code + ' ' : ''}${menu.description ?? ''}`}
          onCerrar={cerrarMenu}
          alto="max-h-[80dvh]"
        >
          {confirmarBorrar ? (
            <div className="px-5 py-4">
              <p className="text-[15px] text-gray-800">¿Borrar «{menu.description}»?</p>
              <p className="text-[13px] text-gray-500 mt-1">Se borra el trabajo con sus materiales y mano de obra.</p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setConfirmarBorrar(false)}
                  className="h-12 rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 active:bg-gray-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => { onDeleteItem?.(menu.id, menu.description ?? ''); cerrarMenu() }}
                  className="h-12 rounded-xl bg-red-500 text-white text-[15px] font-semibold active:bg-red-600"
                >
                  Borrar
                </button>
              </div>
            </div>
          ) : (
            <div role="menu" className="px-3 py-2">
              {[
                { key: 'ver', label: 'Ver el detalle', icon: FileText, on: () => { cerrarMenu(); onViewDetail(menu.id) }, mostrar: true, rojo: false },
                { key: 'cantidad', label: 'Cambiar la cantidad', icon: Pencil, on: () => { const id = menu.id; cerrarMenu(); setEditandoId(id) }, mostrar: !!onEditItem, rojo: false },
                { key: 'borrar', label: 'Borrar el trabajo', icon: Trash2, on: () => setConfirmarBorrar(true), mostrar: !!onDeleteItem, rojo: true },
              ].filter((o) => o.mostrar).map((o) => {
                const Icono = o.icon
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitem"
                    onClick={o.on}
                    className={`w-full text-left px-3 min-h-[52px] rounded-xl text-[15px] font-medium flex items-center gap-3 active:bg-gray-100 ${o.rojo ? 'text-red-600' : 'text-gray-800'}`}
                  >
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${o.rojo ? 'bg-red-50 text-red-500' : 'bg-[#E8F5EE] text-[#2D8D68]'}`}>
                      <Icono size={17} />
                    </span>
                    {o.label}
                  </button>
                )
              })}
            </div>
          )}
        </HojaInferior>
      )}
    </>
  )
}
