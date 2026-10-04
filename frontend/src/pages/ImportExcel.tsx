import { useState } from 'react'
import { Upload, CheckCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { budgetApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import FileUpload from '../components/ui/FileUpload'

export default function ImportExcel() {
  const navigate = useNavigate()
  const { puedeEditar } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    budget_id: string
    budget_name: string
    items_inserted: number
    resources_inserted: number
    catalog_entries: number
    date_codes_corrected: number
  } | null>(null)

  function handleFile(f: File) {
    setFile(f)
    setError('')
    setResult(null)
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setError('')
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await budgetApi.importExcel(formData)
      setResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setError(`Error al importar: ${msg}`)
    } finally {
      setImporting(false)
    }
  }

  if (!puedeEditar) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <Upload size={14} /> IMPORTACION
        </div>
        <div className="max-w-xl bg-white border rounded-xl shadow-sm px-6 py-5 text-sm text-gray-700">
          Tu usuario solo puede mirar.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Upload size={14} /> IMPORTACION
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">IMPORTAR EXCEL</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6 ml-4">
        Arrastra tu Excel de presupuesto. El sistema detecta hojas, items, catalogos y recursos automaticamente.
      </p>

      <div className="max-w-3xl">
        {/* File upload */}
        {!result && (
          <div className="mb-6">
            <FileUpload
              accept=".xlsx,.xls"
              label="Arrastra tu Excel aca"
              hint=".xlsx o .xls — Formato Terrac (Las Heras, Lugones, El Encuentro)"
              onFile={handleFile}
              icon={
                <svg className="mx-auto" width="48" height="48" fill="none" stroke="#9CA3AF" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
              }
            />
          </div>
        )}

        {/* File selected — show import button */}
        {file && !result && (
          <div className="bg-white rounded-xl border p-5 fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <Upload size={20} className="text-[#2D8D68]" />
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm">{file.name}</div>
                <div className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</div>
              </div>
            </div>

            <div className="bg-[#E8F5EE] rounded-lg p-3 border border-green-200 text-xs text-[#143D34] mb-4">
              El sistema va a:
              <ul className="mt-1 space-y-0.5 ml-3 list-disc">
                <li>Detectar catalogos (00_Mat, 00_MO, 00_Eq, 00_Sub)</li>
                <li>Importar items desde hoja 01_C&P</li>
                <li>Leer hojas de detalle → recursos por item</li>
                <li>Corregir codigos-fecha automaticamente si los detecta</li>
              </ul>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleImport}
                disabled={importing}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
              >
                {importing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {importing ? 'Importando...' : 'Importar como presupuesto nuevo'}
              </button>
              <button
                onClick={() => { setFile(null); setError('') }}
                className="bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Success result */}
        {result && (
          <div className="bg-white rounded-xl border p-6 fade-in">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle size={28} className="text-[#2D8D68]" />
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{result.budget_name}</h3>
                <p className="text-xs text-gray-500">Importado exitosamente</p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-5">
              <div className="bg-[#E8F5EE] rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-[#2D8D68]">{result.items_inserted}</div>
                <div className="text-[10px] text-gray-500">ITEMS</div>
              </div>
              <div className="bg-[#E8F5EE] rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-[#2D8D68]">{result.resources_inserted}</div>
                <div className="text-[10px] text-gray-500">RECURSOS</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-600">{result.catalog_entries}</div>
                <div className="text-[10px] text-gray-500">CATALOGOS</div>
              </div>
              {result.date_codes_corrected > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-amber-600">{result.date_codes_corrected}</div>
                  <div className="text-[10px] text-gray-500">FECHAS CORREGIDAS</div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/app/budgets/${result.budget_id}/editor`)}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                Abrir en Editor
              </button>
              <button
                onClick={() => navigate('/app/dashboard')}
                className="bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Volver al Dashboard
              </button>
              <button
                onClick={() => { setFile(null); setResult(null) }}
                className="bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Importar otro
              </button>
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="mt-4 bg-[#E8F5EE] rounded-xl border border-green-200 p-4 text-xs text-[#143D34]">
          <p className="font-semibold mb-2">Formatos compatibles</p>
          <ul className="space-y-1 text-gray-600">
            <li>Catalogos (00_Mat, 00_MO, 00_Eq, 00_Sub) → van a <strong>Catalogos de Precios</strong></li>
            <li>01_C&P → crea el <strong>arbol de items</strong> con costos</li>
            <li>Hojas detalle (1.1, 1.2, etc.) → crean los <strong>recursos por item</strong></li>
            <li>Codigos-fecha (Excel bug) → se <strong>corrigen automaticamente</strong></li>
          </ul>
        </div>
      </div>
    </div>
  )
}
