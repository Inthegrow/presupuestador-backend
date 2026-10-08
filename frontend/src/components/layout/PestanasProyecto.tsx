import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart2, Download, Edit3, Layers, RefreshCw } from 'lucide-react'

// Las pantallas del "Proyecto actual" (las mismas del menú, en el mismo orden)
const PESTANAS = [
  { ruta: 'editor', texto: 'Editor', Icono: Edit3 },
  { ruta: 'analysis', texto: 'Análisis', Icono: BarChart2 },
  { ruta: 'ai', texto: 'Planos con IA', Icono: Layers },
  { ruta: 'export', texto: 'Exportar', Icono: Download },
  { ruta: 'versions', texto: 'Versiones', Icono: RefreshCw },
] as const

/** ¿Esta ruta es una de las pantallas del proyecto que llevan pestañas en el celular? */
export function rutaConPestanas(pathname: string): string | null {
  const m = pathname.match(/^\/app\/budgets\/([^/]+)\/(editor|analysis|ai|export|versions)\/?$/)
  return m ? m[1] : null
}

/**
 * En el celular, arriba del contenido de Editor, Análisis, Planos con IA, Exportar y Versiones: las mismas entradas
 * del bloque "Proyecto actual" del menú, como pestañas que se deslizan de costado. Desde 768 px no se muestran
 * (el menú ya las tiene a la vista). Lo pone AppLayout; las páginas no tienen que hacer nada.
 */
export default function PestanasProyecto({ budgetId }: { budgetId: string }) {
  const filaRef = useRef<HTMLDivElement>(null)

  // La pestaña elegida siempre a la vista, aunque esté al final de la fila
  useEffect(() => {
    const activa = filaRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (activa && filaRef.current) {
      const fila = filaRef.current
      const izq = activa.offsetLeft - 12
      const der = activa.offsetLeft + activa.offsetWidth + 12 - fila.clientWidth
      if (fila.scrollLeft > izq) fila.scrollLeft = izq
      else if (fila.scrollLeft < der) fila.scrollLeft = der
    }
  })

  return (
    <nav aria-label="Proyecto actual" data-testid="pestanas-proyecto" className="md:hidden bg-white border-b">
      <div ref={filaRef} className="flex gap-1.5 overflow-x-auto sin-barra px-3 py-2 snap-x">
        {PESTANAS.map(({ ruta, texto, Icono }) => (
          <NavLink
            key={ruta}
            to={`/app/budgets/${budgetId}/${ruta}`}
            className={({ isActive }) =>
              `snap-start flex-shrink-0 inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-full text-sm whitespace-nowrap border transition-colors ${
                isActive
                  ? 'bg-[#143D34] border-[#143D34] text-white font-semibold'
                  : 'bg-white border-gray-200 text-gray-600 active:bg-[#E8F5EE]'
              }`
            }
          >
            <Icono size={15} />
            {texto}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
