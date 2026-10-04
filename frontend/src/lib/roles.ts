import type { Rol } from '../types'

// Rol en palabras (nunca el código del rol)
export function rolEnPalabras(rol: Rol | null | undefined): string {
  if (rol === 'admin') return 'Administra'
  if (rol === 'leader') return 'Carga y edita'
  if (rol === 'member') return 'Solo mira'
  return ''
}
