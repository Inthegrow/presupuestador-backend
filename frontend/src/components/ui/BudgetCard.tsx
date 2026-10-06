import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { Budget } from '../../types'
import { fmtPesos } from '../../lib/format'
import { budgetApi } from '../../lib/api'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador', borrador: 'Borrador',
  active: 'Activo', activo: 'Activo',
  approved: 'Aprobado', aprobado: 'Aprobado',
  sent: 'Enviado', presentado: 'Enviado',
  review: 'En Revisión',
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

type DeleteState = 'idle' | 'confirm1' | 'confirm2' | 'deleting'

interface Props {
  budget: Budget
  directTotal?: number
  netoTotal?: number
  subtitle?: string
  tags?: string[]
  onDelete?: () => void
}

export default function BudgetCard({ budget, directTotal, netoTotal, subtitle, tags, onDelete }: Props) {
  const { esAdmin } = useAuth()
  const navigate = useNavigate()
  const status = budget.status?.toLowerCase() || 'borrador'
  const [deleteState, setDeleteState] = useState<DeleteState>('idle')

  async function handleConfirmDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteState('deleting')
    try {
      await budgetApi.remove(budget.id)
      onDelete?.()
    } catch {
      setDeleteState('idle')
    }
  }

  function handleTrashClick(e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteState('confirm1')
  }

  function handleFirstConfirm(e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteState('confirm2')
  }

  function handleCancel(e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteState('idle')
  }

  return (
    <div
      onClick={() => navigate(`/app/budgets/${budget.id}/editor`)}
      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition cursor-pointer overflow-hidden"
    >
      <div className={`h-1 ${BAR_COLORS[status] ?? 'bg-gray-300'}`} />
      <div className="p-5">
        <div className="flex justify-between items-start mb-2">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500'}`}>
            {STATUS_LABELS[status] || budget.status || 'Borrador'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400">
              {budget.source_file ? '✓ Excel' : 'Manual'}
            </span>
            {esAdmin && (
              <button
                onClick={handleTrashClick}
                className="text-gray-300 hover:text-red-400 transition-colors p-0.5"
                title="Eliminar presupuesto"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* First confirmation */}
        {deleteState === 'confirm1' && (
          <div
            className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium text-red-700 mb-2">¿Eliminar este presupuesto?</p>
            <div className="flex gap-2">
              <button
                onClick={handleFirstConfirm}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold py-1.5 rounded transition-colors"
              >
                Si, eliminar
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs font-medium py-1.5 rounded hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Second confirmation */}
        {deleteState === 'confirm2' && (
          <div
            className="mb-3 bg-red-50 border border-red-300 rounded-lg p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-red-800 mb-2 leading-relaxed">
              <span className="font-bold">ATENCION:</span> Se eliminara permanentemente{' '}
              <span className="font-semibold">"{budget.name}"</span> con todos sus items y recursos.
              Esta accion NO se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1.5 rounded transition-colors"
              >
                Confirmar eliminacion
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs font-medium py-1.5 rounded hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Deleting state */}
        {deleteState === 'deleting' && (
          <div
            className="mb-3 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Eliminando...
          </div>
        )}

        <h3 className="font-bold text-gray-900">{budget.name}</h3>
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
    </div>
  )
}
