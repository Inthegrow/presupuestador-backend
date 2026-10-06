import { useState } from 'react'
import { ChevronRight, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { fmtCurrency } from '../../lib/format'

interface MarkupLink {
  label: string
  pct: number
}

interface Props {
  directo: number
  neto: number
  links: MarkupLink[]
  budgetId?: string
}

export default function MarkupChainDisplay({ directo, neto, links, budgetId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()

  const totalPct = links.reduce((sum, l) => sum + l.pct, 0)

  return (
    <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
      {/* Collapsed header - always visible */}
      <div
        className="flex items-center justify-between cursor-pointer select-none group"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={14}
            className={`text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold group-hover:text-gray-600 transition-colors">
            Coeficiente de pase
          </span>
          {!expanded && (
            <span className="text-[10px] font-medium text-[#E8663C] bg-[#E8663C]/8 px-2 py-0.5 rounded-full">
              {totalPct}% indirecto
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-[10px] font-semibold text-[#9D7A32]">
              NETO {fmtCurrency(neto)}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigate(budgetId ? `/app/settings/markups?budget=${budgetId}` : '/app/settings/markups')
            }}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-[#2D8D68] font-medium transition-colors px-1.5 py-0.5 rounded-md hover:bg-[#E8F5EE]/50"
          >
            <Settings2 size={11} />
            Configurar
          </button>
        </div>
      </div>

      {/* Expandable pills chain */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: expanded ? '120px' : '0px',
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-0 flex-wrap pt-2.5">
          {/* Directo pill */}
          <div className="flex items-center gap-0">
            <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-[#E8F5EE] text-[#143D34] border border-[#2D8D68]/20 shadow-sm">
              {fmtCurrency(directo)}
            </span>
          </div>

          {/* Markup links */}
          {links.map((link) => (
            <div key={link.label} className="flex items-center gap-0">
              {/* Arrow connector */}
              <svg width="24" height="12" viewBox="0 0 24 12" className="text-gray-300 flex-shrink-0">
                <line x1="0" y1="6" x2="18" y2="6" stroke="currentColor" strokeWidth="1.5" />
                <polygon points="16,2 22,6 16,10" fill="currentColor" />
              </svg>
              <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold bg-white text-gray-600 border border-gray-200 shadow-sm hover:shadow transition-shadow">
                <span className="text-gray-400">+</span>
                {link.label}
                <span className="text-[10px] font-bold text-[#E8663C] bg-[#E8663C]/8 px-1.5 py-0 rounded-full">{link.pct}%</span>
              </span>
            </div>
          ))}

          {/* Final arrow to Neto */}
          <svg width="24" height="12" viewBox="0 0 24 12" className="text-[#E0A33A] flex-shrink-0">
            <line x1="0" y1="6" x2="18" y2="6" stroke="currentColor" strokeWidth="1.5" />
            <polygon points="16,2 22,6 16,10" fill="currentColor" />
          </svg>

          {/* Neto pill */}
          <span className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-gradient-to-r from-[#FDF6E3] to-[#FEF9EE] text-[#9D7A32] border border-[#E0A33A]/30 shadow-md">
            NETO {fmtCurrency(neto)}
          </span>
        </div>
      </div>
    </div>
  )
}
