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
 * - amarillo: tiene recursos pero ninguna fórmula (cargado a mano), o no se pudo revisar los precios
 * - verde: tiene fórmula y el servidor confirmó que no faltan precios
 *
 * `preciosVerificados` es true solo si el servidor contestó la lista de faltantes de lo que hay
 * guardado ahora: una consulta que falló nunca cuenta como "no falta nada".
 */
export function estadoDeTrabajo(datos: {
  tieneFormula: boolean
  recursos: number
  preciosFaltantes: number
  preciosVerificados: boolean
}): { estado: Semaforo; frase: string } {
  const { tieneFormula, recursos, preciosFaltantes, preciosVerificados } = datos
  if (preciosVerificados && preciosFaltantes > 0) {
    return {
      estado: 'rojo',
      frase: preciosFaltantes === 1 ? 'Falta 1 precio' : `Faltan ${preciosFaltantes} precios`,
    }
  }
  if (recursos === 0) {
    return { estado: 'rojo', frase: 'Sin fórmula: cargá una o completá los recursos a mano' }
  }
  if (!preciosVerificados) return { estado: 'amarillo', frase: 'No pude revisar los precios' }
  if (!tieneFormula) return { estado: 'amarillo', frase: 'Cargado a mano, sin fórmula' }
  return { estado: 'verde', frase: 'Con fórmula y con todos los precios' }
}
