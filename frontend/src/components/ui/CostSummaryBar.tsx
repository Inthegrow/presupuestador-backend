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
  // Lo que va a la derecha del título (ej. "Ocultar la escalera")
  accion?: ReactNode
  // true: los 6 escalones uno debajo del otro (celular)
  apilada?: boolean
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
  signo, label, pct, pctTestId, valor, testId, detalle, apilada,
}: {
  apilada?: boolean
  signo?: string
  label: string
  pct?: number
  pctTestId?: string
  valor: number
  testId: string
  detalle?: ReactNode
}) {
  return (
    <div
      className={`rounded-xl border border-gray-100 bg-white min-w-0 ${apilada ? 'px-3 py-2 grid grid-cols-[1fr_auto] items-center gap-x-3' : 'px-2.5 py-2.5'}`}
      data-testid={testId}
      data-valor={valor}
    >
      <div className={`flex items-center flex-wrap gap-x-1.5 gap-y-0.5 font-semibold text-gray-500 uppercase tracking-wide ${apilada ? 'text-[11px]' : 'text-[10px]'}`}>
        {signo && <span className="text-gray-300 font-bold" aria-hidden>{signo}</span>}
        <span>{label}</span>
        <Chip pct={pct} testId={pctTestId} />
      </div>
      <div className={apilada
        ? 'font-bold text-[15px] text-gray-900 tabular-nums text-right whitespace-nowrap'
        : 'font-bold text-sm @xs:text-[15px] @4xl:text-sm @6xl:text-[15px] text-gray-900 tabular-nums mt-0.5 [overflow-wrap:anywhere]'}>{fmtPesos(valor)}</div>
      {detalle && <div className={`text-gray-400 mt-0.5 leading-snug ${apilada ? 'text-[11px] col-span-2' : 'text-[10px]'}`}>{detalle}</div>}
    </div>
  )
}

/**
 * La escalera del precio, con lo guardado: Costo directo → + Indirectos → + Beneficio → + Impuestos
 * = Precio sin IVA → + IVA = Precio con IVA. Los renglones suman (Impuestos es lo que va del subtotal al precio).
 * Se acomoda al ancho de su caja: 6 columnas, 3, 2 o 1.
 */
export default function CostSummaryBar({ escalera: e, pcts, titulo, accion, apilada = false }: Props) {
  return (
    <section className="@container" data-testid="escalera" aria-label="Del costo directo al precio">
      {(titulo || accion) && (
        <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[20px]">
          <div className="text-[11px] text-gray-500">{titulo}</div>
          {accion}
        </div>
      )}
      <div className={apilada
        ? 'grid grid-cols-1 gap-1.5'
        : 'grid grid-cols-1 @xs:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-[repeat(4,minmax(0,1fr))_repeat(2,minmax(0,1.15fr))] gap-2'}>
        <Peldano
          label="Costo directo" apilada={apilada}
          valor={e.directo}
          testId="escalera-directo"
          detalle={e.mat || e.mo ? `Materiales ${fmtPesos(e.mat)} · Mano de obra ${fmtPesos(e.mo)}` : undefined}
        />
        <Peldano signo="+" label="Indirectos" apilada={apilada} pct={pcts?.indirecto} pctTestId="pct-indirectos" valor={e.indirecto} testId="escalera-indirectos" />
        <Peldano signo="+" label="Beneficio" apilada={apilada} pct={pcts?.beneficio} valor={e.beneficio} testId="escalera-beneficio" />
        <Peldano
          signo="+"
          label="Impuestos" apilada={apilada}
          pct={pcts?.impuestos}
          valor={e.impuestos}
          testId="escalera-impuestos"
          detalle="Ingresos Brutos y cheque"
        />

        {/* Precio sin IVA: el número que manda */}
        <div
          className={`rounded-xl px-3 py-2.5 min-w-0 bg-gradient-to-br from-[#2D8D68] to-[#1B5E4B] text-white shadow-sm ${apilada ? 'flex items-center justify-between gap-3' : ''}`}
          data-testid="precio-sin-iva"
          data-valor={e.neto}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
            <span aria-hidden>=</span> Precio sin IVA
          </div>
          <div className={apilada
            ? 'font-extrabold text-lg tabular-nums whitespace-nowrap'
            : 'font-extrabold text-[length:min(1.125rem,4.8cqw)] @2xl:text-lg @4xl:text-base @6xl:text-lg whitespace-nowrap tabular-nums mt-0.5 [overflow-wrap:anywhere]'}>{fmtPesos(e.neto)}</div>
        </div>

        {/* Precio con IVA */}
        <div
          className={`rounded-xl px-3 py-2.5 min-w-0 bg-[#E8F5EE] border border-[#2D8D68]/25 ${apilada ? 'grid grid-cols-[1fr_auto] items-center gap-x-3' : ''}`}
          data-testid="precio-con-iva"
          data-valor={e.total_final ?? ''}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#1B5E4B]">
            <span aria-hidden className="text-[#2D8D68]/60">+</span> Precio con IVA
          </div>
          <div className={apilada
            ? 'font-extrabold text-lg text-[#143D34] tabular-nums whitespace-nowrap text-right'
            : 'font-extrabold text-[length:min(1.125rem,4.8cqw)] @2xl:text-lg @4xl:text-base @6xl:text-lg whitespace-nowrap text-[#143D34] tabular-nums mt-0.5 [overflow-wrap:anywhere]'}>
            {e.total_final === null ? '—' : fmtPesos(e.total_final)}
          </div>
          <div className={`text-[#2D8D68] mt-0.5 ${apilada ? 'text-[11px] col-span-2' : 'text-[10px]'}`}>
            {e.iva === null
              ? 'Falta saber el % de IVA'
              : <>IVA{pcts ? ` ${fmtPct(pcts.iva)}%` : ''}: {fmtPesos(e.iva)}</>}
          </div>
        </div>
      </div>
    </section>
  )
}
