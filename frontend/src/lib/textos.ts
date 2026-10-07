// Words as Sol reads them (PLAN_PALABRAS.md, 1.A and 1.B), in one place.
// The data does not change: the Maestro's categories ("Yeseria y durleria") and parameter keys ("altura_m")
// stay as they are stored; only what the screen shows gets its accents and a readable name.
import { sinTildes } from './buscar'

// Known words without their accent, keyed without accents and in lowercase (ñ too: "albanileria")
const CON_TILDE: Record<string, string> = {
  yeseria: 'yesería',
  yeserias: 'yeserías',
  durleria: 'durlería',
  albanileria: 'albañilería',
  herreria: 'herrería',
  carpinteria: 'carpintería',
  carpinterias: 'carpinterías',
  zingueria: 'zinguería',
  pintureria: 'pinturería',
  vidrieria: 'vidriería',
  marmoleria: 'marmolería',
  plomeria: 'plomería',
  griferia: 'grifería',
  tabiqueria: 'tabiquería',
  cerrajeria: 'cerrajería',
  mamposteria: 'mampostería',
  instalacion: 'instalación',
  electrica: 'eléctrica',
  electricas: 'eléctricas',
  electrico: 'eléctrico',
  electricos: 'eléctricos',
  aislacion: 'aislación',
  demolicion: 'demolición',
  demoliciones: 'demoliciones',
  excavacion: 'excavación',
  hormigon: 'hormigón',
  ceramica: 'cerámica',
  ceramicas: 'cerámicas',
  ceramico: 'cerámico',
  ceramicos: 'cerámicos',
  termica: 'térmica',
  termico: 'térmico',
  hidraulica: 'hidráulica',
  hidraulicas: 'hidráulicas',
  metalica: 'metálica',
  metalicas: 'metálicas',
  metalico: 'metálico',
  metalicos: 'metálicos',
  impermeabilizacion: 'impermeabilización',
  construccion: 'construcción',
  nivelacion: 'nivelación',
  preparacion: 'preparación',
  terminacion: 'terminación',
  calefaccion: 'calefacción',
  ventilacion: 'ventilación',
  iluminacion: 'iluminación',
  senalizacion: 'señalización',
  zocalo: 'zócalo',
  zocalos: 'zócalos',
  mecanica: 'mecánica',
  mecanicas: 'mecánicas',
  basica: 'básica',
  basicas: 'básicas',
  tecnica: 'técnica',
  tecnicas: 'técnicas',
  limpieza: 'limpieza',
  via: 'vía',
  area: 'área',
  areas: 'áreas',
}

function mismaForma(original: string, nueva: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return nueva.toUpperCase()
  if (original[0] === original[0].toUpperCase()) return nueva[0].toUpperCase() + nueva.slice(1)
  return nueva
}

/** "Yeseria y durleria" → "Yesería y durlería". Only known words change; the rest stays as written. */
export function conTildes(texto: string | null | undefined): string {
  if (!texto) return ''
  return texto.replace(/\p{L}+/gu, (w) => {
    const bien = CON_TILDE[sinTildes(w.toLowerCase())]
    return bien ? mismaForma(w, bien) : w
  })
}

// Unit at the end of a parameter key: "altura_m" → "(m)"
const UNIDAD_CLAVE: Record<string, string> = {
  m: 'm', m2: 'm²', m3: 'm³', cm: 'cm', mm: 'mm', kg: 'kg', ml: 'ml', un: 'un', u: 'un', pct: '%', porc: '%',
  l: 'l', lts: 'l', hs: 'hs', dias: 'días', mes: 'mes',
}

/**
 * What Sol reads for a parameter: its description when it has one ("Espesor del contrapiso"); if not, the key made
 * readable ("altura_m" → "Altura (m)", "espesor_cm" → "Espesor (cm)"; conUnidad=false when the unit is shown
 * next to the value anyway). The key itself never changes.
 */
export function nombreParametro(clave: string, descripcion?: string | null, conUnidad = true): string {
  const d = (descripcion ?? '').trim()
  if (d) return d
  const partes = clave.split(/[_\s]+/).filter(Boolean)
  if (partes.length === 0) return clave
  let unidad = ''
  if (partes.length > 1 && UNIDAD_CLAVE[partes[partes.length - 1].toLowerCase()]) {
    unidad = UNIDAD_CLAVE[partes.pop()!.toLowerCase()]
  }
  const texto = conTildes(partes.join(' ').toLowerCase())
  const legible = texto[0].toUpperCase() + texto.slice(1)
  return unidad && conUnidad ? `${legible} (${unidad})` : legible
}
