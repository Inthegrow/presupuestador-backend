import { ArrowRight, ChevronDown } from 'lucide-react'
import { fmtPesos } from '../../lib/format'
import { fmtPct } from '../../lib/cascada'
import type { Escalera, PctsEscalera } from '../../lib/cascada'

interface Props {
  escalera: Escalera
  pcts: PctsEscalera | null
  trabajos: number
  // 'renglon': notebook baja, todo en un renglón. 'tarjeta': celular, los dos precios grandes.
  variante: 'renglon' | 'tarjeta'
  onVer: () => void
}

/**
 * La escalera del precio cerrada: Costo directo → Precio sin IVA · con IVA, con "Ver la escalera" para abrirla entera.
 * Usa los mismos data-testid que la escalera abierta (escalera, escalera-directo, precio-sin-iva, precio-con-iva).
 */
export default function EscaleraResumen({ escalera: e, pcts, trabajos, variante, onVer }: Props) {
  const cuantos = `${trabajos} ${trabajos === 1 ? 'trabajo' : 'trabajos'}`
  const conIva = e.total_final === null ? '—' : fmtPesos(e.total_final)

  if (variante === 'renglon') {
    return (
      <section
        data-testid="escalera"
        aria-label="Del costo directo al precio"
        className="bg-white rounded-2xl shadow-sm border border-gray-100 pl-4 pr-1.5 h-12 flex items-center gap-x-3 min-w-0 whitespace-nowrap"
      >
        <span className="hidden xl:inline text-[11px] text-gray-500 flex-shrink-0">Todo el presupuesto · {cuantos}</span>
        <span className="hidden xl:inline w-px h-5 bg-gray-200 flex-shrink-0" aria-hidden />
        <span data-testid="escalera-directo" data-valor={e.directo} className="text-xs text-gray-600 flex-shrink-0">
          Costo directo <b className="font-bold text-gray-900 tabular-nums">{fmtPesos(e.directo)}</b>
        </span>
        <ArrowRight size={14} className="text-gray-300 flex-shrink-0" aria-hidden />
        <span
          data-testid="precio-sin-iva"
          data-valor={e.neto}
          className="text-xs text-white/85 bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] rounded-lg px-2.5 py-1 flex-shrink-0 shadow-sm"
        >
          Precio sin IVA <b className="font-extrabold text-white text-sm tabular-nums">{fmtPesos(e.neto)}</b>
        </span>
        <span
          data-testid="precio-con-iva"
          data-valor={e.total_final ?? ''}
          className="text-xs text-[#1B5E4B] flex-shrink-0"
          title={e.iva === null ? 'Falta saber el % de IVA' : `IVA${pcts ? ` ${fmtPct(pcts.iva)}%` : ''}: ${fmtPesos(e.iva)}`}
        >
          <span className="text-gray-300 mr-2" aria-hidden>·</span>
          con IVA <b className="font-bold text-[#143D34] tabular-nums">{conIva}</b>
        </span>
        <button
          type="button"
          onClick={onVer}
          aria-expanded={false}
          className="ml-auto flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-[#2D8D68] hover:bg-[#E8F5EE] rounded-xl px-3 h-9"
        >
          Ver la escalera <ChevronDown size={14} />
        </button>
      </section>
    )
  }

  return (
    <section
      data-testid="escalera"
      aria-label="Del costo directo al precio"
      className="rounded-2xl overflow-hidden shadow-sm bg-gradient-to-br from-[#2D8D68] to-[#143D34] text-white"
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="text-[12px] text-white/70">Todo el presupuesto · {cuantos}</div>
        <div data-testid="precio-sin-iva" data-valor={e.neto} className="mt-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/80">Precio sin IVA</div>
          <div className="text-[26px] leading-tight font-extrabold tabular-nums">{fmtPesos(e.neto)}</div>
        </div>
        <div data-testid="precio-con-iva" data-valor={e.total_final ?? ''} className="mt-2 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/80">Precio con IVA</div>
            <div className="text-[21px] leading-tight font-bold tabular-nums">{conIva}</div>
          </div>
          <div className="text-[12px] text-white/75 pb-0.5">
            {e.iva === null ? 'Falta saber el % de IVA' : <>IVA{pcts ? ` ${fmtPct(pcts.iva)}%` : ''}: {fmtPesos(e.iva)}</>}
          </div>
        </div>
        <div
          data-testid="escalera-directo"
          data-valor={e.directo}
          className="mt-3 pt-2.5 border-t border-white/15 flex items-baseline justify-between gap-3 text-[13px] text-white/80"
        >
          <span>Costo directo</span>
          <b className="font-semibold text-white tabular-nums">{fmtPesos(e.directo)}</b>
        </div>
      </div>
      <button
        type="button"
        onClick={onVer}
        aria-expanded={false}
        className="w-full flex items-center justify-center gap-1.5 text-[14px] font-semibold text-white bg-black/15 active:bg-black/25 h-11"
      >
        Ver la escalera <ChevronDown size={16} />
      </button>
    </section>
  )
}
