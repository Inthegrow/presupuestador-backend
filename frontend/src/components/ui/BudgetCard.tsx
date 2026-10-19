import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { Budget } from '../../types'
import { fmtPesos } from '../../lib/format'
import { budgetApi } from '../../lib/api'
import ConfirmarBorrado from '../ConfirmarBorrado'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador', borrador: 'Borrador',
  active: 'Activo', activo: 'Activo',
  approved: 'Aprobado', aprobado: 'Aprobado',
  sent: 'Enviado', presentado: 'Enviado',
  review: 'En revisión',
  archivado: 'Archivado',
}

const STATUS_STYLES: Record<string, string> = {
  activo: 'bg-[#E8F5EE] text-[#1B5E4B]', active: 'bg-[#E8F5EE] text-[#1B5E4B]',
  borrador: 'bg-amber-50 text-amber-700', draft: 'bg-amber-50 text-amber-700',
  presentado: 'bg-blue-50 text-blue-700', sent: 'bg-blue-50 text-blue-700',
  archivado: 'bg-gray-100 text-gray-500',
  approved: 'bg-green-50 text-green-700', aprobado: 'bg-green-50 text-green-700',
  review: 'bg-yellow-50 text-yellow-700',
}

const BAR_COLORS: Record<string, string> = {
  activo: 'bg-[#2D8D68]', active: 'bg-[#2D8D68]',
  borrador: 'bg-[#E0A33A]', draft: 'bg-[#E0A33A]',
  presentado: 'bg-blue-500', sent: 'bg-blue-500',
  archivado: 'bg-gray-300',
  approved: 'bg-green-500', aprobado: 'bg-green-500',
  review: 'bg-yellow-500',
}

interface Props {
  budget: Budget
  directTotal?: number
  netoTotal?: number
  subtitle?: string
  tags?: string[]
  onDelete?: () => void
}

export default function BudgetCard({ budget, directTotal, netoTotal, subtitle, tags, onDelete }: Props) {
  // Borran quienes cargan y editan (administrador y «Carga y edita»), con doble verificación: escribir el nombre
  const { puedeEditar } = useAuth()
  const navigate = useNavigate()
  const status = budget.status?.toLowerCase() || 'borrador'
  const [borrando, setBorrando] = useState(false)

  return (
    <div
      onClick={() => navigate(`/app/budgets/${budget.id}/editor`)}
      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition cursor-pointer overflow-hidden"
    >
      <div className={`h-1 ${BAR_COLORS[status] ?? 'bg-gray-300'}`} />
      <div className="p-4 md:p-5">
        <div className="flex justify-between items-start mb-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500'}`}>
            {STATUS_LABELS[status] || budget.status || 'Borrador'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400">
              {budget.source_file ? '✓ Excel' : 'A mano'}
            </span>
            {puedeEditar && (
              <button
                onClick={(e) => { e.stopPropagation(); setBorrando(true) }}
                className="text-gray-400 hover:text-red-500 transition-colors w-10 h-10 -m-3 md:w-8 md:h-8 md:-m-1.5 rounded-full hover:bg-red-50 flex items-center justify-center"
                title="Borrar el presupuesto"
                aria-label={`Borrar el presupuesto ${budget.name}`}
                data-testid="borrar-presupuesto"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        <h3 className="font-bold text-gray-900 break-words">{budget.name}</h3>
        {subtitle && <p className="text-gray-500 text-xs mt-1">{subtitle}</p>}
        {tags && tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
            {tags.map((t) => (
              <span key={t} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
            ))}
          </div>
        )}
        <div className="mt-4 pt-3 border-t flex justify-between items-end gap-x-3 gap-y-1 flex-wrap">
          <div>
            <div className="text-[10px] text-gray-400">Costo directo</div>
            <div className="font-semibold text-gray-800 text-sm tabular-nums">
              {directTotal !== undefined ? fmtPesos(directTotal) : '—'}
            </div>
          </div>
          <div className="text-right ml-auto" data-testid="tarjeta-precio-sin-iva" data-valor={netoTotal ?? ''}>
            <div className="text-[10px] text-gray-400">Precio sin IVA</div>
            <div className="font-bold text-[#2D8D68] text-lg tabular-nums">
              {netoTotal !== undefined ? fmtPesos(netoTotal) : '—'}
            </div>
          </div>
        </div>
      </div>
      {borrando && (
        <ConfirmarBorrado
          nombre={budget.name}
          onConfirmar={async () => {
            await budgetApi.remove(budget.id)
            setBorrando(false)
            onDelete?.()
          }}
          onCerrar={() => setBorrando(false)}
        />
      )}
    </div>
  )
}
