import { useEffect, useState } from 'react'
import { Library, ChevronDown, ChevronRight, Trash2, Plus, Pencil } from 'lucide-react'
import { templateApi } from '../lib/api'
import TemplateEditor from '../components/ui/TemplateEditor'
import type { Template, TemplateParam, TemplateResource } from '../types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  material: 'Materiales',
  mano_obra: 'Mano de Obra',
  equipo: 'Equipos',
  mo_material: 'Mat. Indirectos',
  subcontrato: 'Subcontratos',
}

const TIPO_ORDER = ['material', 'mano_obra', 'equipo', 'mo_material', 'subcontrato']

function parseList<T>(value: T[] | string | undefined): T[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return value || []
}

/** How the quantity of a resource is calculated, in words. */
function quantityText(r: TemplateResource): string {
  if (r.tipo === 'mano_obra') {
    if (r.rendimiento !== undefined && r.rendimiento !== '') {
      return `${r.trabajadores ?? 1} trab · días = Q / ${r.rendimiento}`
    }
    return `${r.trabajadores_por_unidad ?? '—'} trab/u × ${r.dias_por_unidad ?? '—'} días`
  }
  if (r.formula) return r.formula
  if (r.cantidad_por_unidad !== undefined) return `Q * ${r.cantidad_por_unidad}`
  return '—'
}

function groupByTipo(recursos: TemplateResource[]): Record<string, TemplateResource[]> {
  const groups: Record<string, TemplateResource[]> = {}
  for (const r of recursos) {
    const tipo = r.tipo || 'material'
    if (!groups[tipo]) groups[tipo] = []
    groups[tipo].push(r)
  }
  return groups
}

