import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  titulo: ReactNode
  onCerrar: () => void
  children: ReactNode
  // Lo que va a la derecha del título (ej. "+ Rubro")
  accion?: ReactNode
  // Botones fijos abajo
  pie?: ReactNode
  testId?: string
  // Alto máximo de la hoja (por defecto, casi toda la pantalla)
  alto?: string
}

/**
 * Hoja que sube desde abajo (celular): el título y la X quedan fijos arriba, lo de adentro se desliza y los botones
 * del pie quedan fijos abajo. Se cierra con la X, tocando afuera o con Esc.
 */
export default function HojaInferior({ titulo, onCerrar, children, accion, pie, testId, alto = 'max-h-[88dvh]' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cerrarRef = useRef(onCerrar)
  cerrarRef.current = onCerrar

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarRef.current() }
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('keydown', tecla)
      antes?.focus?.()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid={testId}>
      <style>{`
        @keyframes hojaSube { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes hojaFondo { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <div
        className="absolute inset-0 bg-[#0B1F1A]/45 backdrop-blur-[1px] [animation:hojaFondo_.2s_ease-out]"
        onClick={onCerrar}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof titulo === 'string' ? titulo : undefined}
        tabIndex={-1}
        className={`relative bg-white rounded-t-3xl shadow-2xl flex flex-col md:max-w-lg md:w-full md:mx-auto ${alto} outline-none pb-[env(safe-area-inset-bottom)] [animation:hojaSube_.24s_cubic-bezier(.2,.8,.2,1)]`}
      >
        <div className="flex justify-center pt-2 pb-1" aria-hidden>
          <span className="w-10 h-1 rounded-full bg-gray-200" />
        </div>
        <div className="flex items-center gap-2 pl-5 pr-2 pb-2 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0 font-bold text-[15px] text-[#143D34] truncate">{titulo}</div>
          {accion}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="w-10 h-10 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 active:bg-gray-200"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        {pie && <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 bg-white">{pie}</div>}
      </div>
    </div>
  )
}
