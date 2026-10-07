// De dónde salió cada precio (PLAN_AJUSTE_GINKGO.md, 1.B) y montos de las correcciones, dichos para Sol.
import { fmtPesos } from './format'

/** 2026-10-07 → "7/10/2026" (día sin cero adelante, como lo escribe Sol). Vacío: ''. */
export function fechaCorta(value: string | null | undefined): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  if (!y || !m || !d) return value
  return `${Number(d)}/${m}/${y}`
}

/** Solo links http(s): cualquier otra cosa no se muestra como link. */
export function urlSegura(url: string | null | undefined): string | null {
  const u = (url ?? '').trim()
  return /^https?:\/\/\S+$/i.test(u) ? u : null
}

/** "https://www.easy.com.ar/cemento..." → "easy.com.ar" */
export function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export interface Origen {
  // 'internet' | 'mano' | 'otro' (Excel, importado, corrección) | 'sin' (precio viejo: solo proveedor y fecha)
  tipo: 'internet' | 'mano' | 'otro' | 'sin'
  texto: string
  url: string | null
}

const TIENE_FECHA = /\d{1,2}\/\d{1,2}\/\d{2,4}/

/**
 * La línea chica de "De dónde salió" de un precio de la lista (o de un valor de su historial):
 * - "Internet: Easy · Cemento Loma Negra 50 kg · consultado el 7/10/2026" (+ link)
 * - "Cargado a mano el 7/10/2026"
 * - "Excel de Sol, Ginkgo, hoja 00_Sub · EVER · 18/09/2026"
 * - sin origen anotado (precios viejos): lo que haya, "Proveedor: EVER · 18/09/2026"
 */
export function origenDePrecio(e: {
  fuente?: string | null
  fuente_url?: string | null
  proveedor?: string | null
  fecha_precio?: string | null
}): Origen {
  const fuente = (e.fuente ?? '').trim()
  const url = urlSegura(e.fuente_url)
  const fecha = fechaCorta(e.fecha_precio)
  const proveedor = (e.proveedor ?? '').trim()
  if (!fuente) {
    const partes = [proveedor && `Proveedor: ${proveedor}`, fecha].filter(Boolean)
    return { tipo: 'sin', texto: partes.length ? partes.join(' · ') : 'Sin origen anotado', url }
  }
  if (/^internet\b/i.test(fuente)) {
    return { tipo: 'internet', texto: fecha && !TIENE_FECHA.test(fuente) ? `${fuente} · consultado el ${fecha}` : fuente, url }
  }
  if (/^cargad[oa] a mano/i.test(fuente)) {
    return { tipo: 'mano', texto: fecha && !TIENE_FECHA.test(fuente) ? `${fuente} el ${fecha}` : fuente, url }
  }
  const partes = [fuente]
  if (proveedor && !fuente.toLowerCase().includes(proveedor.toLowerCase())) partes.push(proveedor)
  if (fecha && !TIENE_FECHA.test(fuente)) partes.push(fecha)
  return { tipo: 'otro', texto: partes.join(' · '), url }
}

/** −19.732.275 → "−$19,7 millones"; 850.000 → "+$850.000". Con signo siempre: es un cambio. */
export function fmtEfecto(value: number): string {
  const signo = value < 0 ? '−' : value > 0 ? '+' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${signo}$${(abs / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} millones`
  }
  return `${signo}${fmtPesos(abs)}`
}

/** Un texto con links adentro, en pedazos: los links como `{ url }` para mostrarlos como "Ver". */
export function partesConLinks(texto: string): ({ texto: string } | { url: string })[] {
  const out: ({ texto: string } | { url: string })[] = []
  const re = /https?:\/\/[^\s)]+/gi
  let last = 0
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ texto: texto.slice(last, i) })
    out.push({ url: m[0].replace(/[.,;:]+$/, '') })
    last = i + m[0].length
  }
  if (last < texto.length) out.push({ texto: texto.slice(last) })
  return out
}

/** Normaliza una unidad para comparar: "M²" → "m2", "Unid." → "u", "bolsa 50 kg" queda distinta de "kg". */
export function unidadNormal(u: string | null | undefined): string {
  const k = (u ?? '').trim().toLowerCase().replace('²', '2').replace('³', '3').replace(/\.$/, '')
  if (['', 'u', 'un', 'unid', 'unidad', 'unidades', 'uni'].includes(k)) return 'u'
  if (['m', 'ml', 'metro', 'metros', 'metro lineal'].includes(k)) return 'm'
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(k)) return 'l'
  if (['kg', 'kilo', 'kilos', 'kgs'].includes(k)) return 'kg'
  if (['m2', 'metro cuadrado'].includes(k)) return 'm2'
  if (['m3', 'metro cubico', 'metro cúbico'].includes(k)) return 'm3'
  return k
}
