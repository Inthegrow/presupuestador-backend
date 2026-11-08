import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { budgetApi } from '../lib/api'

// «Precio viejo»: cada empresa dice después de cuántos días un precio es viejo (por defecto 90, en Lista de precios).
// Un recurso o un precio de la lista más viejo que eso se marca en ámbar. No bloquea nada: es un aviso.

export const PRECIO_VIEJO_DIAS = 90

let cache: number | null = null
let pedido: Promise<number> | null = null
const oyentes = new Set<(n: number) => void>()

function leerDias(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Los días de la empresa (de la configuración general); si no se pueden leer, 90. */
export function pedirPrecioViejoDias(): Promise<number> {
  if (cache !== null) return Promise.resolve(cache)
  if (!pedido) {
    pedido = budgetApi.getGeneralIndirects()
      .then((c) => leerDias((c as { precio_viejo_dias?: unknown } | null)?.precio_viejo_dias) ?? PRECIO_VIEJO_DIAS)
      .catch(() => PRECIO_VIEJO_DIAS)
      .then((n) => {
        cache = n
        pedido = null
        return n
      })
  }
  return pedido
}

/** Después de guardar un valor nuevo: todas las pantallas abiertas lo usan enseguida. */
export function avisarPrecioViejoDias(n: number) {
  cache = n
  for (const o of oyentes) o(n)
}

export function usePrecioViejoDias(): number {
  const [dias, setDias] = useState<number>(cache ?? PRECIO_VIEJO_DIAS)
  useEffect(() => {
    let vigente = true
    oyentes.add(setDias)
    pedirPrecioViejoDias().then((n) => { if (vigente) setDias(n) })
    return () => { vigente = false; oyentes.delete(setDias) }
  }, [])
  return dias
}

/** Días enteros desde una fecha (YYYY-MM-DD o ISO) hasta hoy; null sin fecha o con una fecha que no se entiende. */
export function diasDesde(fecha: string | null | undefined): number | null {
  if (!fecha) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  if (!m) return null
  const desde = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const hoy = new Date()
  const ahora = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const d = Math.floor((ahora - desde) / 86_400_000)
  return Number.isFinite(d) ? Math.max(0, d) : null
}

export function esViejo(dias: number | null | undefined, umbral: number): boolean {
  return typeof dias === 'number' && Number.isFinite(dias) && dias > umbral
}

/** El chip ámbar «Precio de hace N días» */
export default function PrecioViejo({ dias, className = '' }: { dias: number; className?: string }) {
  return (
    <span
      data-testid="precio-viejo"
      title="Este precio tiene más días que los que tu empresa considera vigentes. Conviene actualizarlo en Lista de precios."
      className={`inline-flex items-center gap-1 text-[10px] max-md:text-[12px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 whitespace-nowrap ${className}`}
    >
      <Clock size={10} className="flex-shrink-0" /> Precio de hace {dias.toLocaleString('es-AR')} días
    </span>
  )
}
