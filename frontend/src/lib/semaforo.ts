// Semáforo de un trabajo: los mismos colores y textos en Cargar obra y en el detalle del trabajo.

export type Semaforo = 'verde' | 'amarillo' | 'rojo'

export const ESTILO: Record<Semaforo, { borde: string; chip: string; texto: string }> = {
  verde: { borde: 'border-l-[#2D8D68]', chip: 'bg-[#E8F5EE] text-[#2D8D68]', texto: 'Listo' },
  amarillo: { borde: 'border-l-amber-400', chip: 'bg-amber-50 text-amber-700', texto: 'Para confirmar' },
  rojo: { borde: 'border-l-red-500', chip: 'bg-red-50 text-red-600', texto: 'Falta resolver' },
}

/**
 * Estado de un trabajo en el detalle, con lo que la pantalla ya sabe:
 * - rojo: faltan precios, o no tiene ningún recurso
 * - amarillo: tiene recursos pero ninguna fórmula (cargado a mano)
 * - verde: tiene fórmula y no faltan precios
 */
export function estadoDeTrabajo(datos: {
  tieneFormula: boolean
  recursos: number
  preciosFaltantes: number
}): { estado: Semaforo; frase: string } {
  const { tieneFormula, recursos, preciosFaltantes } = datos
  if (preciosFaltantes > 0) {
    return {
      estado: 'rojo',
      frase: preciosFaltantes === 1 ? 'Falta 1 precio' : `Faltan ${preciosFaltantes} precios`,
    }
  }
  if (recursos === 0) {
    return { estado: 'rojo', frase: 'Sin fórmula: cargá una o completá los recursos a mano' }
  }
  if (!tieneFormula) return { estado: 'amarillo', frase: 'Cargado a mano, sin fórmula' }
  return { estado: 'verde', frase: 'Con fórmula y con todos los precios' }
}
