import { useEffect, useRef, useState } from 'react'
import {
  BookOpen, Check, ChevronDown, ChevronRight, FileSpreadsheet, Pencil, Plus,
  Search, Trash2, Upload, X, Zap,
} from 'lucide-react'
import { budgetApi, catalogApi } from '../lib/api'
import { fmtCurrency, fmtDate, todayIso } from '../lib/format'
import type { Budget, CatalogEntry, PriceCatalog } from '../types'

// ─── Inline CSV upload form ────────────────────────────────────────────────────

function UploadForm({ onSuccess, onCancel }: { onSuccess: (catalog: PriceCatalog) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [tipo, setTipo] = useState('material')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    if (!file || !name.trim()) return
    setUploading(true)
    setError(null)
    try {
      const catalog = await catalogApi.uploadCsv(file, name.trim(), tipo)
      onSuccess(catalog)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo CSV')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#2D8D68] p-4 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Upload size={14} className="text-[#2D8D68]" />
        <span className="text-sm font-semibold text-gray-800">Nuevo catálogo por CSV</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1 font-medium">Nombre del catálogo *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Materiales 2024"
            className="w-full text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2D8D68]"
          />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1 font-medium">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="w-full text-xs border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2D8D68]"
          >
            <option value="material">Material</option>
            <option value="mano_obra">Mano de obra</option>
            <option value="equipo">Equipo</option>
            <option value="subcontrato">Subcontrato</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1 font-medium">Archivo CSV *</label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#2D8D68] file:mr-2 file:text-xs file:border-0 file:bg-[#E8F5EE] file:text-[#1B5E4B] file:px-2 file:py-1 file:rounded"
          />
        </div>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleUpload}
          disabled={!file || !name.trim() || uploading}
          className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {uploading ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Subiendo...
            </>
          ) : (
            <><Upload size={12} /> Subir CSV</>
          )}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-4 py-2 rounded-lg border text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ─── Inline Excel upload form ─────────────────────────────────────────────────

function ExcelUploadForm({ onSuccess, onCancel }: { onSuccess: (count: number) => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ catalogs_created: number; entries: Record<string, number>; warnings: string[] } | null>(null)

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const res = await catalogApi.uploadExcel(file)
      setResult(res)
      onSuccess(res.catalogs_created)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo Excel')
    } finally {
      setUploading(false)
    }
  }

  const TIPO_LABEL: Record<string, string> = {
    material: 'Material',
    mano_obra: 'Mano de obra',
    equipo: 'Equipo',
    subcontrato: 'Subcontrato',
  }

  return (
    <div className="bg-white rounded-xl border border-[#2D8D68] p-4 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Upload size={14} className="text-[#2D8D68]" />
        <span className="text-sm font-semibold text-gray-800">Subir Excel con múltiples solapas</span>
        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">.xlsx</span>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">
        El archivo debe tener solapas llamadas: <strong>Materiales</strong>, <strong>Mano de obra</strong>, <strong>Equipos</strong>, <strong>Subcontratos</strong> (o variantes como Mat, MO, Eq, Sub).
        Cada solapa crea un catálogo separado.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-[11px] text-gray-500 mb-1 font-medium">Archivo Excel *</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
            className="w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#2D8D68] file:mr-2 file:text-xs file:border-0 file:bg-[#E8F5EE] file:text-[#1B5E4B] file:px-2 file:py-1 file:rounded"
          />
        </div>
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
        >
          {uploading ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Subiendo...
            </>
          ) : (
            <><Upload size={12} /> Subir Excel</>
          )}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-4 py-2 rounded-lg border text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          Cancelar
        </button>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
      {result && (
        <div className="mt-3 bg-[#E8F5EE] border border-green-200 rounded-lg px-3 py-2">
          <div className="text-xs font-semibold text-[#143D34] mb-1">
            {result.catalogs_created} catálogo{result.catalogs_created !== 1 ? 's' : ''} creado{result.catalogs_created !== 1 ? 's' : ''}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {Object.entries(result.entries).map(([tipo, count]) => (
              <span key={tipo} className="bg-white border border-green-200 text-[#1B5E4B] px-2 py-0.5 rounded">
                {TIPO_LABEL[tipo] ?? tipo}: {count} entradas
              </span>
            ))}
          </div>
          {result.warnings.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-700">
              {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Add-entry inline row ──────────────────────────────────────────────────────

function AddEntryRow({
  catalogId,
  onSaved,
  onCancel,
}: {
  catalogId: string
  onSaved: (entry: CatalogEntry) => void
  onCancel: () => void
}) {
  const [codigo, setCodigo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [unidad, setUnidad] = useState('')
  const [precio, setPrecio] = useState('')
  const [fecha, setFecha] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!descripcion.trim()) return
    setSaving(true)
    setError(null)
    try {
      const entry = await catalogApi.createEntry(catalogId, {
        codigo: codigo.trim(),
        descripcion: descripcion.trim(),
        unidad: unidad.trim() || undefined,
        precio_sin_iva: parseFloat(precio) || 0,
        fecha_precio: fecha || undefined,
      })
      onSaved(entry)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr className="bg-[#E8F5EE]/30 border-b">
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="COD"
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68] font-mono"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Descripción *"
            autoFocus
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            placeholder="m2"
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]"
          />
        </td>
        <td className="px-3 py-1.5" colSpan={2}>
          <input
            type="number"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="Precio"
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68] text-right"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            title="Fecha del precio"
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]"
          />
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={!descripcion.trim() || saving}
              className="text-[#2D8D68] hover:text-[#1B5E4B] disabled:opacity-40"
              title="Guardar"
            >
              {saving
                ? <div className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                : <Check size={13} />}
            </button>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" title="Cancelar">
              <X size={13} />
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 pb-1 text-[10px] text-red-600">{error}</td>
        </tr>
      )}
    </>
  )
}

