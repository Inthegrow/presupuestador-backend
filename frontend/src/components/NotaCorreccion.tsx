import { Wand2 } from 'lucide-react'

/**
 * La línea chica de un renglón de fórmula tocado por una corrección ("Corregido por la revisión de Ginkgo (A1),
 * supuesto por Claude el 7/10/2026, a confirmar por Emilia"). Va en violeta punteado, como todo lo supuesto.
 */
export default function NotaCorreccion({ texto, className = '' }: { texto: string; className?: string }) {
  return (
    <p
      data-testid="nota-correccion"
      className={`inline-flex items-start gap-1 text-[10px] leading-snug text-violet-800 bg-violet-50 border border-dashed border-violet-300 rounded px-1.5 py-0.5 [overflow-wrap:anywhere] ${className}`}
    >
      <Wand2 size={10} className="flex-shrink-0 mt-[2px]" aria-hidden />
      <span>{texto}</span>
    </p>
  )
}
