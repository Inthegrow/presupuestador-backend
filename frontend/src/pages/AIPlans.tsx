import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Layers,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Upload,
  ImageIcon,
  Edit3,
  AlertCircle,
  Link,
  AlertTriangle,
} from 'lucide-react'
import { budgetApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { AIAnalysisResult, AISeccion, AIItem, AIItemToInsert } from '../types'
import FileUpload from '../components/ui/FileUpload'

// ─── Types for local state ────────────────────────────────────────────────────

interface LocalItem extends AIItem {
  /** Unique key for React */
  _key: string
  /** Section this item belongs to */
  _seccion_nombre: string
  _seccion_codigo: string
  /** Whether user accepted this item */
  accepted: boolean
  /** Editable quantity (user can override) */
  editCantidad: number
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CONFIDENCE_BG: Record<string, string> = {
  alta: 'bg-[#E8F5EE] border-green-200',
  media: 'bg-amber-50 border-amber-200',
  baja: 'bg-red-50 border-red-200',
}

const CONFIDENCE_BADGE: Record<string, string> = {
  alta: 'bg-green-100 text-green-700',
  media: 'bg-amber-100 text-amber-700',
  baja: 'bg-red-100 text-red-700',
}

const ANALYZING_STEPS = [
  'Procesando imagen...',
  'Identificando ambientes...',
  'Midiendo dimensiones...',
  'Detectando estructura...',
  'Analizando instalaciones...',
  'Calculando cantidades...',
  'Generando presupuesto...',
]

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AIPlans() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { puedeEditar } = useAuth()

  // State
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AIAnalysisResult | null>(null)
  const [items, setItems] = useState<LocalItem[]>([])
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [insertedCount, setInsertedCount] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const analyzeStepRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Derived
  const accepted = items.filter((i) => i.accepted)
  const totalItems = items.length
  const sectionNames = [...new Set(items.map((i) => i._seccion_nombre))]

  // ─── Upload & Analyze ─────────────────────────────────────────────────────

  async function handleFile(file: File) {
    if (!id) return
    setError('')
    setResult(null)
    setItems([])
    setDone(false)
    setAnalyzing(true)
    setAnalyzeStep(0)

    // Create preview for images
    if (file.type.startsWith('image/')) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(file))
    } else {
      setPreviewUrl(null)
    }

    // Animate steps
    let stepIdx = 0
    analyzeStepRef.current = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, ANALYZING_STEPS.length - 1)
      setAnalyzeStep(stepIdx)
    }, 4000)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await budgetApi.analyzePlan(id, formData)
      setResult(res)

      // Flatten sections into local items
      const flat: LocalItem[] = []
      let keyIdx = 0
      for (const sec of res.secciones) {
        for (const item of sec.items) {
          flat.push({
            ...item,
            _key: `ai-${keyIdx++}`,
            _seccion_nombre: sec.nombre,
            _seccion_codigo: sec.codigo,
            accepted: true, // default all accepted
            editCantidad: item.cantidad,
          })
        }
      }
      setItems(flat)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      if (msg.includes('503')) {
        setError('La IA no esta disponible. Falta configurar OPENAI_API_KEY en el servidor.')
      } else if (msg.includes('501')) {
        setError('El servidor no soporta PDF. Subi el plano como imagen JPG o PNG.')
      } else if (msg.includes('422')) {
        setError('La IA no pudo interpretar el plano. Intenta con una imagen mas clara o de mayor resolucion.')
      } else {
        setError(`Error al analizar: ${msg}`)
      }
    } finally {
      if (analyzeStepRef.current) clearInterval(analyzeStepRef.current)
      setAnalyzing(false)
    }
  }

  // ─── Item toggling ────────────────────────────────────────────────────────

  function toggleItem(key: string) {
    setItems((prev) =>
      prev.map((i) => (i._key === key ? { ...i, accepted: !i.accepted } : i)),
    )
  }

  function selectAll() {
    setItems((prev) => prev.map((i) => ({ ...i, accepted: true })))
  }

  function deselectAll() {
    setItems((prev) => prev.map((i) => ({ ...i, accepted: false })))
  }

  function updateCantidad(key: string, value: number) {
    setItems((prev) =>
      prev.map((i) => (i._key === key ? { ...i, editCantidad: value } : i)),
    )
  }

  function toggleSection(sectionName: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionName)) {
        next.delete(sectionName)
      } else {
        next.add(sectionName)
      }
      return next
    })
  }

  // ─── Insert accepted items ────────────────────────────────────────────────

  async function addAccepted() {
    if (!id || accepted.length === 0) return
    setSaving(true)
    setError('')
    try {
      const payload: AIItemToInsert[] = accepted.map((i) => ({
        seccion_nombre: i._seccion_nombre,
        seccion_codigo: i._seccion_codigo,
        codigo: i.codigo,
        descripcion: i.descripcion,
        unidad: i.unidad,
        cantidad: i.editCantidad,
        notas: i.notas,
        notas_calculo: i.notas_calculo ?? '',
        recursos: i.recursos,
      }))
      const res = await budgetApi.addItemsFromAI(id, payload)
      setInsertedCount(res.inserted)
      setDone(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      setError(`Error al agregar items: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!puedeEditar) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <Layers size={14} /> INTELIGENCIA ARTIFICIAL
        </div>
        <div className="max-w-xl bg-white border rounded-xl shadow-sm px-6 py-5 text-sm text-gray-700">
          Tu usuario solo puede mirar.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Layers size={14} /> INTELIGENCIA ARTIFICIAL
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">ANALISIS DE PLANOS CON IA</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6 ml-4">
        Subi una foto o PDF del plano. La IA identifica ambientes, estructura e instalaciones y genera items de presupuesto.
      </p>

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Success banner */}
      {done && (
        <div className="mb-4 bg-[#E8F5EE] border border-green-200 text-[#143D34] px-4 py-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-[#2D8D68]" />
            <span className="text-sm font-medium">
              {insertedCount} items agregados al presupuesto correctamente.
            </span>
          </div>
          <button
            onClick={() => navigate(`/app/budgets/${id}/editor`)}
            className="text-xs font-semibold text-[#2D8D68] hover:text-[#1B5E4B] flex items-center gap-1 transition-colors"
          >
            <Edit3 size={12} /> Ir al Editor
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column: upload + preview */}
        <div className="lg:col-span-2 space-y-4">
          <FileUpload
            accept="image/*,.pdf"
            label="Arrasta el plano aca"
            hint="JPG, PNG, WEBP o PDF -- hasta 20 MB"
            onFile={handleFile}
            icon={
              <div className="flex items-center justify-center gap-2 text-gray-400">
                <ImageIcon size={32} />
                <Upload size={24} />
              </div>
            }
          />

          {/* Analyzing animation */}
          {analyzing && (
            <div className="bg-[#E8F5EE] rounded-xl p-5 border border-green-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-6 h-6 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-[#143D34]">Analizando plano...</p>
                  <p className="text-xs text-gray-500">Esto puede tardar 20-40 segundos</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {ANALYZING_STEPS.map((step, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                      i <= analyzeStep ? 'text-[#2D8D68] font-medium' : 'text-gray-300'
                    }`}
                  >
                    {i < analyzeStep ? (
                      <Check size={12} />
                    ) : i === analyzeStep ? (
                      <div className="w-3 h-3 border border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-gray-300" />
                    )}
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Image preview */}
          {previewUrl && !analyzing && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 border-b">
                Plano cargado
              </div>
              <div className="p-2">
                <img
                  src={previewUrl}
                  alt="Plano cargado"
                  className="w-full rounded-lg max-h-[300px] object-contain bg-gray-50"
                />
              </div>
            </div>
          )}

          {/* Project summary */}
          {result && result.proyecto.descripcion && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="bg-[#2D8D68] text-white px-4 py-2.5 text-sm font-semibold">
                Resumen del Proyecto
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-700">{result.proyecto.descripcion}</p>
                {result.proyecto.superficie_total_m2 > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Superficie estimada:</span>
                    <span className="text-sm font-bold text-[#2D8D68]">
                      {result.proyecto.superficie_total_m2} m2
                    </span>
                  </div>
                )}
                {result.proyecto.ambientes_detectados.length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500 block mb-1.5">Ambientes detectados:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {result.proyecto.ambientes_detectados.map((amb, i) => (
                        <span
                          key={i}
                          className="bg-[#E8F5EE] text-[#143D34] text-[10px] font-medium px-2 py-0.5 rounded-full"
                        >
                          {amb}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right column: results */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border overflow-hidden">
            {/* Header */}
            <div className="bg-[#2D8D68] text-white px-4 py-3 flex justify-between items-center">
              <span className="font-semibold text-sm">Items Sugeridos por IA</span>
              {totalItems > 0 && (
                <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full">
                  {totalItems} items en {sectionNames.length} secciones
                </span>
              )}
            </div>

            {totalItems === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">
                {analyzing ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                    <span>Procesando plano...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Layers size={32} className="text-gray-300" />
                    <span>Carga un plano para comenzar el analisis.</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={selectAll}
                      className="text-[10px] font-medium text-[#2D8D68] hover:text-[#1B5E4B] transition-colors"
                    >
                      Seleccionar todos
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={deselectAll}
                      className="text-[10px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Deseleccionar todos
                    </button>
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {accepted.length} de {totalItems} seleccionados
                  </span>
                </div>

                {/* Sections with items */}
                <div className="max-h-[520px] overflow-y-auto">
                  {sectionNames.map((secName) => {
                    const secItems = items.filter((i) => i._seccion_nombre === secName)
                    const secAccepted = secItems.filter((i) => i.accepted).length
                    const isCollapsed = collapsedSections.has(secName)

                    return (
                      <div key={secName}>
                        {/* Section header */}
                        <button
                          onClick={() => toggleSection(secName)}
                          className="w-full px-4 py-2.5 bg-gray-50 border-b flex items-center justify-between hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {isCollapsed ? (
                              <ChevronRight size={14} className="text-gray-400" />
                            ) : (
                              <ChevronDown size={14} className="text-gray-400" />
                            )}
                            <span className="text-xs font-bold text-gray-700">{secName}</span>
                            <span className="text-[10px] text-gray-400">
                              ({secItems.length} items)
                            </span>
                          </div>
                          <span className="text-[10px] text-[#2D8D68] font-medium">
                            {secAccepted}/{secItems.length} sel.
                          </span>
                        </button>

                        {/* Items */}
                        {!isCollapsed && (
                          <div className="divide-y divide-gray-100">
                            {secItems.map((item) => (
                              <div
                                key={item._key}
                                className={`px-4 py-2.5 flex items-start gap-3 transition-colors ${
                                  item.accepted ? 'bg-white' : 'bg-gray-50 opacity-60'
                                }`}
                              >
                                {/* Checkbox */}
                                <button
                                  onClick={() => toggleItem(item._key)}
                                  className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                                    item.accepted
                                      ? 'bg-[#2D8D68] border-[#2D8D68] text-white'
                                      : 'border-gray-300 hover:border-[#2D8D68]'
                                  }`}
                                >
                                  {item.accepted && <Check size={12} />}
                                </button>

                                {/* Description & details */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <span className="text-[10px] text-gray-400 font-mono mr-1.5">
                                        {item.codigo}
                                      </span>
                                      <span className="text-xs font-medium text-gray-800">
                                        {item.descripcion}
                                      </span>
                                    </div>
                                    <span
                                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                        CONFIDENCE_BADGE[item.confianza]
                                      }`}
                                    >
                                      {item.confianza}
                                    </span>
                                  </div>

                                  {/* Unit + editable quantity + notes */}
                                  <div className="flex items-center gap-3 mt-1.5">
                                    <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                      {item.unidad}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-gray-400">Cant:</span>
                                      <input
                                        type="number"
                                        value={item.editCantidad}
                                        onChange={(e) =>
                                          updateCantidad(item._key, parseFloat(e.target.value) || 0)
                                        }
                                        className="w-16 text-xs text-right border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68]"
                                        step="0.1"
                                        min="0"
                                      />
                                    </div>
                                    {item.notas && (
                                      <span className="text-[10px] text-gray-400 truncate max-w-[200px]" title={item.notas}>
                                        {item.notas}
                                      </span>
                                    )}
                                  </div>

                                  {/* Template match badge */}
                                  <div className="mt-1">
                                    {item.template_match ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                                        <Link size={9} />
                                        Fórmula: {item.template_match.nombre}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                        <AlertTriangle size={9} />
                                        Sin fórmula — composicion estimada por IA
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    {accepted.length} de {totalItems} items seleccionados
                  </span>
                  <button
                    onClick={addAccepted}
                    disabled={accepted.length === 0 || saving || done}
                    className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg text-xs transition-colors flex items-center gap-2"
                  >
                    {saving && (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {saving
                      ? 'Agregando...'
                      : done
                        ? 'Items agregados'
                        : `Agregar ${accepted.length} items al presupuesto`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
