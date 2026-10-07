import { ExternalLink, FileSpreadsheet, Globe, Hand } from 'lucide-react'
import { dominio, origenDePrecio } from '../lib/origen'

/**
 * La línea chica "de dónde salió" de un precio: el origen anotado y, si vino de internet, el link al sitio.
 * Para los precios viejos sin origen muestra lo que se sabe (proveedor y fecha), sin inventar.
 */
export default function OrigenPrecio({
  entrada,
  className = '',
}: {
  entrada: { fuente?: string | null; fuente_url?: string | null; proveedor?: string | null; fecha_precio?: string | null }
  className?: string
}) {
  const o = origenDePrecio(entrada)
  const Icono = o.tipo === 'internet' ? Globe : o.tipo === 'mano' ? Hand : o.tipo === 'otro' ? FileSpreadsheet : null
  return (
    <span
      data-testid="origen-precio"
      data-tipo={o.tipo}
      className={`inline-flex items-start gap-1 text-[10px] leading-snug min-w-0 [overflow-wrap:anywhere] ${
        o.tipo === 'sin' ? 'text-gray-400' : o.tipo === 'internet' ? 'text-sky-800' : 'text-gray-500'
      } ${className}`}
    >
      {Icono && <Icono size={10} className="flex-shrink-0 mt-[2px]" aria-hidden />}
      <span className="min-w-0">
        {o.texto}
        {o.url && (
          <>
            {' · '}
            <a
              href={o.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Abrir ${dominio(o.url)} en otra pestaña`}
              className="inline-flex items-center gap-0.5 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900"
            >
              Ver<span className="sr-only"> en {dominio(o.url)}</span>
              <ExternalLink size={9} aria-hidden />
            </a>
          </>
        )}
      </span>
    </span>
  )
}