// ─── Edit-entry inline row ─────────────────────────────────────────────────────

function EditEntryRow({
  entry,
  catalogId,
  onSaved,
  onCancel,
}: {
  entry: CatalogEntry
  catalogId: string
  onSaved: (updated: CatalogEntry) => void
  onCancel: () => void
}) {
  const [codigo, setCodigo] = useState(entry.codigo ?? '')
  const [descripcion, setDescripcion] = useState(entry.descripcion ?? '')
  const [unidad, setUnidad] = useState(entry.unidad ?? '')
  const [precio, setPrecio] = useState(String(entry.precio_sin_iva ?? ''))
  const [fecha, setFecha] = useState(entry.fecha_precio?.slice(0, 10) ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const nuevoPrecio = parseFloat(precio) || 0
      const cambioPrecio = nuevoPrecio !== (entry.precio_sin_iva ?? 0)
      const updated = await catalogApi.updateEntry(catalogId, entry.id, {
        codigo: codigo.trim(),
        descripcion: descripcion.trim(),
        unidad: unidad.trim() || null,
        precio_sin_iva: nuevoPrecio,
        // If the price changed and the date was left as is, the backend dates it today
        ...(cambioPrecio && fecha === (entry.fecha_precio?.slice(0, 10) ?? '')
          ? {}
          : { fecha_precio: fecha || null }),
      })
      onSaved(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr className="bg-amber-50 border-b">
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68] font-mono"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            autoFocus
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="text"
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]"
          />
        </td>
        <td className="px-3 py-1.5 text-right text-[11px] text-gray-400">—</td>
        <td className="px-3 py-1.5">
          <input
            type="number"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68] text-right"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            title="Fecha del precio"
            className="w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]"
          />
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[#2D8D68] hover:text-[#1B5E4B] disabled:opacity-40"
              title="Guardar"
            >
              {saving
                ? <div className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                : <Check size={13} />}
            </button>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" title="Cancelar">
              <X size={13} />
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 pb-1 text-[10px] text-red-600">{error}</td>
        </tr>
      )}
    </>
  )
}

// ─── CatalogRow ────────────────────────────────────────────────────────────────

