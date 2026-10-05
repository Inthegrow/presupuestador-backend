import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, FileText, Table, Users } from 'lucide-react'
import { budgetApi } from '../lib/api'
import type { Budget } from '../types'

interface ExportOption {
  id: string
  icon: React.ReactNode
  title: string
  subtitle: string
  badge: string
  badgeStyle: string
  action: () => Promise<void>
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑüÜ ]/g, '').trim().replace(/\s+/g, '_')
}

export default function Export() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)

  useEffect(() => {
    if (!id) return
    budgetApi.get(id).then(setBudget).catch(() => {})
  }, [id])

  const budgetName = budget?.name ? safeName(budget.name) : 'presupuesto'

  async function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const OPTIONS: ExportOption[] = [
    {
      id: 'pdf',
      icon: <FileText size={28} strokeWidth={1.5} className="text-[#2D8D68]" />,
      title: 'PDF Profesional',
      subtitle: 'Portada · tabla · cascada de costos',
      badge: 'UNIVERSAL',
      badgeStyle: 'bg-[#E8F5EE] text-[#166534]',
      action: async () => {
        if (!id) return
        const blob = await budgetApi.exportPdf(id)
        await downloadBlob(blob, `${budgetName}_presupuesto.pdf`)
      },
    },
    {
      id: 'excel',
      icon: <Table size={28} strokeWidth={1.5} className="text-[#2D8D68]" />,
      title: 'Excel Estándar (BoQ)',
      subtitle: 'Bill of Quantities genérico',
      badge: 'UNIVERSAL',
      badgeStyle: 'bg-[#E8F5EE] text-[#166534]',
      action: async () => {
        if (!id) return
        const blob = await budgetApi.exportExcel(id)
        await downloadBlob(blob, `${budgetName}.xlsx`)
      },
    },
    {
      id: 'terrac',
      icon: <Table size={28} strokeWidth={1.5} className="text-[#2D8D68]" />,
      title: 'Excel Formato Terrac',
      subtitle: '26 col + hojas detalle 78 filas',
      badge: 'TERRAC',
      badgeStyle: 'bg-blue-50 text-blue-700',
      action: async () => {
        if (!id) return
        const blob = await budgetApi.exportExcel(id)
        await downloadBlob(blob, `${budgetName}_terrac.xlsx`)
      },
    },
    {
      id: 'client',
      icon: <Users size={28} strokeWidth={1.5} className="text-[#2D8D68]" />,
      title: 'Vista Cliente (Venta)',
      subtitle: 'Precio de venta por trabajo, sin costos internos',
      badge: 'UNIVERSAL',
      badgeStyle: 'bg-[#E8F5EE] text-[#166534]',
      action: async () => {
        if (!id) return
        const blob = await budgetApi.exportPdf(id, 'cliente')
        await downloadBlob(blob, `${budgetName}_cliente.pdf`)
      },
    },
  ]

  async function handleExport(opt: ExportOption) {
    setLoading(opt.id)
    setDone(null)
    try {
      await opt.action()
      setDone(opt.id)
      setTimeout(() => setDone(null), 3000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al exportar'
      setError(msg)
      setTimeout(() => setError(null), 5000)
    }
    setLoading(null)
  }

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Download size={14} /> EXPORTACIÓN
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">EXPORTAR PRESUPUESTO</h1>
      </div>

      <div className="max-w-2xl grid grid-cols-2 gap-4">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleExport(opt)}
            disabled={loading === opt.id}
            className="bg-white rounded-xl border p-5 hover:shadow-md hover:border-[#2D8D68] transition text-left group disabled:opacity-60"
          >
            <div className="mb-2">
              {loading === opt.id ? (
                <div className="w-7 h-7 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
              ) : (
                opt.icon
              )}
            </div>
            <h3 className="font-bold text-gray-900 text-sm group-hover:text-[#2D8D68] transition-colors">
              {opt.title}
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">{opt.subtitle}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${opt.badgeStyle}`}>
                {opt.badge}
              </span>
              {done === opt.id && (
                <span className="text-[10px] text-[#2D8D68] font-medium">Descargado</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 max-w-2xl bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-semibold mb-1">Error al exportar</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      <div className="mt-6 max-w-2xl bg-[#E8F5EE] rounded-xl border border-green-200 p-4 text-xs text-[#143D34]">
        <p className="font-semibold mb-1">Nota sobre formatos</p>
        <p className="text-gray-600">
          El PDF incluye logo SOLE y está diseñado para presentar al cliente.
          El formato Terrac mantiene la estructura original de 26 columnas y 44+ hojas detalle para compatibilidad total.
        </p>
      </div>
    </div>
  )
}
