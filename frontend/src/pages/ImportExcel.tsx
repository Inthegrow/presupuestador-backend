import { useState } from 'react'
import { Upload, CheckCircle, ClipboardCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { budgetApi, esCargarObra, textoDeError } from '../lib/api'
import { dejarArchivoParaCargarObra } from '../lib/archivoPendiente'
import { fmtPesos } from '../lib/format'
import { useAuth } from '../contexts/AuthContext'
import FileUpload from '../components/ui/FileUpload'

// "Tu Excel decía $X; con tu Coeficiente de pase da $Y": solo si los dos precios sin IVA difieren (en pesos)
function diferenciaExcel(r: { neto_excel?: number | null; neto_app?: number | null }): { excel: number; app: number } | null {
  const ex = r.neto_excel
  const app = r.neto_app
  if (typeof ex !== 'number' || typeof app !== 'number' || !Number.isFinite(ex) || !Number.isFinite(app)) return null
  return Math.round(ex) === Math.round(app) ? null : { excel: ex, app }
}

// Qué pasó con la lista de precios del Excel (nada si no traía hojas de precios)
function listaResumen(r: { catalog_reused: boolean; catalog_name: string | null; precios_actualizados: number; precios_nuevos: number }) {
  if (!r.catalog_name) return ''
  if (!r.catalog_reused) return `Creé la lista ${r.catalog_name}`
  const cambiados = r.precios_actualizados === 1 ? '1 precio cambiado' : `${r.precios_actualizados} precios cambiados`
  const nuevos = r.precios_nuevos === 1 ? '1 nuevo' : `${r.precios_nuevos} nuevos`
  return `Actualicé la lista ${r.catalog_name}: ${cambiados}, ${nuevos}`
}

export default function ImportExcel() {
  const navigate = useNavigate()
  const { puedeEditar } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  // 422 CARGAR_OBRA: el Excel trae el cómputo sin precios; no se creó nada y va por Cargar obra
  const [paraCargarObra, setParaCargarObra] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof budgetApi.importExcel>> | null>(null)

  function handleFile(f: File) {
    setFile(f)
    setError('')
    setParaCargarObra(null)
    setResult(null)
  }

  // El mismo archivo, ya elegido, en Cargar obra
  function irACargarObra() {
    if (!file) return
    dejarArchivoParaCargarObra(file)
    navigate('/app/cargar-obra')
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setError('')
    setParaCargarObra(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await budgetApi.importExcel(formData)
      setResult(res)
    } catch (e) {
      if (esCargarObra(e)) {
        setParaCargarObra(e.detail.mensaje?.trim()
          || 'Este Excel trae el cómputo sin precios. Para que la app lo calcule con las fórmulas, cargalo en Cargar obra.')
        return
      }
      setError(`No se pudo importar: ${textoDeError(e, 'probá de nuevo.')}`)
    } finally {
      setImporting(false)
    }
  }

  if (!puedeEditar) {
    return (
      <div className="p-4 md:p-6 fade-in">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <Upload size={14} /> IMPORTACIÓN
        </div>
        <div className="max-w-xl bg-white border rounded-xl shadow-sm px-6 py-5 text-sm text-gray-700">
          Tu usuario solo puede mirar.
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Upload size={14} /> IMPORTACIÓN
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">IMPORTAR EXCEL</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6 ml-4">
        Copiás un presupuesto ya hecho, con sus precios: arrastrá el Excel y la app arma los trabajos, sus recursos y las listas de precios.
      </p>

      <div className="max-w-3xl">
        {/* File upload */}
        {!result && !paraCargarObra && (
          <div className="mb-6">
            <FileUpload
              accept=".xlsx,.xls"
              label="Arrastrá tu Excel acá"
              labelCelular="Elegí tu Excel"
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

        {/* El Excel no trae precios: no se creó nada, va por Cargar obra con el mismo archivo */}
        {file && !result && paraCargarObra && (
          <div role="status" data-testid="ir-a-cargar-obra" className="bg-white rounded-xl border border-sky-200 shadow-sm p-4 md:p-5 fade-in">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-sky-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <ClipboardCheck size={20} className="text-sky-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 text-sm break-all">{file.name}</div>
                <p className="text-sm text-gray-800 mt-1 whitespace-pre-line" data-testid="mensaje-cargar-obra">{paraCargarObra}</p>
                <p className="text-xs text-gray-500 mt-1">No se creó ningún presupuesto ni lista de precios.</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-4">
              <button
                onClick={irACargarObra}
                className="min-h-11 sm:min-h-0 justify-center bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
              >
                <ClipboardCheck size={16} /> Cargarlo en Cargar obra
              </button>
              <button
                onClick={() => { setFile(null); setParaCargarObra(null) }}
                className="min-h-11 sm:min-h-0 bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Elegir otro Excel
              </button>
            </div>
          </div>
        )}

        {/* File selected — show import button */}
        {file && !result && !paraCargarObra && (
          <div className="bg-white rounded-xl border p-5 fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <Upload size={20} className="text-[#2D8D68]" />
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm break-all">{file.name}</div>
                <div className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</div>
              </div>
            </div>

            <div className="bg-[#E8F5EE] rounded-lg p-3 border border-green-200 text-xs text-[#143D34] mb-4">
              La app va a:
              <ul className="mt-1 space-y-0.5 ml-3 list-disc">
                <li>Leer las listas de precios (00_Mat, 00_MO, 00_Eq, 00_Sub)</li>
                <li>Copiar los trabajos de la hoja del cómputo (01_C&amp;P o CYP)</li>
                <li>Leer las hojas de detalle: los recursos de cada trabajo</li>
                <li>Corregir solos los códigos que Excel convirtió en fechas</li>
              </ul>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                onClick={handleImport}
                disabled={importing}
                className="min-h-11 sm:min-h-0 justify-center bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
              >
                {importing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {importing ? 'Importando…' : 'Importar como presupuesto nuevo'}
              </button>
              <button
                onClick={() => { setFile(null); setError('') }}
                className="min-h-11 sm:min-h-0 bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Success result */}
        {result && (
          <div className="bg-white rounded-xl border p-4 md:p-6 fade-in">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle size={28} className="text-[#2D8D68]" />
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{result.budget_name}</h3>
                <p className="text-xs text-gray-500">Listo: quedó importado</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-5">
              <div className="bg-[#E8F5EE] rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-[#2D8D68]">{result.items_inserted}</div>
                <div className="text-[10px] text-gray-500">TRABAJOS</div>
              </div>
              <div className="bg-[#E8F5EE] rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-[#2D8D68]">{result.resources_inserted}</div>
                <div className="text-[10px] text-gray-500">RECURSOS</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-blue-600">{result.catalog_entries}</div>
                <div className="text-[10px] text-gray-500">LISTAS DE PRECIOS</div>
              </div>
              {result.date_codes_corrected > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-amber-600">{result.date_codes_corrected}</div>
                  <div className="text-[10px] text-gray-500">FECHAS CORREGIDAS</div>
                </div>
              )}
            </div>

            {listaResumen(result) && (
              <p className="text-sm text-gray-700 mb-5">{listaResumen(result)}</p>
            )}

            {(() => {
              const d = diferenciaExcel(result)
              if (!d) return null
              return (
                <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2" data-testid="diferencia-excel">
                  <p className="text-sm text-amber-900">
                    Tu Excel decía {fmtPesos(d.excel)}; con tu Coeficiente de pase da <strong>{fmtPesos(d.app)}</strong>.
                  </p>
                  <p className="text-[11px] text-amber-800/80 mt-0.5">
                    Precios sin IVA. La app toma el costo directo de tu Excel y le suma indirectos, beneficio e impuestos con tus porcentajes.
                  </p>
                </div>
              )
            })()}

            <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
              <button
                onClick={() => navigate(`/app/budgets/${result.budget_id}/editor`)}
                className="min-h-11 sm:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                Abrir el presupuesto
              </button>
              <button
                onClick={() => navigate('/app/dashboard')}
                className="min-h-11 sm:min-h-0 bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Volver a Mis presupuestos
              </button>
              <button
                onClick={() => { setFile(null); setResult(null) }}
                className="min-h-11 sm:min-h-0 bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
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
            <li>Listas de precios (00_Mat, 00_MO, 00_Eq, 00_Sub) → van a <strong>Lista de precios</strong></li>
            <li>01_C&amp;P o CYP → arma los <strong>rubros y trabajos</strong> con sus costos</li>
            <li>Un cómputo con cantidades y sin precios → va por <strong>Cargar obra</strong>, que lo calcula con las fórmulas</li>
            <li>Hojas de detalle (1.1, 1.2, etc.) → arman los <strong>recursos de cada trabajo</strong></li>
            <li>Códigos que Excel convirtió en fechas → se <strong>corrigen solos</strong></li>
          </ul>
        </div>
      </div>
    </div>
  )
}
