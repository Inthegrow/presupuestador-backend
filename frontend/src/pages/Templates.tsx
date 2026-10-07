import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Library, ChevronDown, ChevronRight, Trash2, Plus, Pencil, Search, X, CheckCircle, Wand2 } from 'lucide-react'
import { correccionesApi, mensajeDeError, templateApi } from '../lib/api'
import type { LoteCorrecciones } from '../lib/api'
import { compararFormulas, palabrasDe, tieneTodas } from '../lib/buscar'
import { conTildes, nombreParametro } from '../lib/textos'
import { useAuth } from '../contexts/AuthContext'
import TemplateEditor from '../components/ui/TemplateEditor'
import NotaCorreccion from '../components/NotaCorreccion'
import type { Template, TemplateParam, TemplateResource } from '../types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  material: 'Materiales',
  mano_obra: 'Mano de obra',
  equipo: 'Equipos',
  mo_material: 'Materiales indirectos',
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
  resaltado,
}: {
  template: Template
  onDelete: (id: string) => void
  onEdit: (t: Template) => void
  // Recién creada o guardada: se marca un momento con este texto
  resaltado?: string | null
}) {
  const { puedeEditar } = useAuth()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const recursos = parseList(template.recursos)
  const parametros = parseList<TemplateParam>(template.parametros)
  const groups = groupByTipo(recursos)

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await templateApi.remove(template.id)
      onDelete(template.id)
    } catch (err) {
      setDeleting(false)
      setConfirmDelete(false)
      setDeleteError(`No se pudo borrar: ${mensajeDeError(err)}`)
    }
  }

  return (
    <div
      data-template-id={template.id}
      data-testid="formula"
      className={`bg-white rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-all duration-500 ${
        resaltado ? 'border-[#2D8D68] ring-4 ring-[#2D8D68]/20' : 'border-gray-100'
      }`}
    >
      {/* Card header */}
      <div
        className="p-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="grow basis-48 min-w-0">
          {resaltado && (
            <div role="status" className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B5E4B] bg-[#E8F5EE] rounded-full px-2 py-0.5">
              <CheckCircle size={12} className="text-[#2D8D68]" /> {resaltado}
            </div>
          )}
          <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap mb-1">
            {template.codigo && (
              <span className="text-xs text-gray-400 tabular-nums" data-testid="formula-codigo">{template.codigo}</span>
            )}
            <span className="font-semibold text-sm text-gray-900 break-words min-w-0">{template.nombre}</span>
            {template.unidad && (
              <span className="bg-blue-100 text-blue-700 rounded text-xs px-2 py-0.5 font-medium">
                {template.unidad}
              </span>
            )}
            {template.categoria && (
              <span className="bg-purple-100 text-purple-700 rounded text-xs px-2 py-0.5 font-medium">
                {conTildes(template.categoria)}
              </span>
            )}
          </div>
          {template.descripcion && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{template.descripcion}</p>
          )}
          {deleteError && <p role="alert" className="text-xs text-red-600 mt-1">{deleteError}</p>}
          <p className="text-xs text-gray-400 mt-1">
            {recursos.length} {recursos.length === 1 ? 'recurso' : 'recursos'}
            {parametros.length > 0 && (
              <span className="ml-2" title={parametros.map((p) => `En la fórmula: ${p.clave}`).join(' · ')}>
                {parametros.map((p) => `${nombreParametro(p.clave, p.descripcion, !p.unidad)} = ${p.valor}${p.unidad ? ` ${p.unidad}` : ''}`).join(' · ')}
              </span>
            )}
            {template.desperdicio_pct !== null && template.desperdicio_pct !== undefined && (
              <span className="ml-2">desperdicio {template.desperdicio_pct}%</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {puedeEditar && (<>
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
            title={confirmDelete ? 'Tocá de nuevo para eliminarla' : 'Eliminar fórmula'}
          >
            {deleting ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
            {confirmDelete && !deleting && <span>Confirmar</span>}
          </button>
          </>)}

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
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Código</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Descripción</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Cantidad</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">Unidad</th>
                      <th className="px-3 py-1.5 text-right text-gray-500 font-medium">
                        {tipo === 'mano_obra' ? 'Cargas sociales %' : 'Desperdicio %'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups[tipo].map((r, i) => (
                      <Fragment key={i}>
                      <tr className={`hover:bg-gray-50 ${r.correccion?.texto ? '' : 'border-b last:border-0'}`}>
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
                      {r.correccion?.texto && (
                        <tr className="border-b last:border-0">
                          <td colSpan={5} className="px-3 pb-1.5 pt-0">
                            <NotaCorreccion texto={r.correccion.texto} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
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

/** "Revisión de Ginkgo: 15 correcciones para aplicar · Ver" arriba de la lista. Si no hay o falla, no se muestra. */
function AvisoCorrecciones() {
  const [lote, setLote] = useState<LoteCorrecciones | null>(null)
  useEffect(() => {
    let vivo = true
    correccionesApi.listar().then((l) => { if (vivo) setLote(l) }).catch(() => {})
    return () => { vivo = false }
  }, [])
  const lista = lote?.correcciones ?? []
  if (lista.length === 0) return null
  const paraAplicar = lista.filter((c) => !c.aplicada && (c.estado === 'para_aplicar' || c.estado === 'en_parte')).length
  const noCoinciden = lista.filter((c) => !c.aplicada && c.estado === 'no_coincide').length
  const aplicadas = lista.filter((c) => !!c.aplicada).length
  const pendiente = paraAplicar > 0
  const partes = [
    paraAplicar > 0 && `${paraAplicar} ${paraAplicar === 1 ? 'corrección' : 'correcciones'} para aplicar`,
    aplicadas > 0 && `${aplicadas} ${aplicadas === 1 ? 'aplicada' : 'aplicadas'}`,
    noCoinciden > 0 && `${noCoinciden} no ${noCoinciden === 1 ? 'coincide' : 'coinciden'}`,
  ].filter(Boolean)
  return (
    <Link
      to="/app/templates/correcciones"
      data-testid="aviso-correcciones"
      className={`mb-3 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm shadow-sm transition-colors ${
        pendiente
          ? 'border-[#2D8D68]/40 bg-white hover:bg-[#F3FAF6] text-gray-800'
          : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-600'
      }`}
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${pendiente ? 'bg-[#2D8D68] text-white' : 'bg-[#E8F5EE] text-[#2D8D68]'}`} aria-hidden>
        <Wand2 size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{lote?.titulo || 'Revisión de Ginkgo'}:</strong> {partes.join(' · ')}
      </span>
      <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold text-[#2D8D68]">
        Ver <ChevronRight size={14} />
      </span>
    </Link>
  )
}

// ─── Templates page ────────────────────────────────────────────────────────────

const TODOS = 'Todos'

export default function Templates() {
  const { puedeEditar } = useAuth()
  const [templates, setTemplates] = useState<Template[]>([])
  const [activeCategory, setActiveCategory] = useState<string>(TODOS)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  // undefined = closed, null = new template
  const [editing, setEditing] = useState<Template | null | undefined>(undefined)
  // La fórmula recién creada / guardada, para llevar la lista hasta ella y marcarla un momento
  const [resaltada, setResaltada] = useState<{ id: string; texto: string } | null>(null)
  const buscadorRef = useRef<HTMLInputElement>(null)

  // Todas las fórmulas de una vez: el rubro y la búsqueda filtran acá (y el contador sabe el total)
  useEffect(() => {
    setLoading(true)
    setError(null)
    templateApi.list()
      .then((data) => setTemplates(Array.isArray(data) ? (data as Template[]) : []))
      .catch((err) => setError(mensajeDeError(err, 'No pude traer las fórmulas.')))
      .finally(() => setLoading(false))
  }, [intento])

  // Los rubros salen de las fórmulas mismas (una fórmula nueva con un rubro nuevo lo agrega)
  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.categoria).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'es')),
    [templates],
  )

  const palabras = palabrasDe(q)
  const visibles = useMemo(
    () =>
      templates
        .filter((t) => activeCategory === TODOS || t.categoria === activeCategory)
        .filter((t) => tieneTodas(palabras, t.codigo, t.nombre, t.categoria, t.descripcion))
        .sort(compararFormulas),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, activeCategory, palabras.join(' ')],
  )
  const hayFiltro = activeCategory !== TODOS || palabras.length > 0

  // Llevar la lista hasta la fórmula resaltada y quitarle la marca después de un rato
  useEffect(() => {
    if (!resaltada) return
    const raf = requestAnimationFrame(() => {
      document.querySelector(`[data-template-id="${resaltada.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const timer = setTimeout(() => setResaltada(null), 4500)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [resaltada])

  function handleDelete(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  function handleSaved(saved: Template) {
    const nueva = !templates.some((t) => t.id === saved.id)
    setTemplates((prev) =>
      nueva ? [...prev, saved] : prev.map((t) => (t.id === saved.id ? saved : t)),
    )
    setEditing(undefined)
    // Si el rubro elegido o la búsqueda la esconden, se limpian: tiene que quedar a la vista
    if (activeCategory !== TODOS && saved.categoria !== activeCategory) setActiveCategory(TODOS)
    if (palabras.length > 0 && !tieneTodas(palabras, saved.codigo, saved.nombre, saved.categoria, saved.descripcion)) setQ('')
    setResaltada({ id: saved.id, texto: nueva ? 'Fórmula creada' : 'Cambios guardados' })
  }

  const nuevaFormula = (ancho = false) =>
    puedeEditar ? (
      <button
        onClick={() => setEditing(null)}
        className={`bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-2 rounded-xl text-sm flex items-center justify-center gap-1.5 shadow-sm transition-colors ${
          ancho ? 'w-full sm:w-auto' : ''
        }`}
      >
        <Plus size={16} /> Nueva fórmula
      </button>
    ) : null

  return (
    <div className="px-6 pb-6 fade-in">
      {/* Cabecera fija: título, cuántas hay, el botón para crear y el buscador siempre a la vista */}
      <div
        data-testid="cabecera-formulas"
        className="sticky top-0 z-20 -mx-6 px-6 pt-5 pb-3 bg-[#F5F6F8] border-b border-gray-200/80 shadow-[0_6px_12px_-10px_rgba(0,0,0,0.15)]"
      >
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
            <Library size={14} /> CONFIGURACIÓN
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-x-3 gap-y-1 min-w-0 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-1 h-7 bg-[#2D8D68] rounded-full flex-shrink-0" />
                <h1 className="text-xl font-extrabold text-gray-900">FÓRMULAS</h1>
              </div>
              {!loading && !error && (
                <span className="bg-[#E8F5EE] text-[#1B5E4B] text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap">
                  {templates.length} {templates.length === 1 ? 'fórmula' : 'fórmulas'}
                </span>
              )}
            </div>
            {nuevaFormula(true)}
          </div>
          <p className="hidden sm:block text-sm text-gray-500 mt-1 pl-4">
            Qué materiales y cuánta mano de obra lleva una unidad de cada trabajo. Salen del Maestro y se pueden corregir acá.
          </p>

          {/* Buscador */}
          <div className="mt-3 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm focus-within:border-[#2D8D68] focus-within:ring-2 focus-within:ring-[#2D8D68]/20">
            <Search size={15} className="text-gray-400 flex-shrink-0" />
            <input
              ref={buscadorRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }}
              placeholder="Buscá una fórmula: nombre, rubro o número (ej. 6.11)"
              aria-label="Buscá una fórmula: nombre, rubro o número"
              className="flex-1 min-w-0 text-sm outline-none bg-transparent [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                onClick={() => { setQ(''); buscadorRef.current?.focus() }}
                aria-label="Borrar la búsqueda"
                className="text-gray-400 hover:text-gray-700 p-0.5 rounded"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl pt-4">
        <AvisoCorrecciones />

        {/* Rubros */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Rubro">
            {[TODOS, ...categories].map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                aria-pressed={activeCategory === cat}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#2D8D68] text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-[#2D8D68] hover:text-[#2D8D68]'
                }`}
              >
                {cat === TODOS ? 'Todos los rubros' : conTildes(cat)}
              </button>
            ))}
          </div>
        )}

        {/* Cuántas se ven */}
        {!loading && !error && templates.length > 0 && (
          <p className="text-xs text-gray-500 mb-3" data-testid="contador-formulas" aria-live="polite">
            {hayFiltro
              ? `${visibles.length} de ${templates.length} ${templates.length === 1 ? 'fórmula' : 'fórmulas'}`
              : `${templates.length} ${templates.length === 1 ? 'fórmula' : 'fórmulas'}`}
            {activeCategory !== TODOS && <span className="text-gray-400"> · en {conTildes(activeCategory)}</span>}
          </p>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Cargando fórmulas...
          </div>
        )}

        {/* Error */}
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
            <p className="font-semibold mb-1">No pude traer las fórmulas</p>
            <p className="text-xs">{error}</p>
            <button
              onClick={() => setIntento((n) => n + 1)}
              className="mt-2 text-xs font-semibold bg-white border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100"
            >
              Probar de nuevo
            </button>
          </div>
        )}

        <div className="space-y-3">
          {/* Sin ninguna fórmula cargada */}
          {!loading && !error && templates.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-500">
              <Library size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-700">No hay fórmulas cargadas.</p>
              <p className="text-xs mt-1 mb-4">
                {puedeEditar ? 'Creá la primera: qué materiales y cuánta mano de obra lleva una unidad del trabajo.' : 'Las carga quien edita.'}
              </p>
              <div className="flex justify-center">{nuevaFormula()}</div>
            </div>
          )}

          {/* Hay fórmulas, pero el filtro no deja ninguna */}
          {!loading && !error && templates.length > 0 && visibles.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-500" data-testid="sin-resultados">
              <Search size={28} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-700">
                {palabras.length > 0
                  ? <>Ninguna fórmula dice «{q.trim()}»{activeCategory !== TODOS ? <> en {conTildes(activeCategory)}</> : null}.</>
                  : <>No hay fórmulas en {conTildes(activeCategory)}.</>}
              </p>
              <p className="text-xs mt-1 mb-4">
                {puedeEditar ? 'Probá con otra palabra o creá una nueva.' : 'Probá con otra palabra.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {nuevaFormula()}
                {activeCategory !== TODOS && palabras.length > 0 && (
                  <button
                    onClick={() => setActiveCategory(TODOS)}
                    className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium px-4 py-2 rounded-xl text-sm"
                  >
                    Buscar en todos los rubros
                  </button>
                )}
                {palabras.length > 0 && (
                  <button
                    onClick={() => { setQ(''); buscadorRef.current?.focus() }}
                    className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium px-4 py-2 rounded-xl text-sm"
                  >
                    Borrar la búsqueda
                  </button>
                )}
              </div>
            </div>
          )}

          {visibles.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onDelete={handleDelete}
              onEdit={setEditing}
              resaltado={resaltada?.id === t.id ? resaltada.texto : null}
            />
          ))}
        </div>
      </div>

      {editing !== undefined && puedeEditar && (
        <TemplateEditor
          template={editing}
          categoriaInicial={editing === null && activeCategory !== TODOS ? activeCategory : undefined}
          onSaved={handleSaved}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
