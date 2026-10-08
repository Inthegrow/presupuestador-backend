import { useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Search } from 'lucide-react'
import { conTildes } from '../../lib/textos'
import { palabrasDe, tieneTodas } from '../../lib/buscar'

// Una fórmula de la lista (en Cargar obra viene del catálogo del Maestro, en el detalle de las fórmulas de la empresa)
export interface FormulaBuscable {
  id?: string
  codigo: string
  nombre: string
  unidad?: string | null
  categoria?: string | null
}

// Una fórmula que la app propone para el trabajo
export interface FormulaQuizas {
  id?: string
  codigo: string
  nombre: string
  unidad?: string | null
  porque?: string | null
}

interface Props<R extends FormulaBuscable, Q extends FormulaQuizas> {
  recetas: R[]
  onElegir: (r: R) => void
  // Si viene, aparece el botón "Cerrar" al lado del buscador
  onCerrar?: () => void
  // Texto de ayuda debajo del buscador
  ayuda?: ReactNode
  // Opción propia de quien lo usa, arriba de la lista (ej. "Usar el precio del Excel")
  extra?: ReactNode
  // Bloque "Quizás sea:" antes de la lista: la propuesta de la app y hasta unas pocas parecidas
  quizas?: {
    propuesta?: Q | null
    parecidas?: Q[]
    onElegir: (q: Q, esPropuesta: boolean) => void
  }
  deshabilitado?: boolean
  // Clases del recuadro y de la lista (por defecto, el recuadro chico de Cargar obra)
  className?: string
  listaClassName?: string
  // Texto del buscador manejado desde afuera (si no viene, lo maneja el buscador)
  texto?: string
  onTexto?: (t: string) => void
  placeholder?: string
  autoFocus?: boolean
  inputRef?: Ref<HTMLInputElement>
  // true: "Quizás sea" y la lista aparecen recién cuando hay algo escrito (el renglón del editor)
  soloConTexto?: boolean
  // Enter en el buscador, con la primera fórmula de la lista filtrada (o null si no hay ninguna)
  onEnter?: (primera: R | null) => void
}

export default function BuscadorFormulas<R extends FormulaBuscable, Q extends FormulaQuizas = FormulaQuizas>({
  recetas, onElegir, onCerrar, ayuda, extra, quizas, deshabilitado = false,
  className = 'mt-3 border rounded-xl bg-white shadow-sm',
  listaClassName = 'max-h-64 overflow-y-auto',
  texto: textoDeAfuera, onTexto, placeholder = 'Buscá como hablás: revoque, pintura, contrapiso…',
  autoFocus = true, inputRef, soloConTexto = false, onEnter,
}: Props<R, Q>) {
  const [qPropio, setQPropio] = useState('')
  const q = textoDeAfuera ?? qPropio
  const setQ = (t: string) => {
    if (textoDeAfuera === undefined) setQPropio(t)
    onTexto?.(t)
  }
  // Cada palabra escrita tiene que estar (en cualquier orden): "hueco 18" encuentra "Hueco del 18"
  const palabras = palabrasDe(q)
  const texto = palabras.join(' ')
  const filtradas = recetas.filter((r) => tieneTodas(palabras, r.nombre, r.categoria))
  const grupos: Record<string, R[]> = {}
  for (const r of filtradas) (grupos[r.categoria || 'Otras'] ||= []).push(r)

  const propuesta = quizas?.propuesta ?? null
  const parecidas = (quizas?.parecidas ?? []).filter((p) => !propuesta || (p.id ?? p.codigo) !== (propuesta.id ?? propuesta.codigo))
  const hayQuizas = !!quizas && (propuesta !== null || parecidas.length > 0)
  const mostrarAbajo = !soloConTexto || texto !== ''

  function filaQuizas(s: Q, esPropuesta: boolean) {
    return (
      <button
        key={`${esPropuesta ? 'p' : 'q'}-${s.id ?? s.codigo}`}
        disabled={deshabilitado}
        onClick={() => quizas?.onElegir(s, esPropuesta)}
        className="w-full text-left px-3 py-1.5 max-md:py-2.5 hover:bg-white disabled:opacity-60 block"
      >
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-[#143D34]">{s.nombre}</span>
          {s.unidad && <span className="text-xs text-gray-500">({s.unidad})</span>}
          {esPropuesta && (
            <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-[#E8F5EE] text-[#2D8D68]">Propuesta</span>
          )}
        </span>
        {s.porque && <span className="block text-[11px] text-gray-500 font-normal">{s.porque}</span>}
      </button>
    )
  }

  return (
    <div className={className}>
      <div className={`flex items-center gap-2 px-3 py-2 max-md:py-1 ${mostrarAbajo || ayuda ? 'border-b' : ''}`}>
        <Search size={14} className="text-gray-400" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onEnter ? (e) => {
            if (e.key === 'Enter' && texto !== '') {
              e.preventDefault()
              onEnter(filtradas[0] ?? null)
            }
          } : undefined}
          placeholder={placeholder}
          className="flex-1 min-w-0 max-md:min-h-10 text-sm outline-none bg-transparent"
        />
        {onCerrar && <button onClick={onCerrar} className="max-md:min-h-10 max-md:px-2 max-md:-mr-2 max-md:text-sm text-xs text-gray-500 hover:text-gray-800">Cerrar</button>}
      </div>
      {ayuda && <p className="px-3 py-1.5 text-[11px] text-gray-500 border-b">{ayuda}</p>}
      {mostrarAbajo && hayQuizas && (
        <div className="border-b bg-[#E8F5EE]/50 py-1.5">
          <div className="px-3 pb-0.5 text-[11px] font-bold text-gray-500 uppercase tracking-wide">Quizás sea:</div>
          {propuesta && filaQuizas(propuesta, true)}
          {parecidas.map((p) => filaQuizas(p, false))}
        </div>
      )}
      {mostrarAbajo && <div className={listaClassName}>
        {extra}
        {Object.entries(grupos).map(([cat, items]) => (
          <div key={cat}>
            <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide">{conTildes(cat)}</div>
            {items.map((r) => (
              <button
                key={r.id ?? r.codigo}
                disabled={deshabilitado}
                onClick={() => onElegir(r)}
                className="w-full text-left px-3 py-1.5 max-md:py-2.5 text-sm hover:bg-gray-50 disabled:opacity-60 flex items-baseline gap-2"
              >
                <span className="text-gray-800">{r.nombre}</span>
                <span className="text-xs text-gray-500">({r.unidad || 's/u'})</span>
                <span className="text-[10px] text-gray-400 ml-auto">{r.codigo}</span>
              </button>
            ))}
          </div>
        ))}
        {filtradas.length === 0 && !(soloConTexto && hayQuizas) && <div className="px-3 py-3 text-xs text-gray-500">No encontré nada con esa palabra.</div>}
      </div>}
    </div>
  )
}