// ─── TemplateCard ──────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onDelete,
  onEdit,
}: {
  template: Template
  onDelete: (id: string) => void
  onEdit: (t: Template) => void
}) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const recursos = parseList(template.recursos)
  const parametros = parseList<TemplateParam>(template.parametros)
  const groups = groupByTipo(recursos)

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await templateApi.remove(template.id)
      onDelete(template.id)
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Card header */}
      <div
        className="p-4 flex items-start justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm text-gray-900">{template.nombre}</span>
            {template.unidad && (
              <span className="bg-blue-100 text-blue-700 rounded text-xs px-2 py-0.5 font-medium">
                {template.unidad}
              </span>
            )}
            {template.categoria && (
              <span className="bg-purple-100 text-purple-700 rounded text-xs px-2 py-0.5 font-medium">
                {template.categoria}
              </span>
            )}
          </div>
          {template.descripcion && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{template.descripcion}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {recursos.length} {recursos.length === 1 ? 'recurso' : 'recursos'}
            {parametros.length > 0 && (
              <span className="ml-2 font-mono">
                {parametros.map((p) => `${p.clave} = ${p.valor}${p.unidad ? ` ${p.unidad}` : ''}`).join(' · ')}
              </span>
            )}
            {template.desperdicio_pct !== null && template.desperdicio_pct !== undefined && (
              <span className="ml-2">desperdicio {template.desperdicio_pct}%</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(template) }}
            className="text-xs px-2 py-1 rounded text-gray-400 hover:text-[#2D8D68] hover:bg-[#E8F5EE] flex items-center gap-1"
            title="Editar fórmulas y parámetros"
          >
            <Pencil size={13} />
          </button>
          {/* Delete button */}
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete() }}
            disabled={deleting}
            className={`text-xs px-2 py-1 rounded transition-colors flex items-center gap-1 ${
              confirmDelete
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
            } disabled:opacity-50`}
            title={confirmDelete ? 'Confirmar eliminacion' : 'Eliminar template'}
          >
            {deleting ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            {confirmDelete && !deleting && <span>Confirmar</span>}
          </button>

          {/* Expand icon */}
          {open
            ? <ChevronDown size={16} className="text-gray-400" />
            : <ChevronRight size={16} className="text-gray-400" />
          }
        </div>
      </div>

      {/* Expandable recursos section */}
      {open && (
        <div className="border-t fade-in">
          {recursos.length === 0 ? (
            <p className="p-4 text-xs text-gray-400 italic">Sin recursos definidos</p>
          ) : (
            TIPO_ORDER.filter((tipo) => groups[tipo]?.length).map((tipo) => (
              <div key={tipo}>
                {/* Group header */}
                <div className="px-4 py-1.5 bg-[#F0FAF5] border-b border-t text-[10px] font-bold text-[#1B5E4B] tracking-wide">
                  {TIPO_LABELS[tipo] || tipo}
                </div>

                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Codigo</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Descripcion</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Cantidad</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Unidad</th>
                      <th className="px-3 py-1.5 text-right text-gray-500 font-medium">
                        {tipo === 'mano_obra' ? 'Cargas %' : 'Desperd. %'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups[tipo].map((r, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-mono text-gray-400">{r.codigo || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-800">{r.descripcion || '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-700">
                          {quantityText(r)}
                          {r.lo_compra_cliente && <span className="ml-1 font-sans bg-amber-100 text-amber-700 rounded px-1.5">cliente</span>}
                          {r.redondear && <span className="ml-1 font-sans bg-blue-100 text-blue-700 rounded px-1.5">redondea</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{tipo === 'mano_obra' ? 'jornal' : r.unidad || '—'}</td>
                        <td className="px-3 py-1.5 text-right text-gray-700">
                          {tipo === 'mano_obra'
                            ? `${r.cargas_sociales_pct ?? 25}%`
                            : r.desperdicio_pct === undefined || r.desperdicio_pct === null || r.desperdicio_pct === ''
                              ? <span className="text-gray-400">hereda</span>
                              : `${r.desperdicio_pct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Templates page ────────────────────────────────────────────────────────────

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('Todos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // undefined = closed, null = new template
  const [editing, setEditing] = useState<Template | null | undefined>(undefined)

  useEffect(() => {
    templateApi.categories()
      .then(setCategories)
      .catch(() => {/* silently ignore */})
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const categoria = activeCategory === 'Todos' ? undefined : activeCategory
    templateApi.list(categoria)
      .then((data) => setTemplates(data as Template[]))
      .catch((err) => setError(err instanceof Error ? err.message : 'Error al cargar templates'))
      .finally(() => setLoading(false))
  }, [activeCategory])

  function handleDelete(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  function handleSaved(saved: Template) {
    setTemplates((prev) =>
      prev.some((t) => t.id === saved.id) ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved],
    )
    setEditing(undefined)
  }

  return (
    <div className="p-6 fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Library size={14} /> COMPOSICIONES
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">BIBLIOTECA DE TEMPLATES</h1>
        <span className="bg-[#E8F5EE] text-[#1B5E4B] text-xs font-medium px-2 py-0.5 rounded-full">
          {templates.length} templates
        </span>
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {['Todos', ...categories].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-[#2D8D68] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando templates...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
          <p className="font-semibold mb-1">Error al cargar templates</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="max-w-3xl space-y-3">
        {!loading && !error && templates.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-400">
            <Library size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No hay templates cargados.</p>
            <p className="text-xs mt-1">
              {activeCategory !== 'Todos'
                ? `No hay templates en la categoria "${activeCategory}".`
                : 'Importa un Excel con composiciones para crear templates.'}
            </p>
          </div>
        )}

        {templates.map((t) => (
          <TemplateCard key={t.id} template={t} onDelete={handleDelete} onEdit={setEditing} />
        ))}

        <button
          onClick={() => setEditing(null)}
          className="w-full border-2 border-dashed border-gray-200 text-gray-500 hover:border-[#2D8D68] hover:text-[#2D8D68] py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Nueva plantilla
        </button>
      </div>

      {editing !== undefined && (
        <TemplateEditor template={editing} onSaved={handleSaved} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
