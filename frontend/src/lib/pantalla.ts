import { useEffect, useState } from 'react'

// Medidas de pantalla que usa toda la app (las mismas que los prefijos de Tailwind):
// - celular: menos de 768 px de ancho (debajo de `md`)
// - chica: menos de 1024 px (debajo de `lg`): el menú lateral pasa a ser un cajón que se abre con ☰
// - baja: 800 px de alto o menos (notebook de 13-14"): lo de arriba del editor se compacta
export const ANCHO_CELULAR = 768
export const ANCHO_MENU_FIJO = 1024
export const ALTO_BAJO = 800

export interface Pantalla {
  celular: boolean
  chica: boolean
  baja: boolean
}

function medir(): Pantalla {
  if (typeof window === 'undefined') return { celular: false, chica: false, baja: false }
  return {
    celular: window.innerWidth < ANCHO_CELULAR,
    chica: window.innerWidth < ANCHO_MENU_FIJO,
    baja: window.innerHeight <= ALTO_BAJO,
  }
}

/** El tamaño de la pantalla, actualizado al girar el celular o cambiar el tamaño de la ventana. */
export function usePantalla(): Pantalla {
  const [p, setP] = useState<Pantalla>(medir)
  useEffect(() => {
    const cambiar = () =>
      setP((prev) => {
        const n = medir()
        return n.celular === prev.celular && n.chica === prev.chica && n.baja === prev.baja ? prev : n
      })
    window.addEventListener('resize', cambiar)
    window.addEventListener('orientationchange', cambiar)
    return () => {
      window.removeEventListener('resize', cambiar)
      window.removeEventListener('orientationchange', cambiar)
    }
  }, [])
  return p
}
