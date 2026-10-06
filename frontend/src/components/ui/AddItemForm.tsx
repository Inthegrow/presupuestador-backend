import { useState } from 'react'
import { X } from 'lucide-react'

const UNIT_OPTIONS = ['m\u00B2', 'm\u00B3', 'ml', 'gl', 'kg', 'un', 'mes', 'm', 'dm\u00B3']

interface AddItemFormProps {
  suggestedCode: string
  onSubmit: (data: {
    code: string
    description: string
    unidad: string
    cantidad: number
    mat_unitario: number
    mo_unitario: number
  }) => Promise<void>
  onCancel: () => void
}

export default function AddItemForm({ suggestedCode, onSubmit, onCancel }: AddItemFormProps) {
  const [code, setCode] = useState(suggestedCode)
  const [description, setDescription] = useState('')
  const [unidad, setUnidad] = useState('m\u00B2')
  const [cantidad, setCantidad] = useState('')
  const [matUnitario, setMatUnitario] = useState('')
  const [moUnitario, setMoUnitario] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError('La descripción es obligatoria')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await onSubmit({
        code: code.trim(),
        description: description.trim(),
        unidad,
        cantidad: parseFloat(cantidad) || 0,
        mat_unitario: parseFloat(matUnitario) || 0,
        mo_unitario: parseFloat(moUnitario) || 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el trabajo')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-[#2D8D68] focus:border-[#2D8D68] bg-white'

  return (
    <div className="border border-[#2D8D68]/30 bg-[#F8FDFB] rounded-lg mx-4 my-3 p-3">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-bold text-[#1B5E4B]">Trabajo sin fórmula (precio a mano)</span>
        <button
          onClick={onCancel}
          title="Cerrar"
          aria-label="Cerrar"
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
        {/* Código */}
        <label className="col-span-1 sm:col-span-2">
          <span className="block text-[10px] text-gray-500 mb-0.5 font-medium">Código</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            placeholder="1.8"
          />
        </label>

        {/* Descripción */}
        <label className="col-span-2 sm:col-span-4 order-first sm:order-none">
          <span className="block text-[10px] text-gray-500 mb-0.5 font-medium">Descripción</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
            placeholder="Ej.: Hormigón armado H21"
            autoFocus
          />
        </label>

        {/* Unidad */}
        <label className="col-span-1 sm:col-span-1">
          <span className="block text-[10px] text-gray-500 mb-0.5 font-medium">Unidad</span>
          <select
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            className={inputClass}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        {/* Cantidad */}
        <label className="col-span-1 sm:col-span-1">
          <span className="block text-[10px] text-gray-500 mb-0.5 font-medium">Cantidad</span>
          <input
            type="number"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className={inputClass}
            placeholder="0"
            step="any"
          />
        </label>

        {/* Materiales por unidad */}
        <label className="col-span-1 sm:col-span-2">
          <span className="block text-[10px] text-gray-500 mb-0.5 font-medium">Materiales por unidad</span>
          <input
            type="number"
            value={matUnitario}
            onChange={(e) => setMatUnitario(e.target.value)}
            className={inputClass}
            placeholder="0"
            step="any"
          />
        </label>

        {/* Mano de obra por unidad */}
        <label className="col-span-1 sm:col-span-2">
          <span className="block text-[10px] text-gray-500 mb-0.5 font-medium">Mano de obra por unidad</span>
          <input
            type="number"
            value={moUnitario}
            onChange={(e) => setMoUnitario(e.target.value)}
            className={inputClass}
            placeholder="0"
            step="any"
          />
        </label>
      </div>

      {error && (
        <p className="text-[10px] text-red-600 mt-1.5">{error}</p>
      )}

      <div className="flex items-center justify-end gap-2 mt-2.5">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-3 py-1.5 text-xs bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold rounded-md transition-colors"
        >
          {submitting ? 'Agregando…' : 'Agregar'}
        </button>
      </div>
    </div>
  )
}
