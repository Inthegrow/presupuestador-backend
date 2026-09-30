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
