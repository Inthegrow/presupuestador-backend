// Semáforo de un trabajo: los mismos colores y textos en Cargar obra y en el detalle del trabajo.

export type Semaforo = 'verde' | 'amarillo' | 'rojo'

export const ESTILO: Record<Semaforo, { borde: string; chip: string; punto: string; texto: string }> = {
  verde: { borde: 'border-l-[#2D8D68]', chip: 'bg-[#E8F5EE] text-[#2D8D68]', punto: 'bg-[#2D8D68]', texto: 'Listo' },
  amarillo: { borde: 'border-l-amber-400', chip: 'bg-amber-50 text-amber-700', punto: 'bg-amber-400', texto: 'Para confirmar' },
  rojo: { borde: 'border-l-red-500', chip: 'bg-red-50 text-red-600', punto: 'bg-red-500', texto: 'Falta resolver' },
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
  /** Costo por unidad cargado a mano en el trabajo (materiales + mano de obra + …), sin recursos */
  precioAMano?: number
}): { estado: Semaforo; frase: string } {
  const { tieneFormula, recursos, preciosFaltantes, preciosVerificados, precioAMano = 0 } = datos
  if (preciosVerificados && preciosFaltantes > 0) {
    return {
      estado: 'rojo',
      frase: preciosFaltantes === 1 ? 'Falta 1 precio' : `Faltan ${preciosFaltantes} precios`,
    }
  }
  // Precio a mano, sin fórmula ni recursos: amarillo (no está mal, pero la app no lo desglosa)
  if (recursos === 0 && !tieneFormula && precioAMano > 0) {
    return { estado: 'amarillo', frase: 'Precio cargado a mano, sin fórmula' }
  }
  if (recursos === 0) {
    return {
      estado: 'rojo',
      frase: tieneFormula
        ? 'La fórmula no cargó materiales ni mano de obra'
        : 'Sin fórmula: cargá una o completá los recursos a mano',
    }
  }
  if (!preciosVerificados) return { estado: 'amarillo', frase: 'No pude revisar los precios' }
  if (!tieneFormula) return { estado: 'amarillo', frase: 'Cargado a mano, sin fórmula' }
  return { estado: 'verde', frase: 'Con fórmula y con todos los precios' }
}

/**
 * Estado de un trabajo en la tabla del editor, con los faltantes y la cantidad de recursos de todo el
 * presupuesto (GET /budgets/{id}/precios-faltantes). La cantidad de recursos es la real: tener fórmula no
 * alcanza (una fórmula puede no dejar recursos) y un precio a mano no es un recurso. Devuelve null si no se
 * conocen los datos de ese trabajo (la consulta falló, el servidor es viejo y no manda los recursos, o el
 * trabajo es más nuevo que la consulta): sin punto, nunca verde sin saber.
 */
export function estadoEnTabla(
  item: {
    id: string
    template_id?: string | null
    mat_unitario?: number
    mo_unitario?: number
    eq_unitario?: number
    mat_ind_unitario?: number
    sub_unitario?: number
  },
  faltantes: { porItem: Record<string, number>; recursosPorItem: Record<string, number>; ids: Set<string> } | null,
): { estado: Semaforo; frase: string } | null {
  if (!faltantes || !faltantes.ids.has(item.id)) return null
  const recursos = faltantes.recursosPorItem[item.id]
  if (typeof recursos !== 'number') return null
  return estadoDeTrabajo({
    tieneFormula: !!item.template_id,
    recursos,
    preciosFaltantes: Number(faltantes.porItem[item.id]) || 0,
    preciosVerificados: true,
    precioAMano: precioPorUnidad(item),
  })
}

/** Suma de los costos por unidad guardados en el trabajo (lo que se carga a mano sin fórmula) */
export function precioPorUnidad(item: {
  mat_unitario?: number; mo_unitario?: number; eq_unitario?: number; mat_ind_unitario?: number; sub_unitario?: number
}): number {
  return (Number(item.mat_unitario) || 0) + (Number(item.mo_unitario) || 0) + (Number(item.eq_unitario) || 0)
    + (Number(item.mat_ind_unitario) || 0) + (Number(item.sub_unitario) || 0)
}
