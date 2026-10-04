import { useSyncExternalStore } from 'react'
import { hayPedidosLentos } from '../../lib/api'

function suscribir(avisar: () => void) {
  window.addEventListener('api:lento', avisar)
  window.addEventListener('api:respondio', avisar)
  return () => {
    window.removeEventListener('api:lento', avisar)
    window.removeEventListener('api:respondio', avisar)
  }
}

// Amber strip shown while any request to the server takes more than 4 s (free hosting waking up)
export default function ServidorDespertando() {
  const lento = useSyncExternalStore(suscribir, hayPedidosLentos, () => false)
  if (!lento) return null
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[100] bg-amber-50 border-b border-amber-200 text-amber-800 text-sm text-center px-4 py-2"
    >
      El servidor está despertando: la primera vez puede tardar hasta un minuto…
    </div>
  )
}
