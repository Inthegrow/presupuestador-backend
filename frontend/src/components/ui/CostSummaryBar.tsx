import type { ReactNode } from 'react'
import { fmtPesos } from '../../lib/format'
import { fmtPct } from '../../lib/cascada'
import type { Escalera, PctsEscalera } from '../../lib/cascada'

interface Props {
  // Los totales guardados, ya sumados (lib/cascada.ts → escaleraDe)
  escalera: Escalera
  // Los % de la obra; null mientras cargan o si no se pudieron leer: entonces no se muestra ningún %
  pcts: PctsEscalera | null
  // Qué se está sumando (ej. "Todo el presupuesto · 42 trabajos")
  titulo?: ReactNode
}

function Chip({ pct, testId }: { pct: number | undefined; testId?: string }) {
  if (pct === undefined) return null
  return (
    <span
      data-testid={testId}
      className="text-[10px] font-bold px-1.5 rounded-full bg-gray-100 text-gray-600 normal-case tracking-normal tabular-nums"
    >
      {fmtPct(pct)}%
    </span>
  )
}

function Peldano({
  signo, label, pct, pctTestId, valor, testId, detalle,
}: {
  signo?: string
  label: string
  pct?: number
  pctTestId?: string
  valor: number
  testId: string
  detalle?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-2.5 py-2.5 min-w-0" data-testid={testId} data-valor={valor}>
      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
        {signo && <span className="text-gray-300 font-bold" aria-hidden>{signo}</span>}
        <span>{label}</span>
        <Chip pct={pct} testId={pctTestId} />
      </div>
      <div className="font-bold text-sm @xs:text-[15px] @4xl:text-sm @6xl:text-[15px] text-gray-900 tabular-nums mt-0.5 [overflow-wrap:anywhere]">{fmtPesos(valor)}</div>
      {detalle && <div className="text-[10px] text-gray-400 mt-0.5 leading-snug">{detalle}</div>}
    </div>
  )
}

/**
 * La escalera del precio, con lo guardado: Costo directo → + Indirectos → + Beneficio → + Impuestos
 * = Precio sin IVA → + IVA = Precio con IVA. Los renglones suman (Impuestos es lo que va del subtotal al precio).
 * Se acomoda al ancho de su caja: 6 columnas, 3, 2 o 1.
 */
export default function CostSummaryBar({ escalera: e, pcts, titulo }: Props) {
  return (
    <section className="@container" data-testid="escalera" aria-label="Del costo directo al precio">
      {titulo && <div className="text-[11px] text-gray-500 mb-1.5">{titulo}</div>}
      <div className="grid grid-cols-1 @xs:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-[repeat(4,minmax(0,1fr))_repeat(2,minmax(0,1.15fr))] gap-2">
        <Peldano
          label="Costo directo"
          valor={e.directo}
          testId="escalera-directo"
          detalle={e.mat || e.mo ? `Materiales ${fmtPesos(e.mat)} · Mano de obra ${fmtPesos(e.mo)}` : undefined}
        />
        <Peldano signo="+" label="Indirectos" pct={pcts?.indirecto} pctTestId="pct-indirectos" valor={e.indirecto} testId="escalera-indirectos" />
        <Peldano signo="+" label="Beneficio" pct={pcts?.beneficio} valor={e.beneficio} testId="escalera-beneficio" />
        <Peldano
          signo="+"
          label="Impuestos"
          pct={pcts?.impuestos}
          valor={e.impuestos}
          testId="escalera-impuestos"
          detalle="Ingresos Brutos y cheque"
        />

        {/* Precio sin IVA: el número que manda */}
        <div
          className="rounded-xl px-3 py-2.5 min-w-0 bg-gradient-to-br from-[#2D8D68] to-[#1B5E4B] text-white shadow-sm"
          data-testid="precio-sin-iva"
          data-valor={e.neto}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
            <span aria-hidden>=</span> Precio sin IVA
          </div>
          <div className="font-extrabold text-sm @3xs:text-base @xs:text-lg @4xl:text-base @6xl:text-lg tabular-nums mt-0.5 [overflow-wrap:anywhere]">{fmtPesos(e.neto)}</div>
        </div>

        {/* Precio con IVA */}
        <div
          className="rounded-xl px-3 py-2.5 min-w-0 bg-[#E8F5EE] border border-[#2D8D68]/25"
          data-testid="precio-con-iva"
          data-valor={e.total_final ?? ''}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#1B5E4B]">
            <span aria-hidden className="text-[#2D8D68]/60">+</span> Precio con IVA
          </div>
          <div className="font-extrabold text-sm @3xs:text-base @xs:text-lg @4xl:text-base @6xl:text-lg text-[#143D34] tabular-nums mt-0.5 [overflow-wrap:anywhere]">
            {e.total_final === null ? '—' : fmtPesos(e.total_final)}
          </div>
          <div className="text-[10px] text-[#2D8D68] mt-0.5">
            {e.iva === null
              ? 'Falta saber el % de IVA'
              : <>IVA{pcts ? ` ${fmtPct(pcts.iva)}%` : ''}: {fmtPesos(e.iva)}</>}
          </div>
        </div>
      </div>
    </section>
  )
}
