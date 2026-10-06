import { useState } from 'react'
import { ChevronRight, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cascadaIndirectos, fmtPct, indirectosCompletos, pctsEscalera } from '../../lib/cascada'
import { fmtNumber } from '../../lib/format'
import type { IndirectConfig } from '../../types'

interface Props {
  // Los % de esta obra. null = todavía no llegaron (o no se pudieron leer): no se muestra ningún número
  config: IndirectConfig | null
  budgetId?: string
  // true = no se pudieron leer (en vez de "cargando")
  fallo?: boolean
}

const CONCEPTOS: { key: keyof IndirectConfig; label: string }[] = [
  { key: 'imprevistos_pct', label: 'Imprevistos' },
  { key: 'estructura_pct', label: 'Estructura' },
  { key: 'jefatura_pct', label: 'Jefatura' },
  { key: 'logistica_pct', label: 'Logística' },
  { key: 'herramientas_pct', label: 'Herramientas' },
]

function Pill({ label, pct, fuerte = false }: { label: string; pct: number; fuerte?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border ${
        fuerte ? 'bg-[#E8F5EE] border-[#2D8D68]/25 text-[#143D34] font-semibold' : 'bg-white border-gray-200 text-gray-600'
      }`}
    >
      {label}
      <span className="font-bold tabular-nums">{fmtPct(pct)}%</span>
    </span>
  )
}

/** El Coeficiente de pase de la obra, en una línea; abierto, de qué está hecho cada %. */
export default function MarkupChainDisplay({ config, budgetId, fallo = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const pcts = pctsEscalera(config)
  const completos = config ? indirectosCompletos(config) : null
  // Precio sin IVA por cada $100 de costo directo (el servidor lo manda como coeficiente por $1)
  const por100 = config
    ? typeof config.coeficiente === 'number' && Number.isFinite(config.coeficiente)
      ? config.coeficiente * 100
      : cascadaIndirectos(100, indirectosCompletos(config)).neto
    : null

  return (
    <div className="px-1 py-1.5" data-testid="coeficiente-pase">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          disabled={!pcts}
          className="flex items-center gap-2 flex-wrap text-left group disabled:cursor-default"
        >
          <ChevronRight
            size={14}
            className={`text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''} ${pcts ? '' : 'opacity-0'}`}
          />
          <span className="text-[11px] font-semibold text-gray-600 group-hover:text-gray-900">Coeficiente de pase</span>
          {pcts ? (
            <span className="text-[11px] text-gray-500">
              <span data-testid="pct-indirecto-linea">{fmtPct(pcts.indirecto)}% indirectos</span>
              {' · '}{fmtPct(pcts.beneficio)}% beneficio{' · '}{fmtPct(pcts.impuestos)}% impuestos
              {por100 !== null && (
                <span className="text-gray-400"> — por cada $100 de costo directo, ${fmtNumber(por100)} sin IVA</span>
              )}
            </span>
          ) : (
            <span className={`text-[11px] ${fallo ? 'text-red-600' : 'text-gray-400'}`}>
              {fallo ? 'No pude leer los porcentajes de esta obra.' : 'Cargando los porcentajes…'}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => navigate(budgetId ? `/app/settings/markups?budget=${budgetId}` : '/app/settings/markups')}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#2D8D68] font-medium transition-colors px-2 py-1 rounded-lg hover:bg-[#E8F5EE]/60"
        >
          <Settings2 size={12} />
          Editar porcentajes
        </button>
      </div>

      {expanded && pcts && completos && (
        <div className="flex items-center gap-1.5 flex-wrap pt-2 pl-6">
          {CONCEPTOS.map((c) => (
            <Pill key={c.key} label={c.label} pct={completos[c.key as keyof typeof completos]} />
          ))}
          <span className="text-gray-300 text-xs" aria-hidden>=</span>
          <Pill label="Indirectos" pct={pcts.indirecto} fuerte />
          <span className="text-gray-300 text-xs" aria-hidden>·</span>
          <Pill label="Beneficio" pct={pcts.beneficio} fuerte />
          <span className="text-gray-300 text-xs" aria-hidden>·</span>
          <Pill label="Ingresos Brutos" pct={completos.ingresos_brutos_pct} />
          <Pill label="Cheque" pct={completos.imp_cheque_pct} />
          <span className="text-gray-300 text-xs" aria-hidden>·</span>
          <Pill label="IVA" pct={pcts.iva} />
        </div>
      )}
    </div>
  )
}
