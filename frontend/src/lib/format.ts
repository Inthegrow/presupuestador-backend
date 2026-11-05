/**
 * Format a number as Argentine currency.
 * e.g. 142_200_000 → "$142.2M"
 *      3_500 → "$3.500"
 */
export function fmtCurrency(value: number | null | undefined): string {
  if (!value) return '$0'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}B`
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`
  }
  return `${sign}$${abs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

// ─── Costo por unidad ────────────────────────────────────────────────────────
// Regla única: un costo por unidad menor a $1 se muestra con sus 3 primeras cifras significativas,
// así nunca se lee "$0" en un trabajo que cuesta ($1 / 3.000.000 → $0,000000333). Desde $1, en
// pesos enteros. Y una cuenta se escribe con "=" solo si los tres números que se leen son exactos.

const CIFRAS_CHICAS = 3
const DECIMALES_CANTIDAD = 6
const CIFRAS_CANTIDAD_CHICA = 6

// Decimales exactos (BigInt): n / 10^d. Sin coma flotante, sin tolerancia, para cualquier tamaño.
type Decimal = { n: bigint; d: number }

/** Un número de JS como decimal exacto de lo que representa en su forma más corta (0.1 → 1/10). */
function deNumero(x: number): Decimal {
  const [mantisa, exp = '0'] = String(Math.abs(x)).split('e')
  const [entera, frac = ''] = mantisa.split('.')
  let n = BigInt(entera + frac)
  let d = frac.length - Number(exp)
  if (d < 0) { n *= 10n ** BigInt(-d); d = 0 }
  return { n: x < 0 ? -n : n, d }
}

/** Lo que se lee en pantalla ("$ 1.234,56", "0,004") como decimal exacto. */
function deTexto(s: string): Decimal {
  const [entera, frac = ''] = s.replace(/[^\d,]/g, '').split(',')
  const n = BigInt((entera + frac) || '0')
  return { n: s.includes('-') ? -n : n, d: frac.length }
}

function iguales(a: Decimal, b: Decimal): boolean {
  return a.n * 10n ** BigInt(b.d) === b.n * 10n ** BigInt(a.d)
}

const por = (a: Decimal, b: Decimal): Decimal => ({ n: a.n * b.n, d: a.d + b.d })

/**
 * Una cantidad: menor a 1, con 6 cifras significativas (0,004 · 0,0000001: una cantidad positiva
 * nunca se lee 0); si no, con sus decimales (al menos `minDecimales`, hasta 6: 2,5 no se lee 3).
 */
export function fmtCantidad(value: number | null | undefined, minDecimales = 0): string {
  const q = Number(value ?? 0)
  return q !== 0 && Math.abs(q) < 1
    ? q.toLocaleString('es-AR', { maximumSignificantDigits: CIFRAS_CANTIDAD_CHICA })
    : q.toLocaleString('es-AR', { minimumFractionDigits: minDecimales, maximumFractionDigits: DECIMALES_CANTIDAD })
}

/**
 * Un costo por unidad: menor a $1 (y no cero), con sus 3 cifras significativas
 * ($0,001 · $0,0123 · $0,000000333). Si no, como lo muestra `formato` (por defecto, fmtCurrency).
 */
export function fmtUnitario(
  value: number | null | undefined,
  formato: (v: number | null | undefined) => string = fmtCurrency,
): string {
  const v = Number(value ?? 0)
  if (v !== 0 && Math.abs(v) < 1) {
    return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('es-AR', { maximumSignificantDigits: CIFRAS_CHICAS })}`
  }
  return formato(v)
}

const pesos = (decimales: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  })
const pesosEnteros = (v: number | null | undefined) => pesos(0).format(v ?? 0)

/** Si el costo por unidad que se lee (fmtUnitario, pesos enteros desde $1) no es exactamente el real. */
export function unitarioRedondeado(value: number | null | undefined): boolean {
  const v = Number(value ?? 0)
  return !iguales(deNumero(v), deTexto(fmtUnitario(v, pesosEnteros)))
}

/**
 * "total ÷ cantidad = costo por unidad", lista para mostrar. El total va con centavos si los tiene;
 * la cantidad, si es menor a 1, con 6 cifras significativas (0,004 · 0,0000001: una cantidad positiva
 * nunca se lee 0), y si no, con hasta 6 decimales; el costo por unidad, con la regla de fmtUnitario.
 * `aproximado` decide el signo, con aritmética exacta sobre los números **que se leen**: "=" solo si
 * total = cantidad × costo por unidad con esos números, y la cantidad que se lee es la real. Si no, "≈".
 */
export function cuentaPorUnidad(total: number, cantidad: number): {
  total: string; cantidad: string; unitario: string; signo: '=' | '≈'; aproximado: boolean
} {
  const centavos = Math.round(total * 100) / 100
  const totalTexto = pesos(Number.isInteger(centavos) ? 0 : 2).format(centavos)
  const cantidadTexto = fmtCantidad(cantidad, 2)
  const unitario = cantidad ? total / cantidad : 0
  const unitarioTexto = fmtUnitario(unitario, pesosEnteros)
  const cuentaCierta = iguales(deTexto(totalTexto), por(deTexto(cantidadTexto), deTexto(unitarioTexto)))
  const aproximado = !cuentaCierta || !iguales(deNumero(cantidad), deTexto(cantidadTexto))
  return { total: totalTexto, cantidad: cantidadTexto, unitario: unitarioTexto, signo: aproximado ? '≈' : '=', aproximado }
}

/**
 * Pesos enteros, sin abreviar: 142_213_456.7 → "$142.213.457". Para los totales que se comparan entre pantallas.
 */
export function fmtPesos(value: number | null | undefined): string {
  const v = value ?? 0
  const abs = Math.round(Math.abs(v))
  return `${v < 0 && abs !== 0 ? '-' : ''}$${abs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

/**
 * Format a number with Argentine locale (dot thousands, comma decimal).
 * e.g. 2663.25 → "2.663,25"
 */
export function fmtNumber(value: number | null | undefined, decimals = 2): string {
  return (value ?? 0).toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format as percent.
 * e.g. 0.31 → "31%" or 31 → "31%"
 */
export function fmtPercent(value: number | null | undefined): string {
  if (!value) return '0%'
  // Accept both 0.31 and 31
  const pct = value > 1 ? value : value * 100
  return `${pct.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}

/**
 * Format an ISO date (YYYY-MM-DD) as dd/mm/yyyy. Empty → "—".
 * Parsed by hand to avoid timezone shifts from new Date('2026-03-01').
 */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m, d] = value.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : value
}

/** Today as YYYY-MM-DD in local time (value for <input type="date">). */
export function todayIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

/**
 * Unit in words, for "Precio sin IVA por …".
 * u → "unidad", m2 → "m²", ml → "metro", gl → "global"; anything else as is.
 */
export function unidadEnPalabras(u?: string | null): string {
  const raw = (u || '').trim()
  const key = raw.toLowerCase().replace('²', '2').replace('³', '3').replace(/\.$/, '')
  switch (key) {
    case '':
    case 'u':
    case 'un':
    case 'unid':
    case 'unidad':
      return 'unidad'
    case 'm2': return 'm²'
    case 'm3': return 'm³'
    case 'm':
    case 'ml': return 'metro'
    case 'kg': return 'kg'
    case 'l':
    case 'lt': return 'litro'
    case 'bolsa': return 'bolsa'
    case 'gl': return 'global'
    default: return raw
  }
}
