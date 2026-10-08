import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { MoreHorizontal } from 'lucide-react'
import HojaInferior from './HojaInferior'

export interface Accion {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  title?: string
  // Gira el ícono (ej. mientras recalcula)
  girando?: boolean
  // Cuanto más alto, más tiempo queda a la vista antes de pasar a "Más"
  prioridad: number
}

interface Props {
  acciones: Accion[]
  // El botón que siempre queda a la vista (Guardar versión)
  principal?: ReactNode
  // Celular: todas las acciones van a "Más"
  todasEnMas: boolean
  // El renglón del encabezado (se mide su ancho) y cuánto necesita como mínimo lo de la izquierda (nombre y estado)
  fila: RefObject<HTMLElement | null>
  minIzquierda: () => number
  // Cambia cuando cambia lo de la izquierda (el nombre): vuelve a medir
  medirOtraVez?: unknown
}

const SEPARACION = 8

const claseBoton =
  'flex-shrink-0 whitespace-nowrap bg-white border border-gray-200 text-gray-700 px-3.5 h-9 rounded-xl text-xs font-medium hover:bg-gray-50 hover:shadow-sm flex items-center gap-1.5 transition-all duration-200 disabled:opacity-50'

function BotonAccion({ a }: { a: Accion }) {
  const Icono = a.icon
  return (
    <button type="button" onClick={a.onClick} disabled={a.disabled} title={a.title} className={claseBoton}>
      <Icono size={13} className={a.girando ? 'animate-spin' : ''} />
      {a.label}
    </button>
  )
}

/**
 * Los botones del encabezado del editor en un solo renglón: los que entran quedan a la vista y el resto va a "Más" (⋯).
 * En el celular todos van a "Más", que se abre como una hoja desde abajo con botones grandes.
 */
export default function AccionesEncabezado({ acciones, principal, todasEnMas, fila, minIzquierda, medirOtraVez }: Props) {
  const [aLaVista, setALaVista] = useState<Set<string>>(() => new Set(acciones.map((a) => a.key)))
  const [abierto, setAbierto] = useState(false)
  const medirRef = useRef<HTMLDivElement>(null)
  const principalRef = useRef<HTMLDivElement>(null)
  const minIzqRef = useRef(minIzquierda)
  minIzqRef.current = minIzquierda
  const claves = acciones.map((a) => `${a.key}:${a.label}`).join('|')

  useLayoutEffect(() => {
    if (todasEnMas) return
    const el = fila.current
    if (!el) return
    const calcular = () => {
      const caja = medirRef.current
      if (!caja) return
      const ancho = (k: string) => (caja.querySelector(`[data-medir="${k}"]`) as HTMLElement | null)?.getBoundingClientRect().width ?? 0
      const anchoMas = ancho('__mas')
      const anchoPrincipal = principalRef.current?.getBoundingClientRect().width ?? 0
      let libre = el.clientWidth - minIzqRef.current() - (anchoPrincipal ? anchoPrincipal + SEPARACION : 0)
      const total = acciones.reduce((s, a) => s + ancho(a.key) + SEPARACION, 0)
      let nuevas: Set<string>
      if (total <= libre) {
        nuevas = new Set(acciones.map((a) => a.key))
      } else {
        libre -= anchoMas + SEPARACION
        nuevas = new Set()
        for (const a of [...acciones].sort((x, y) => y.prioridad - x.prioridad)) {
          const w = ancho(a.key) + SEPARACION
          if (w > libre) break
          libre -= w
          nuevas.add(a.key)
        }
      }
      setALaVista((antes) => (antes.size === nuevas.size && [...nuevas].every((k) => antes.has(k)) ? antes : nuevas))
    }
    calcular()
    const ro = new ResizeObserver(calcular)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claves, todasEnMas, fila, medirOtraVez])

  // Esc cierra el menú de la notebook (la hoja del celular se cierra sola)
  useEffect(() => {
    if (!abierto || todasEnMas) return
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [abierto, todasEnMas])

  const visibles = todasEnMas ? [] : acciones.filter((a) => aLaVista.has(a.key))
  const enMas = todasEnMas ? acciones : acciones.filter((a) => !aLaVista.has(a.key))
  const elegir = (a: Accion) => { setAbierto(false); a.onClick() }

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {/* Copias invisibles para medir el ancho de cada botón */}
      {!todasEnMas && (
        <div ref={medirRef} aria-hidden inert className="absolute w-0 h-0 overflow-hidden invisible pointer-events-none">
          <div className="flex w-max gap-2">
            {acciones.map((a) => (
              <div key={a.key} data-medir={a.key}><BotonAccion a={a} /></div>
            ))}
            <div data-medir="__mas">
              <span className={claseBoton}><MoreHorizontal size={15} /> Más</span>
            </div>
          </div>
        </div>
      )}

      {visibles.map((a) => <BotonAccion key={a.key} a={a} />)}

      {enMas.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-label="Más"
            aria-haspopup="menu"
            aria-expanded={abierto}
            title="Más acciones"
            className={todasEnMas
              ? 'w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 active:bg-gray-100'
              : `${claseBoton} ${abierto ? 'bg-gray-50 border-gray-300' : ''}`}
          >
            <MoreHorizontal size={todasEnMas ? 20 : 15} />
            {!todasEnMas && <span aria-hidden>Más</span>}
          </button>
          {abierto && !todasEnMas && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setAbierto(false)} aria-hidden />
              <div role="menu" className="absolute right-0 top-full mt-1.5 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[220px]">
                {enMas.map((a) => {
                  const Icono = a.icon
                  return (
                    <button
                      key={a.key}
                      type="button"
                      role="menuitem"
                      onClick={() => elegir(a)}
                      disabled={a.disabled}
                      title={a.title}
                      className="w-full text-left px-3.5 py-2 max-lg:min-h-11 max-lg:text-[13px] text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 disabled:opacity-50"
                    >
                      <Icono size={14} className={`text-gray-400 ${a.girando ? 'animate-spin' : ''}`} />
                      {a.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {principal && <div ref={principalRef} className="flex-shrink-0">{principal}</div>}

      {abierto && todasEnMas && (
        <HojaInferior titulo="Más" onCerrar={() => setAbierto(false)} alto="max-h-[80dvh]">
          <div role="menu" className="px-3 py-2">
            {enMas.map((a) => {
              const Icono = a.icon
              return (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  onClick={() => elegir(a)}
                  disabled={a.disabled}
                  className="w-full text-left px-3 min-h-[52px] rounded-xl text-[15px] font-medium text-gray-800 active:bg-gray-100 flex items-center gap-3 disabled:opacity-50"
                >
                  <span className="w-9 h-9 rounded-full bg-[#E8F5EE] text-[#2D8D68] flex items-center justify-center flex-shrink-0">
                    <Icono size={17} className={a.girando ? 'animate-spin' : ''} />
                  </span>
                  <span className="flex-1">
                    {a.label}
                    {a.title && <span className="block text-xs font-normal text-gray-500">{a.title}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </HojaInferior>
      )}
    </div>
  )
}
