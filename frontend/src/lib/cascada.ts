// Cascada de indirectos: la MISMA cuenta que calc_cascade_indirects (app/calculations.py),
// con el mismo orden, los mismos valores por defecto y el mismo redondeo a centavos.
// Si cambia allá, cambia acá (scripts/e2e_nuevo_presupuesto.cjs compara las dos).
//
//   Directo
//   + Imprevistos + Estructura + Jefatura + Logística + Herramientas (sobre directo) = Subtotal 02
//   + Beneficio (sobre Subtotal 02)                                                  = Subtotal 03
//   + Ingresos Brutos + Impuesto al cheque (sobre Subtotal 03)                       = Neto (sin IVA)
//   + IVA (sobre Neto)                                                               = Total final

export const CLAVES_INDIRECTOS = [
  'imprevistos_pct',
  'estructura_pct',
  'jefatura_pct',
  'logistica_pct',
  'herramientas_pct',
  'beneficio_pct',
  'ingresos_brutos_pct',
  'imp_cheque_pct',
  'iva_pct',
] as const

export type ClaveIndirecto = (typeof CLAVES_INDIRECTOS)[number]
export type IndirectosPct = Record<ClaveIndirecto, number>

// Iguales a INDIRECT_DEFAULTS (app/budget_prices.py)
export const INDIRECTOS_DEFECTO: IndirectosPct = {
  imprevistos_pct: 3,
  estructura_pct: 15,
  jefatura_pct: 8,
  logistica_pct: 5,
  herramientas_pct: 3,
  beneficio_pct: 10,
  ingresos_brutos_pct: 7,
  imp_cheque_pct: 1.2,
  iva_pct: 21,
}

/** Los nueve % a partir de lo que mande el servidor (faltante o null = valor por defecto). */
export function indirectosCompletos(data: Partial<Record<ClaveIndirecto, number | null | undefined>> | null | undefined): IndirectosPct {
  const out = { ...INDIRECTOS_DEFECTO }
  for (const k of CLAVES_INDIRECTOS) {
    const v = data?.[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

function centavos(n: number): number {
  return Number(n.toFixed(2))
}

export interface Cascada {
  directo: number
  indirecto: number
  beneficio: number
  impuestos: number
  neto: number
  iva: number
  total_final: number
}

export function cascadaIndirectos(directo: number, cfg: IndirectosPct): Cascada {
  const pctIndirecto =
    (cfg.imprevistos_pct + cfg.estructura_pct + cfg.jefatura_pct + cfg.logistica_pct + cfg.herramientas_pct) / 100
  const indirecto = centavos(directo * pctIndirecto)
  const subtotal02 = directo + indirecto

  const beneficio = centavos((subtotal02 * cfg.beneficio_pct) / 100)
  const subtotal03 = subtotal02 + beneficio

  const impuestos = centavos((subtotal03 * (cfg.ingresos_brutos_pct + cfg.imp_cheque_pct)) / 100)
  const neto = subtotal03 + impuestos

  const iva = centavos((neto * cfg.iva_pct) / 100)
  const totalFinal = neto + iva

  return {
    directo,
    indirecto,
    beneficio,
    impuestos,
    neto: centavos(neto),
    iva,
    total_final: centavos(totalFinal),
  }
}
