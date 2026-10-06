// Búsqueda "como habla Sol": todas las palabras escritas, en cualquier orden, sin tildes ni mayúsculas.
// La usan el buscador de fórmulas del detalle / editor / Cargar obra y la pantalla Fórmulas.

export function sinTildes(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Las palabras de lo escrito, ya sin tildes y en minúscula ("Hueco  18" → ["hueco", "18"]). */
export function palabrasDe(texto: string): string[] {
  return sinTildes(texto.trim().toLowerCase()).split(/\s+/).filter(Boolean)
}

/** true si TODAS las palabras están en alguno de los textos (sin lista de palabras, todo coincide). */
export function tieneTodas(palabras: string[], ...textos: (string | null | undefined)[]): boolean {
  if (palabras.length === 0) return true
  const donde = sinTildes(textos.filter(Boolean).join(' ').toLowerCase())
  return palabras.every((p) => donde.includes(p))
}

const colador = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/** Orden natural de números de fórmula: 6.1, 6.2 … 6.10, 6.11 (no 6.1, 6.10, 6.11, 6.2). */
export function compararCodigos(a: string, b: string): number {
  return colador.compare(a.replace(/\.$/, ''), b.replace(/\.$/, ''))
}

/** Por número (natural); las que no tienen número van al final, por nombre. */
export function compararFormulas(
  a: { codigo?: string | null; nombre?: string | null },
  b: { codigo?: string | null; nombre?: string | null },
): number {
  const ca = (a.codigo ?? '').trim()
  const cb = (b.codigo ?? '').trim()
  if (ca && cb) return compararCodigos(ca, cb) || colador.compare(a.nombre ?? '', b.nombre ?? '')
  if (ca) return -1
  if (cb) return 1
  return colador.compare(a.nombre ?? '', b.nombre ?? '')
}
