import { Check } from 'lucide-react'
import type { FaltaConversion } from '../../lib/api'

// La unidad de la fórmula no es la del trabajo: pregunta cuánto es (la usan el detalle del trabajo y el editor)
interface Props {
  // Nombre de la fórmula elegida
  titulo: string
  det: FaltaConversion
  valor: string
  onValor: (v: string) => void
  onEnviar: () => void
  onCancelar: () => void
  ocupado: boolean
  // Texto del botón (en el detalle "Aplicar", en el editor "Agregar")
  accion?: string
  // Texto del botón mientras espera
  accionEnCurso?: string
}

/** El número que escribió Sol ("0,08" o "0.08"), o null si no es un número mayor que cero. */
export function leerFactor(valor: string): number | null {
  const n = Number(valor.trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** El valor con que arranca la pregunta: el propuesto, con coma decimal. */
export function factorComoTexto(factor: number | null | undefined): string {
  return factor != null ? String(factor).replace('.', ',') : ''
}

export default function PreguntaConversion({
  titulo, det, valor, onValor, onEnviar, onCancelar, ocupado,
  accion = 'Aplicar', accionEnCurso = 'Aplicando...',
}: Props) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-700">
      <div className="font-semibold text-[#143D34] text-sm mb-1">{titulo}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span>{det.mensaje}</span>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={valor}
          onChange={(e) => onValor(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnviar() }}
          className="border rounded-lg px-2 py-1 w-24 bg-white"
        />
        <span className="text-gray-500">{det.unidad_formula}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-1.5">
        Para contrapisos y carpetas es el espesor en metros: 10 cm = 0,10
      </p>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onEnviar}
          disabled={ocupado}
          className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {ocupado ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {accionEnCurso}
            </>
          ) : (
            <>
              <Check size={12} />
              {accion}
            </>
          )}
        </button>
        <button
          onClick={onCancelar}
          disabled={ocupado}
          className="text-xs bg-white border text-gray-700 px-3 py-1.5 rounded-lg font-semibold hover:bg-gray-100 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
