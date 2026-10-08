import { useState, useRef, useEffect } from 'react'
import { Layers, Building2, Package, Wrench, HelpCircle, X } from 'lucide-react'
import type { ViewMode } from '../../lib/viewModes'
import { usePantalla } from '../../lib/pantalla'
import HojaInferior from '../editor/HojaInferior'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

const MODES: { key: ViewMode; label: string; icon: typeof Layers }[] = [
  { key: 'rubro', label: 'Rubro', icon: Layers },
  { key: 'piso', label: 'Piso', icon: Building2 },
  { key: 'material', label: 'Material', icon: Package },
  { key: 'tipo', label: 'Gremio', icon: Wrench },
]

const HELP_SECTIONS = [
  {
    emoji: '\u{1F3D7}\uFE0F',
    title: 'RUBRO',
    desc: 'Agrupa los trabajos por rubro, tal como están en el presupuesto (Tareas preliminares, Estructura, Albañilería…).',
  },
  {
    emoji: '\u{1F3E2}',
    title: 'PISO',
    desc: 'Agrupa los trabajos por planta del edificio (Subsuelo, Planta baja, Pisos, Azotea).',
  },
  {
    emoji: '\u{1F4E6}',
    title: 'MATERIAL',
    desc: 'Agrupa los trabajos por el material principal (Hormigón, Acero, Ladrillos, Cerámica…).',
  },
  {
    emoji: '\u{1F527}',
    title: 'GREMIO / ESPECIALIDAD',
    desc: 'Agrupa los trabajos por el gremio que los hace (Electricista, Plomero, Pintor, Carpintero…). Sirve para ver cuánto trabajo tiene cada gremio.',
  },
]

export default function ViewModeSelector({ mode, onChange }: Props) {
  const { celular } = usePantalla()
  const [showHelp, setShowHelp] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!showHelp || celular) return
    function handleClick(e: MouseEvent) {
      if (
        helpRef.current &&
        !helpRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setShowHelp(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showHelp, celular])

  const ayuda = (
    <div className="space-y-3">
      {HELP_SECTIONS.map((sec) => (
        <div key={sec.title} className="flex gap-2.5">
          <span className="text-base flex-shrink-0 mt-0.5">{sec.emoji}</span>
          <div>
            <div className="text-[11px] md:text-[11px] font-bold text-gray-700">{sec.title}</div>
            <div className="text-[13px] md:text-[11px] text-gray-500 leading-relaxed">{sec.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* En el celular las pestañas se deslizan de costado */}
      <div className="flex gap-1 p-1 rounded-2xl bg-gray-50 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MODES.map(({ key, label, icon: Icon }) => {
          const active = mode === key
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              aria-pressed={active}
              className={`flex-shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2 max-md:min-h-10 max-md:px-4 max-md:text-[13px] [@media(max-height:800px)]:md:py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 ${
                active
                  ? 'bg-[#2D8D68] text-white shadow-md'
                  : 'bg-gray-100 border border-gray-200 text-gray-500 hover:bg-gray-200'
              }`}
            >
              <Icon size={13} className={active ? 'text-white' : ''} />
              {label}
            </button>
          )
        })}
      </div>

      {/* Help button */}
      <div className="relative flex-shrink-0">
        <button
          ref={btnRef}
          onClick={() => setShowHelp((v) => !v)}
          className="w-7 h-7 max-md:w-10 max-md:h-10 flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          aria-label="Qué muestra cada vista" title="Qué muestra cada vista"
          aria-expanded={showHelp}
        >
          <HelpCircle size={15} />
        </button>

        {showHelp && !celular && (
          <div
            ref={helpRef}
            className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-800 tracking-wide">VISTAS DEL PRESUPUESTO</h3>
              <button
                onClick={() => setShowHelp(false)}
                aria-label="Cerrar"
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            {ayuda}
          </div>
        )}
      </div>
      {showHelp && celular && (
        <HojaInferior titulo="Vistas del presupuesto" onCerrar={() => setShowHelp(false)}>
          <div className="px-5 py-4">{ayuda}</div>
        </HojaInferior>
      )}
    </div>
  )
}