function CatalogRow({
  catalog,
  budgets,
  onDeleted,
  onChanged,
}: {
  catalog: PriceCatalog
  budgets: Budget[]
  onDeleted: (id: string) => void
  onChanged: (catalog: PriceCatalog) => void
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [filtered, setFiltered] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string } | null>(null)
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>('')
  const [searchQ, setSearchQ] = useState('')
  const [deletingCatalog, setDeletingCatalog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [addingEntry, setAddingEntry] = useState(false)
  const [changingOficial, setChangingOficial] = useState(false)
  const [oficialError, setOficialError] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function toggle() {
    setOpen((prev) => !prev)
    if (!open && entries.length === 0) {
      setLoading(true)
      catalogApi
        .getEntries(catalog.id)
        .then((data) => {
          setEntries(data)
          setFiltered(data)
        })
        .catch(() => {/* ignore */})
        .finally(() => setLoading(false))
    }
  }

  async function handleToggleOficial() {
    setChangingOficial(true)
    setOficialError(null)
    try {
      const updated = await catalogApi.setOficial(catalog.id, !catalog.oficial)
      onChanged({ ...catalog, ...updated, oficial: !!updated.oficial })
    } catch {
      setOficialError('No se pudo cambiar. Probá de nuevo.')
    } finally {
      setChangingOficial(false)
    }
  }

  function handleSearch(q: string) {
    setSearchQ(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) {
      setFiltered(entries)
      return
    }
    searchTimer.current = setTimeout(() => {
      catalogApi
        .search(catalog.id, q)
        .then(setFiltered)
        .catch(() => {
          const lower = q.toLowerCase()
          setFiltered(entries.filter((e) => e.descripcion?.toLowerCase().includes(lower) || e.codigo?.toLowerCase().includes(lower)))
        })
    }, 300)
  }

  async function handleDeleteCatalog() {
    if (!confirm(`¿Eliminar catálogo "${catalog.name}"? Esta acción no se puede deshacer.`)) return
    setDeletingCatalog(true)
    try {
      await catalogApi.deleteCatalog(catalog.id)
      onDeleted(catalog.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error eliminando catálogo')
    } finally {
      setDeletingCatalog(false)
    }
  }

  async function handleDeleteEntry(entryId: string) {
    if (!confirm('¿Eliminar esta entrada?')) return
    setDeletingId(entryId)
    try {
      await catalogApi.deleteEntry(catalog.id, entryId)
      const next = entries.filter((e) => e.id !== entryId)
      setEntries(next)
      setFiltered(next.filter((e) => !searchQ.trim() || e.descripcion?.toLowerCase().includes(searchQ.toLowerCase())))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error eliminando entrada')
    } finally {
      setDeletingId(null)
    }
  }

  function handleEntrySaved(updated: CatalogEntry) {
    const next = entries.map((e) => (e.id === updated.id ? updated : e))
    setEntries(next)
    setFiltered(searchQ.trim() ? next.filter((e) => e.descripcion?.toLowerCase().includes(searchQ.toLowerCase())) : next)
    setEditingId(null)
  }

  function handleEntryAdded(entry: CatalogEntry) {
    const next = [...entries, entry]
    setEntries(next)
    setFiltered(searchQ.trim() ? next.filter((e) => e.descripcion?.toLowerCase().includes(searchQ.toLowerCase())) : next)
    setAddingEntry(false)
  }

  async function handleApply() {
    if (!selectedBudgetId) return
    setApplying(true)
    setApplyResult(null)
    try {
      const result = await catalogApi.apply(selectedBudgetId, catalog.id)
      setApplyResult({
        success: true,
        message: `Catálogo aplicado: ${result.items_matched} recursos actualizados, ${result.items_unmatched} sin coincidencia`,
      })
      setTimeout(() => setApplyResult(null), 5000)
    } catch (err) {
      setApplyResult({ success: false, message: err instanceof Error ? err.message : 'Error al aplicar catálogo' })
      setTimeout(() => setApplyResult(null), 5000)
    } finally {
      setApplying(false)
    }
  }

  const TIPO_LABEL: Record<string, string> = {
    material: 'Material',
    mano_obra: 'Mano de obra',
    equipo: 'Equipo',
    subcontrato: 'Subcontrato',
  }
  const catalogTipo = catalog.tipo

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors" onClick={toggle}>
        <div>
          <div className="font-semibold text-sm text-gray-900 flex items-center gap-2">
            {catalog.name}
            {catalogTipo && (
              <span className="bg-[#E8F5EE] text-[#1B5E4B] text-[10px] px-1.5 py-0.5 rounded-full border border-green-200 font-normal">
                {TIPO_LABEL[catalogTipo] ?? catalogTipo}
              </span>
            )}
            {catalog.source_file && (
              <span className="bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0.5 rounded border border-orange-200 font-normal">
                {catalog.source_file}
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            Creado: {new Date(catalog.created_at).toLocaleDateString('es-AR')}
            {entries.length > 0 && <> · {entries.length} entradas</>}
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {oficialError && <span className="text-[10px] text-red-600">{oficialError}</span>}
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              catalog.oficial ? 'bg-[#E8F5EE] text-[#1B5E4B]' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {catalog.oficial ? 'Oficial' : 'Solo consulta'}
          </span>
          <button
            onClick={handleToggleOficial}
            disabled={changingOficial}
            className="bg-white border text-gray-700 text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {catalog.oficial ? 'Dejar solo para consulta' : 'Marcar como oficial'}
          </button>
          <button
            onClick={handleDeleteCatalog}
            disabled={deletingCatalog}
            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
            title="Eliminar catálogo"
          >
            {deletingCatalog
              ? <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
              : <Trash2 size={14} />}
          </button>
          <div onClick={toggle}>
            {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t fade-in">
          {loading ? (
            <div className="p-4 text-xs text-gray-400 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
              Cargando entradas...
            </div>
          ) : (
            <>
              {/* Search bar */}
              <div className="px-3 py-2 border-b bg-gray-50">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQ}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Buscar por código o descripción..."
                    className="w-full text-[11px] border rounded-lg pl-7 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#2D8D68] bg-white"
                  />
                  {searchQ && (
                    <button
                      onClick={() => handleSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Entries table */}
              {filtered.length > 0 || addingEntry ? (
                <>
                  <table className="w-full text-[11px]">
                    <thead className="bg-[#E8F5EE] text-[#143D34]">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium w-24">Código</th>
                        <th className="px-3 py-1.5 text-left font-medium">Descripción</th>
                        <th className="px-3 py-1.5 text-left font-medium w-16">Unidad</th>
                        <th className="px-3 py-1.5 text-right font-medium w-28">P. con IVA</th>
                        <th className="px-3 py-1.5 text-right font-medium w-28">P. sin IVA</th>
                        <th className="px-3 py-1.5 text-left font-medium w-28">Fecha</th>
                        <th className="px-3 py-1.5 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((e, idx) =>
                        editingId === e.id ? (
                          <EditEntryRow
                            key={e.id}
                            entry={e}
                            catalogId={catalog.id}
                            onSaved={handleEntrySaved}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <tr
                            key={e.id}
                            className={`border-b hover:bg-[#E8F5EE]/40 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-50/50'}`}
                          >
                            <td className="px-3 py-1.5 font-mono text-gray-400">{e.codigo}</td>
                            <td className="px-3 py-1.5 text-gray-800">{e.descripcion}</td>
                            <td className="px-3 py-1.5 text-gray-500">{e.unidad}</td>
                            <td className="px-3 py-1.5 text-right">{e.precio_con_iva ? fmtCurrency(e.precio_con_iva) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-medium">{e.precio_sin_iva ? fmtCurrency(e.precio_sin_iva) : '—'}</td>
                            <td
                              className={`px-3 py-1.5 ${e.fecha_precio ? 'text-gray-500' : 'text-amber-600'}`}
                              title={e.fecha_precio ? (e.proveedor ? `Proveedor: ${e.proveedor}` : undefined) : 'Precio sin fecha'}
                            >
                              {fmtDate(e.fecha_precio)}
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1 justify-end">
                                <button
                                  onClick={() => setEditingId(e.id)}
                                  className="p-1 rounded text-gray-400 hover:text-[#2D8D68] hover:bg-[#E8F5EE] transition-colors"
                                  title="Editar"
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  onClick={() => handleDeleteEntry(e.id)}
                                  disabled={deletingId === e.id}
                                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                                  title="Eliminar"
                                >
                                  {deletingId === e.id
                                    ? <div className="w-2.5 h-2.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                    : <Trash2 size={11} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      )}
                      {addingEntry && (
                        <AddEntryRow
                          catalogId={catalog.id}
                          onSaved={handleEntryAdded}
                          onCancel={() => setAddingEntry(false)}
                        />
                      )}
                    </tbody>
                  </table>
                  {/* Footer */}
                  <div className="px-3 py-2 bg-[#E8F5EE]/50 text-[10px] text-gray-500 border-t flex items-center justify-between">
                    <span>
                      {searchQ
                        ? `${filtered.length} resultado(s) de ${entries.length} entradas`
                        : `${entries.length} entradas`}
                    </span>
                    {!addingEntry && (
                      <button
                        onClick={() => setAddingEntry(true)}
                        className="flex items-center gap-1 text-[#2D8D68] hover:text-[#1B5E4B] font-semibold text-[11px]"
                      >
                        <Plus size={11} /> Agregar entrada
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-4 text-xs text-gray-400 italic flex items-center justify-between">
                  <span>{searchQ ? 'Sin resultados para la búsqueda.' : 'Sin entradas para este catálogo.'}</span>
                  {!searchQ && !addingEntry && (
                    <button
                      onClick={() => setAddingEntry(true)}
                      className="flex items-center gap-1 text-[#2D8D68] hover:text-[#1B5E4B] font-semibold text-[11px]"
                    >
                      <Plus size={11} /> Agregar entrada
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Apply to budget */}
          <div className="border-t p-4 bg-[#E8F5EE]/50">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-[#2D8D68]" />
              <span className="text-xs font-semibold text-gray-700">Aplicar a presupuesto</span>
            </div>
            {budgets.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={selectedBudgetId}
                  onChange={(e) => setSelectedBudgetId(e.target.value)}
                  className="flex-1 text-xs border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2D8D68] focus:border-transparent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">Seleccionar presupuesto...</option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button
                  onClick={(e) => { e.stopPropagation(); handleApply() }}
                  disabled={!selectedBudgetId || applying}
                  className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {applying ? (
                    <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Aplicando...</>
                  ) : (
                    <><Zap size={12} /> Aplicar</>
                  )}
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No hay presupuestos disponibles. Crea uno primero.</p>
            )}
            {applyResult && (
              <div className={`mt-2 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 ${
                applyResult.success
                  ? 'bg-[#E8F5EE] text-[#166534] border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {applyResult.success && <Check size={12} />}
                {applyResult.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Catalogs() {
  const [catalogs, setCatalogs] = useState<PriceCatalog[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showExcelUpload, setShowExcelUpload] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([catalogApi.list(), budgetApi.list()])
      .then(([cats, buds]) => {
        setCatalogs(cats)
        setBudgets(buds)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Error al cargar catálogos')
      })
      .finally(() => setLoading(false))
  }, [])

  function handleUploaded(catalog: PriceCatalog) {
    setCatalogs((prev) => [catalog, ...prev])
    setShowUpload(false)
  }

  function handleExcelUploaded(_count: number) {
    // Reload the full catalog list so all newly created catalogs appear
    catalogApi.list()
      .then((cats) => setCatalogs(cats))
      .catch(() => {/* ignore */})
    setShowExcelUpload(false)
  }

  function handleDeleted(id: string) {
    setCatalogs((prev) => prev.filter((c) => c.id !== id))
  }

  function handleChanged(catalog: PriceCatalog) {
    setCatalogs((prev) => prev.map((c) => (c.id === catalog.id ? catalog : c)))
  }

  const hayOficial = catalogs.some((c) => c.oficial)

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <BookOpen size={14} /> GESTIÓN DE PRECIOS
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">CATÁLOGOS DE PRECIOS</h1>
        <span className="bg-[#E8F5EE] text-[#1B5E4B] text-xs font-medium px-2 py-0.5 rounded-full">
          {catalogs.length} catálogo{catalogs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-2 mb-4 max-w-3xl">
        <button
          onClick={() => { setShowUpload((prev) => !prev); setShowExcelUpload(false) }}
          className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg transition-colors ${
            showUpload
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-[#2D8D68] hover:bg-[#1B5E4B] text-white'
          }`}
        >
          {showUpload ? <X size={13} /> : <Plus size={13} />}
          {showUpload ? 'Cancelar' : 'Nuevo catálogo (CSV)'}
        </button>
        <button
          onClick={() => { setShowExcelUpload((prev) => !prev); setShowUpload(false) }}
          className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border transition-colors ${
            showExcelUpload
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'
              : 'border-[#2D8D68] text-[#2D8D68] hover:bg-[#E8F5EE]'
          }`}
        >
          {showExcelUpload ? <X size={13} /> : <FileSpreadsheet size={13} />}
          {showExcelUpload ? 'Cancelar' : 'Subir Excel (4 solapas)'}
        </button>
      </div>

      <div className="max-w-3xl space-y-3">
        {/* Upload forms */}
        {showUpload && (
          <UploadForm onSuccess={handleUploaded} onCancel={() => setShowUpload(false)} />
        )}
        {showExcelUpload && (
          <ExcelUploadForm onSuccess={handleExcelUploaded} onCancel={() => setShowExcelUpload(false)} />
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Cargando catálogos...
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <p className="font-semibold mb-1">Error al cargar catálogos</p>
            <p className="text-xs">{error}</p>
          </div>
        )}

        {!loading && catalogs.length > 0 && !error && (
          hayOficial ? (
            <div className="bg-[#E8F5EE] border border-green-200 rounded-xl px-4 py-3 text-xs text-[#143D34]">
              La app calcula con los catálogos oficiales. Los demás son solo para consultar.
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
              Ningún catálogo es oficial: la app toma el precio más nuevo entre todos. Marcá como oficial el que mantenés; los otros quedan para consultar.
            </div>
          )
        )}

        {!loading && catalogs.length === 0 && !error && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-400">
            <BookOpen size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No hay catálogos de precios todavía.</p>
            <p className="text-xs mt-1">Sube un CSV para crear tu primer catálogo.</p>
          </div>
        )}

        {catalogs.map((c) => (
          <CatalogRow key={c.id} catalog={c} budgets={budgets} onDeleted={handleDeleted} onChanged={handleChanged} />
        ))}
      </div>
    </div>
  )
}
