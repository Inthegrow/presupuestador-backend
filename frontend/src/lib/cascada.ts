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

const CLAVES_SOLO_INDIRECTOS = [
  'imprevistos_pct',
  'estructura_pct',
  'jefatura_pct',
  'logistica_pct',
  'herramientas_pct',
] as const

type ConfigParcial = Partial<Record<ClaveIndirecto, number | null | undefined>>

/** % de indirectos: los 5 conceptos (imprevistos + estructura + jefatura + logística + herramientas),
 *  con los mismos valores por defecto que la cascada. Es el único "% indirecto" que muestra la app. */
export function pctIndirectos(config: ConfigParcial | null | undefined): number {
  const c = indirectosCompletos(config)
  return Number(CLAVES_SOLO_INDIRECTOS.reduce((s, k) => s + c[k], 0).toFixed(4))
}

/** Los % que acompañan a cada renglón de la escalera. Sin config (todavía cargando o falló): null, sin números. */
export interface PctsEscalera {
  indirecto: number
  beneficio: number
  impuestos: number
  iva: number
}

export function pctsEscalera(
  config: (ConfigParcial & { indirecto_pct?: number | null }) | null | undefined,
): PctsEscalera | null {
  if (!config) return null
  const c = indirectosCompletos(config)
  const delServidor = config.indirecto_pct
  return {
    indirecto: typeof delServidor === 'number' && Number.isFinite(delServidor) ? delServidor : pctIndirectos(config),
    beneficio: c.beneficio_pct,
    impuestos: Number((c.ingresos_brutos_pct + c.imp_cheque_pct).toFixed(4)),
    iva: c.iva_pct,
  }
}

/** "34", "8,2", "10,5": un % para leer, sin ceros de más. */
export function fmtPct(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

// ─── Escalera de totales (lo guardado, sumado) ──────────────────────────────────

/** Los renglones que muestra la app, de arriba abajo. iva / total_final en null = no se puede saber sin inventar. */
export interface Escalera {
  mat: number
  mo: number
  directo: number
  indirecto: number
  beneficio: number
  impuestos: number
  neto: number
  iva: number | null
  total_final: number | null
}

type FilaGuardada = {
  mat_total?: number | null
  mo_total?: number | null
  directo_total?: number | null
  indirecto_total?: number | null
  beneficio_total?: number | null
  impuestos_total?: number | null
  neto_total?: number | null
  iva_total?: number | null
  total_final?: number | null
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function esNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Suma los totales GUARDADOS (los calculó el servidor). Nada se recalcula acá, salvo dos huecos de datos viejos:
 * - Impuestos sin guardar: lo que va del subtotal con beneficio al precio sin IVA (así los renglones siempre suman).
 * - IVA sin guardar: precio sin IVA × IVA% de la obra; si tampoco se sabe el IVA%, IVA y precio con IVA quedan en null
 *   (la pantalla muestra "—" en vez de un número inventado).
 */
export function escaleraDe(filas: FilaGuardada[], ivaPct: number | null): Escalera {
  const e: Escalera = { mat: 0, mo: 0, directo: 0, indirecto: 0, beneficio: 0, impuestos: 0, neto: 0, iva: 0, total_final: 0 }
  for (const f of filas) {
    const directo = num(f.directo_total)
    const indirecto = num(f.indirecto_total)
    const beneficio = num(f.beneficio_total)
    const neto = num(f.neto_total)
    e.mat += num(f.mat_total)
    e.mo += num(f.mo_total)
    e.directo += directo
    e.indirecto += indirecto
    e.beneficio += beneficio
    e.neto += neto
    e.impuestos += esNum(f.impuestos_total) ? f.impuestos_total : Math.max(0, neto - directo - indirecto - beneficio)
    let iva: number | null = esNum(f.iva_total) ? f.iva_total : null
    if (iva === null && ivaPct !== null) iva = centavos((neto * ivaPct) / 100)
    if (iva === null && neto !== 0) {
      e.iva = null
      e.total_final = null
    }
    if (e.iva !== null) e.iva += iva ?? 0
    if (e.total_final !== null) e.total_final += esNum(f.total_final) ? f.total_final : neto + (iva ?? 0)
  }
  const r = (n: number) => centavos(n)
  return {
    mat: r(e.mat),
    mo: r(e.mo),
    directo: r(e.directo),
    indirecto: r(e.indirecto),
    beneficio: r(e.beneficio),
    impuestos: r(e.impuestos),
    neto: r(e.neto),
    iva: e.iva === null ? null : r(e.iva),
    total_final: e.total_final === null ? null : r(e.total_final),
  }
}
