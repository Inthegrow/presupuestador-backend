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

/**
 * Estado de un trabajo en la tabla del editor, con los faltantes de todo el presupuesto
 * (GET /budgets/{id}/precios-faltantes). La tabla no tiene los recursos de cada trabajo: cuenta como
 * "con recursos" un trabajo con fórmula o con algún costo por unidad. Devuelve null si los faltantes
 * de ese trabajo no se conocen (la consulta falló o el trabajo es más nuevo que la consulta):
 * sin punto, nunca verde sin saber.
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
  faltantes: { porItem: Record<string, number>; ids: Set<string> } | null,
): { estado: Semaforo; frase: string } | null {
  if (!faltantes || !faltantes.ids.has(item.id)) return null
  const costo = (item.mat_unitario ?? 0) + (item.mo_unitario ?? 0) + (item.eq_unitario ?? 0)
    + (item.mat_ind_unitario ?? 0) + (item.sub_unitario ?? 0)
  const tieneFormula = !!item.template_id
  return estadoDeTrabajo({
    tieneFormula,
    recursos: tieneFormula || costo > 0 ? 1 : 0,
    preciosFaltantes: Number(faltantes.porItem[item.id]) || 0,
    preciosVerificados: true,
  })
}
