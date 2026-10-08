import { Fragment, useEffect, useId, useRef, useState } from 'react'
import {
  AlertTriangle, BookOpen, Check, CheckCircle, ChevronDown, ChevronRight, Download, FileSpreadsheet, History, Pencil, Plus,
  Search, Trash2, Upload, X, Zap,
} from 'lucide-react'
import { budgetApi, catalogApi, mensajeDeError, textoDeError } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { fmtCurrency, fmtDate, fmtPesos, todayIso } from '../lib/format'
import BuscarPrecio, { EstadoBuscadorChip, IconoBuscarInternet } from '../components/BuscarPrecio'
import type { PrecioGuardado } from '../components/BuscarPrecio'
import OrigenPrecio from '../components/OrigenPrecio'
import type { Budget, CatalogEntry, CatalogPriceHistory, PriceCatalog } from '../types'

// ─── Subir una lista desde un archivo (.csv) ───────────────────────────────────

/** El .csv de ejemplo: como lo guarda el Excel en castellano (";" y precios con coma), con la marca UTF-8 para las tildes. */
function csvDeEjemplo(): string {
  const [a, m, d] = todayIso().split('-')
  const hoy = `${d}/${m}/${a}`
  return '\uFEFF' + [
    'código;descripción;unidad;precio_unitario;fecha;proveedor',
    `M-CEM50;Cemento Portland x 50 kg;bolsa;12.450,00;${hoy};Corralón de ejemplo`,
    `M-ARENA;Arena gruesa a granel;m3;38.900,50;${hoy};Corralón de ejemplo`,
  ].join('\r\n') + '\r\n'
}

function bajarEjemplo() {
  const url = URL.createObjectURL(new Blob([csvDeEjemplo()], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'ejemplo-lista-de-precios.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** El nombre que se propone para la lista: el del archivo, sin ".csv". */
const nombreDeArchivo = (f: File) => f.name.replace(/\.(csv|txt)$/i, '').trim()

/** Una lista recién subida, para el aviso de arriba. */
interface CsvSubido {
  id: string
  nombre: string
  entradas: number
  salteadas: number
  warnings: string[]
}

function UploadForm({ onSuccess, onCancel }: { onSuccess: (r: CsvSubido) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [tipo, setTipo] = useState('material')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El nombre que se propuso desde el archivo: si Sol no lo cambió, elegir otro archivo lo reemplaza
  const propuesto = useRef('')
  const ayudaId = useId()

  function elegirArchivo(f: File | null) {
    setFile(f)
    setError(null)
    if (f && (!name.trim() || name === propuesto.current)) {
      propuesto.current = nombreDeArchivo(f)
      setName(propuesto.current)
    }
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const res = await catalogApi.uploadCsv(file, { nombre: name.trim() || undefined, tipo })
      const id = res.catalog_id ?? res.id ?? ''
      onSuccess({
        id,
        nombre: res.name || name.trim() || nombreDeArchivo(file),
        entradas: res.entradas ?? res.entries_count ?? 0,
        salteadas: res.salteadas ?? 0,
        warnings: Array.isArray(res.warnings) ? res.warnings : [],
      })
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo subir el archivo. Probá de nuevo.'))
    } finally {
      setUploading(false)
    }
  }

  const campo = 'w-full max-md:min-h-10 text-xs border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2D8D68]'
  const etiqueta = 'block text-[11px] text-gray-500 mb-1 font-medium'

  return (
    <div className="bg-white rounded-xl border border-[#2D8D68] p-4 mb-4 shadow-sm" data-testid="subir-csv">
      <div className="flex items-center gap-2 mb-2">
        <Upload size={14} className="text-[#2D8D68] flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-800">Lista de precios nueva, desde un archivo (.csv)</span>
      </div>

      <div id={ayudaId} className="rounded-lg bg-[#F3FAF6] border border-[#C3E5D3] px-3 py-2.5 mb-3 text-[11px] text-gray-700 leading-relaxed" data-testid="columnas-csv">
        <p>
          El archivo necesita una columna de <strong>código</strong> y una de <strong>precio sin IVA</strong>. Puede traer
          también <strong>descripción</strong>, <strong>unidad</strong>, <strong>fecha</strong> y <strong>proveedor</strong>.
        </p>
        <p className="mt-1 text-gray-600">
          Los nombres de las columnas van con o sin tilde, en mayúsculas o minúsculas (el precio puede llamarse «precio»,
          «precio unitario» o «precio sin IVA»). Sirve el .csv que guarda el Excel, separado con «;» o con «,», y los
          precios escritos como «$ 1.234,50».
        </p>
        <button
          type="button"
          onClick={bajarEjemplo}
          className="mt-2 max-md:min-h-10 inline-flex items-center gap-1.5 bg-white border border-[#2D8D68]/50 text-[#1B5E4B] hover:bg-[#E8F5EE] font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          <Download size={12} /> Bajar un ejemplo (.csv)
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        <label className="min-w-0">
          <span className={etiqueta}>Archivo (.csv) *</span>
          <input
            type="file"
            accept=".csv,text/csv,.txt"
            aria-describedby={ayudaId}
            onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            className="w-full min-w-0 text-xs border rounded-lg px-2 py-1.5 max-md:min-h-10 focus:outline-none focus:ring-2 focus:ring-[#2D8D68] file:mr-2 file:text-xs file:border-0 file:bg-[#E8F5EE] file:text-[#1B5E4B] file:px-2 file:py-1 file:rounded"
          />
        </label>
        <label className="min-w-0">
          <span className={etiqueta}>Nombre de la lista (opcional)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Si lo dejás vacío, va el del archivo"
            className={campo}
          />
        </label>
        <label className="min-w-0">
          <span className={etiqueta}>Qué precios trae</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
            <option value="material">Materiales</option>
            <option value="mano_obra">Mano de obra</option>
            <option value="equipo">Equipos</option>
            <option value="subcontrato">Subcontratos</option>
          </select>
        </label>
      </div>
      {error && (
        <div role="alert" data-testid="error-csv" className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
          <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{error}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="max-md:min-h-10 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {uploading ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Subiendo…
            </>
          ) : (
            <><Upload size={12} /> Subir el archivo</>
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={uploading}
          className="max-md:min-h-10 text-xs px-4 py-2 rounded-lg border text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Lo que dejó la subida de un .csv: cuántos precios, cuántos renglones no entraron y el paso que falta (oficial). */
function AvisoCsvSubido({
  subido, catalog, onOficial, onClose,
}: {
  subido: CsvSubido
  catalog: PriceCatalog | undefined
  onOficial: (c: PriceCatalog) => void
  onClose: () => void
}) {
  const { esAdmin } = useAuth()
  const [marcando, setMarcando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verAvisos, setVerAvisos] = useState(false)
  const oficial = !!catalog?.oficial

  async function marcarOficial() {
    if (!catalog) return
    setMarcando(true)
    setError(null)
    try {
      const updated = await catalogApi.setOficial(catalog.id, true)
      onOficial({ ...catalog, ...updated, oficial: true })
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo marcar como oficial. Probá de nuevo.'))
    } finally {
      setMarcando(false)
    }
  }

  const n = subido.entradas
  const s = subido.salteadas
  // El servidor ya explica los renglones que no entraron ("3 renglones sin código o sin precio, no se cargaron
  // (renglones 4, 7 y 9)"): esos avisos van primero y no se repite la cuenta
  const avisos = [...subido.warnings].sort((a, b) => Number(/no se carg/.test(b)) - Number(/no se carg/.test(a)))
  const explicadas = avisos.some((w) => /no se carg/.test(w))
  const AVISOS_A_LA_VISTA = 4

  return (
    <div role="status" data-testid="csv-subido" className="flex items-start gap-2 rounded-xl border border-[#2D8D68]/30 bg-[#E8F5EE] px-3 py-2.5 text-xs text-[#143D34]">
      <CheckCircle size={15} className="flex-shrink-0 mt-px text-[#2D8D68]" />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="font-semibold" data-testid="csv-subido-titulo">
          {/* La última letra va pegada a "»." para que el punto no quede solo en un renglón */}
          Se {n === 1 ? 'cargó 1 precio' : `cargaron ${n.toLocaleString('es-AR')} precios`} en «{subido.nombre.slice(0, -1)}
          <span className="whitespace-nowrap">{subido.nombre.slice(-1)}».</span>
        </p>
        {s > 0 && !explicadas && (
          <p className="mt-1 text-amber-800" data-testid="csv-salteadas">
            {s === 1 ? '1 renglón sin código o sin precio, no se cargó.' : `${s.toLocaleString('es-AR')} renglones sin código o sin precio, no se cargaron.`}
          </p>
        )}
        {avisos.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-amber-800" data-testid="csv-avisos">
            {(verAvisos ? avisos : avisos.slice(0, AVISOS_A_LA_VISTA)).map((w, i) => <li key={i}>{w}</li>)}
            {avisos.length > AVISOS_A_LA_VISTA && (
              <li>
                <button onClick={() => setVerAvisos((v) => !v)} className="max-md:min-h-10 font-semibold underline underline-offset-2">
                  {verAvisos ? 'Ver menos' : `Ver ${avisos.length - AVISOS_A_LA_VISTA} avisos más`}
                </button>
              </li>
            )}
          </ul>
        )}
        {oficial ? (
          <p className="mt-1.5 inline-flex items-center gap-1 font-semibold text-[#1B5E4B]" data-testid="csv-ya-oficial">
            <Check size={13} /> Es la lista oficial: la app calcula con estos precios.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p>Para que la app calcule con esta lista, marcala como oficial.</p>
            {esAdmin && catalog ? (
              <button
                onClick={marcarOficial}
                disabled={marcando}
                className="max-md:min-h-10 inline-flex items-center gap-1 bg-white border border-[#2D8D68]/50 text-[#1B5E4B] hover:bg-white/70 font-semibold px-3 py-1 rounded-lg disabled:opacity-50"
              >
                {marcando && <span className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" aria-hidden />}
                Marcarla como oficial
              </button>
            ) : !esAdmin ? (
              <p className="text-[#1B5E4B]/80">La marca quien administra la app.</p>
            ) : null}
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
      </div>
      <button onClick={onClose} aria-label="Cerrar" className="opacity-60 hover:opacity-100 flex-shrink-0 max-md:min-w-10 max-md:min-h-10 inline-flex items-center justify-center max-md:-mr-2 max-md:-mt-2"><X size={14} /></button>
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
      setError(textoDeError(err, 'No se pudo subir el Excel.'))
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
        Cada solapa crea una lista separada.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
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
            {result.catalogs_created} {result.catalogs_created !== 1 ? 'listas creadas' : 'lista creada'}
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

// ─── Formulario de un renglón (agregar o editar) ───────────────────────────────

// Ancho: una tabla de 7 columnas. Angosto (celular o la lista en poco lugar): descripción y precio, y abajo los botones
const COLUMNAS = 'grid grid-cols-1 @3xs:grid-cols-[minmax(0,1fr)_auto] @xl:grid-cols-[5.5rem_minmax(0,1fr)_3.5rem_5.5rem_5.5rem_5.75rem_7rem]'

function EntryForm({
  entry,
  catalogId,
  onSaved,
  onCancel,
}: {
  // null = renglón nuevo
  entry: CatalogEntry | null
  catalogId: string
  onSaved: (saved: CatalogEntry) => void
  onCancel: () => void
}) {
  const [codigo, setCodigo] = useState(entry?.codigo ?? '')
  const [descripcion, setDescripcion] = useState(entry?.descripcion ?? '')
  const [unidad, setUnidad] = useState(entry?.unidad ?? '')
  const [precio, setPrecio] = useState(entry ? String(entry.precio_sin_iva ?? '') : '')
  const fechaOriginal = entry?.fecha_precio?.slice(0, 10) ?? ''
  const [fecha, setFecha] = useState(entry ? fechaOriginal : todayIso())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!entry && !descripcion.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (!entry) {
        const nuevo = await catalogApi.createEntry(catalogId, {
          codigo: codigo.trim(),
          descripcion: descripcion.trim(),
          unidad: unidad.trim() || undefined,
          precio_sin_iva: parseFloat(precio) || 0,
          fecha_precio: fecha || undefined,
          fuente: 'Cargado a mano',
        })
        onSaved(nuevo)
      } else {
        const nuevoPrecio = parseFloat(precio) || 0
        const cambioPrecio = nuevoPrecio !== (entry.precio_sin_iva ?? 0)
        const updated = await catalogApi.updateEntry(catalogId, entry.id, {
          codigo: codigo.trim(),
          descripcion: descripcion.trim(),
          unidad: unidad.trim() || null,
          precio_sin_iva: nuevoPrecio,
          // If the price changed and the date was left as is, the backend dates it today
          ...(cambioPrecio && fecha === fechaOriginal ? {} : { fecha_precio: fecha || null }),
          // Un precio cambiado a mano ya no sale de donde salía el anterior
          ...(cambioPrecio ? { fuente: 'Cargado a mano', fuente_url: null } : {}),
        })
        onSaved(updated)
      }
    } catch (err) {
      setError(textoDeError(err, 'No se pudo guardar.'))
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full max-md:min-h-10 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#2D8D68]/40 focus:border-[#2D8D68] bg-white'
  const etiqueta = 'block text-[10px] font-medium text-gray-500 mb-0.5'

  return (
    <div className={`border-b px-3 py-2.5 ${entry ? 'bg-amber-50' : 'bg-[#E8F5EE]/40'}`} data-testid="precio-formulario">
      <div>
        <div className="grid grid-cols-2 @xl:grid-cols-[6rem_minmax(0,1fr)_4.5rem_7rem_9rem] gap-2 items-end">
          <label className="min-w-0">
            <span className={etiqueta}>Código</span>
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="COD" className={`${input} font-mono`} />
          </label>
          <label className="min-w-0 col-span-2 @xl:col-span-1 row-start-1 @xl:row-start-auto">
            <span className={etiqueta}>Descripción{entry ? '' : ' *'}</span>
            <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción" autoFocus className={input} />
          </label>
          <label className="min-w-0">
            <span className={etiqueta}>Unidad</span>
            <input type="text" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="m2" className={input} />
          </label>
          <label className="min-w-0">
            <span className={etiqueta}>Precio sin IVA</span>
            <input type="number" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Precio" className={`${input} text-right`} />
          </label>
          <label className="min-w-0">
            <span className={etiqueta}>Fecha del precio</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={(!entry && !descripcion.trim()) || saving}
            className="inline-flex items-center gap-1 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            {saving
              ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
              : <Check size={13} />}
            Guardar
          </button>
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border text-gray-600 hover:bg-gray-50 bg-white">
            Cancelar
          </button>
          {error && <span role="alert" className="text-[11px] text-red-600 [overflow-wrap:anywhere]">{error}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Historial de un precio, con el origen de cada valor ───────────────────────

function HistorialPrecio({ catalogId, entry }: { catalogId: string; entry: CatalogEntry }) {
  const [filas, setFilas] = useState<CatalogPriceHistory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vivo = true
    setError(null)
    catalogApi
      .history(catalogId, entry.id)
      .then((h) => { if (vivo) setFilas(Array.isArray(h) ? h : []) })
      .catch((err) => { if (vivo) setError(textoDeError(err, 'No pude traer el historial.')) })
    return () => { vivo = false }
    // Se vuelve a pedir cuando cambia el precio (un precio nuevo suma un renglón)
  }, [catalogId, entry.id, entry.precio_sin_iva, entry.fecha_precio, intento])

  return (
    <div className="bg-gray-50/80 border-b px-3 py-2" data-testid="historial-precio">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Historial del precio</div>
        {error ? (
          <p role="alert" className="text-[11px] text-red-600">
            {error}{' '}
            <button onClick={() => setIntento((n) => n + 1)} className="font-semibold underline">Probar de nuevo</button>
          </p>
        ) : filas === null ? (
          <p className="text-[11px] text-gray-400">Cargando el historial…</p>
        ) : filas.length === 0 ? (
          <p className="text-[11px] text-gray-400">Todavía no hay cambios de precio guardados.</p>
        ) : (
          <ol className="space-y-1">
            {filas.map((h, i) => (
              <li key={h.id ?? i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                <span className={`tabular-nums font-semibold ${i === 0 ? 'text-gray-900' : 'text-gray-600'}`}>
                  {h.precio_sin_iva === null || h.precio_sin_iva === undefined ? '—' : fmtPesos(h.precio_sin_iva)}
                </span>
                <span className="text-gray-400">{fmtDate(h.fecha_precio)}</span>
                {i === 0 && <span className="text-[9px] font-bold uppercase text-[#1B5E4B] bg-[#E8F5EE] rounded px-1">actual</span>}
                <OrigenPrecio entrada={h} className="basis-full @xl:basis-auto" />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

// ─── CatalogRow ────────────────────────────────────────────────────────────────

/** Un precio recién guardado desde el buscador de arriba: la lista lo muestra y lo marca. */
interface GuardadoEnLista {
  catalogId: string
  entrada: CatalogEntry
  n: number
}

function CatalogRow({
  catalog,
  budgets,
  onDeleted,
  onChanged,
  guardado,
  abrir = 0,
}: {
  catalog: PriceCatalog
  budgets: Budget[]
  onDeleted: (id: string) => void
  onChanged: (catalog: PriceCatalog) => void
  guardado: GuardadoEnLista | null
  // Cambia (>0) cuando hay que abrir esta lista y mostrarla (la recién subida)
  abrir?: number
}) {
  const { puedeEditar, esAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [filtered, setFiltered] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string } | null>(null)
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>('')
  const [searchQ, setSearchQ] = useState('')
  const [confirmarBorrarLista, setConfirmarBorrarLista] = useState(false)
  const [deletingCatalog, setDeletingCatalog] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [entryError, setEntryError] = useState<{ id: string; mensaje: string } | null>(null)
  const [addingEntry, setAddingEntry] = useState(false)
  const [changingOficial, setChangingOficial] = useState(false)
  const [oficialError, setOficialError] = useState<string | null>(null)
  const [historial, setHistorial] = useState<string | null>(null)
  const [buscando, setBuscando] = useState<CatalogEntry | null>(null)
  // Renglón recién guardado: se marca un momento
  const [resaltado, setResaltado] = useState<{ id: string; texto: string } | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pedido = useRef<Promise<CatalogEntry[]> | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  function cargarEntradas(): Promise<CatalogEntry[]> {
    if (!pedido.current) {
      setLoading(true)
      setLoadError(null)
      pedido.current = catalogApi
        .getEntries(catalog.id)
        .then((data) => {
          setEntries(data)
          setFiltered(data)
          return data
        })
        .catch((err) => {
          pedido.current = null
          setLoadError(textoDeError(err, 'No pude traer los precios de esta lista.'))
          return [] as CatalogEntry[]
        })
        .finally(() => setLoading(false))
    }
    return pedido.current
  }

  function toggle() {
    setOpen((prev) => !prev)
    if (!open && entries.length === 0) void cargarEntradas()
  }

  // Lo que se guardó desde "Buscar un precio": abrir esta lista, mostrarlo y marcarlo
  useEffect(() => {
    if (!guardado || guardado.catalogId !== catalog.id) return
    setOpen(true)
    void cargarEntradas().then(() => {
      upsert(guardado.entrada)
      setSearchQ('')
      setResaltado({ id: guardado.entrada.id, texto: 'Precio guardado' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardado?.n])

  // La lista recién subida: se abre con sus precios y se lleva a la vista
  useEffect(() => {
    if (!abrir) return
    setOpen(true)
    setSearchQ('')
    void cargarEntradas()
    const raf = requestAnimationFrame(() => raiz.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir])

  useEffect(() => {
    if (!resaltado) return
    const raf = requestAnimationFrame(() => {
      document.querySelector(`[data-entry-id="${resaltado.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const t = setTimeout(() => setResaltado(null), 4500)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [resaltado])

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

  const coincide = (e: CatalogEntry, q: string) => {
    const lower = q.toLowerCase()
    return !!(e.descripcion?.toLowerCase().includes(lower) || e.codigo?.toLowerCase().includes(lower))
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
        .catch(() => setFiltered(entries.filter((e) => coincide(e, q))))
    }, 300)
  }

  async function handleDeleteCatalog() {
    setDeletingCatalog(true)
    setCatalogError(null)
    try {
      await catalogApi.deleteCatalog(catalog.id)
      onDeleted(catalog.id)
    } catch (err) {
      setCatalogError(textoDeError(err, 'No se pudo eliminar la lista.'))
      setConfirmarBorrarLista(false)
    } finally {
      setDeletingCatalog(false)
    }
  }

  async function handleDeleteEntry(entryId: string) {
    setDeletingId(entryId)
    setEntryError(null)
    try {
      await catalogApi.deleteEntry(catalog.id, entryId)
      const next = entries.filter((e) => e.id !== entryId)
      setEntries(next)
      setFiltered((prev) => prev.filter((e) => e.id !== entryId))
    } catch (err) {
      setEntryError({ id: entryId, mensaje: textoDeError(err, 'No se pudo eliminar el precio.') })
    } finally {
      setDeletingId(null)
      setConfirmarBorrar(null)
    }
  }

  function upsert(saved: CatalogEntry) {
    setEntries((prev) => (prev.some((e) => e.id === saved.id) ? prev.map((e) => (e.id === saved.id ? saved : e)) : [...prev, saved]))
    setFiltered((prev) => (prev.some((e) => e.id === saved.id) ? prev.map((e) => (e.id === saved.id ? saved : e)) : [...prev, saved]))
  }

  function handleEntrySaved(updated: CatalogEntry) {
    upsert(updated)
    setEditingId(null)
    setResaltado({ id: updated.id, texto: 'Cambios guardados' })
  }

  function handleEntryAdded(entry: CatalogEntry) {
    upsert(entry)
    setAddingEntry(false)
    setResaltado({ id: entry.id, texto: 'Precio agregado' })
  }

  function handleBuscado(g: PrecioGuardado) {
    upsert(g.entrada)
    setBuscando(null)
    setResaltado({ id: g.entrada.id, texto: g.sinOrigen ? 'Precio guardado (sin el origen: falta actualizar el servidor)' : 'Precio guardado' })
  }

  async function handleApply() {
    if (!selectedBudgetId) return
    setApplying(true)
    setApplyResult(null)
    try {
      const result = await catalogApi.apply(selectedBudgetId, catalog.id)
      setApplyResult({
        success: true,
        message: `Lista aplicada: ${result.items_matched} recursos actualizados, ${result.items_unmatched} sin coincidencia`,
      })
      setTimeout(() => setApplyResult(null), 5000)
    } catch (err) {
      setApplyResult({ success: false, message: textoDeError(err, 'No se pudo aplicar la lista.') })
    } finally {
      setApplying(false)
    }
  }

  // Sin fecha válida (una lista recién creada que el servidor devolvió sin ella) no se muestra "Invalid Date"
  const fechaCreada = catalog.created_at ? new Date(catalog.created_at) : null
  const creada = fechaCreada && !Number.isNaN(fechaCreada.getTime()) ? fechaCreada.toLocaleDateString('es-AR') : null

  const accion = 'p-1.5 max-md:min-w-10 max-md:min-h-10 inline-flex items-center justify-center rounded-md text-gray-400 transition-colors disabled:opacity-40'

  return (
    <div ref={raiz} className="@container scroll-mt-4 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden" data-testid="lista-precios" data-catalog-id={catalog.id}>
      {/* Header row */}
      <div className="p-3 sm:p-4 flex flex-wrap justify-between items-center gap-x-3 gap-y-2 cursor-pointer hover:bg-gray-50 transition-colors" onClick={toggle}>
        <div className="min-w-0 flex-1 basis-56">
          <div className="font-semibold text-sm text-gray-900 flex flex-wrap items-center gap-x-2 gap-y-1 [overflow-wrap:anywhere]">
            {catalog.name}
            {catalog.source_file && (
              <span className="bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0.5 rounded border border-orange-200 font-normal [overflow-wrap:anywhere]">
                {catalog.source_file}
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {[
              creada && `Creada: ${creada}`,
              entries.length > 0 && `${entries.length} ${entries.length === 1 ? 'precio' : 'precios'}`,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()}>
          {oficialError && <span className="text-[10px] text-red-600">{oficialError}</span>}
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              catalog.oficial ? 'bg-[#E8F5EE] text-[#1B5E4B]' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {catalog.oficial ? 'Oficial' : 'Solo consulta'}
          </span>
          {esAdmin && (
            <button
              onClick={handleToggleOficial}
              disabled={changingOficial}
              className="max-md:min-h-10 bg-white border text-gray-700 text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {catalog.oficial ? 'Dejar solo para consulta' : 'Marcar como oficial'}
            </button>
          )}
          {esAdmin && !confirmarBorrarLista && (
            <button
              onClick={() => setConfirmarBorrarLista(true)}
              className="p-1.5 max-md:min-w-10 max-md:min-h-10 inline-flex items-center justify-center rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Eliminar la lista"
              aria-label="Eliminar la lista"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={toggle} aria-label={open ? 'Cerrar la lista' : 'Abrir la lista'} className="p-0.5 max-md:min-w-10 max-md:min-h-10 inline-flex items-center justify-center">
            {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
        </div>
        {confirmarBorrarLista && (
          <div role="alertdialog" className="basis-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold">¿Eliminar la lista «{catalog.name}» con todos sus precios? No se puede deshacer.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={handleDeleteCatalog}
                disabled={deletingCatalog}
                className="max-md:min-h-10 inline-flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {deletingCatalog && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />}
                Sí, eliminarla
              </button>
              <button onClick={() => setConfirmarBorrarLista(false)} className="max-md:min-h-10 bg-white border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {catalogError && (
          <p role="alert" className="basis-full text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" onClick={(e) => e.stopPropagation()}>
            {catalogError}
          </p>
        )}
      </div>

      {open && (
        <div className="border-t fade-in">
          {loading ? (
            <div className="p-4 text-xs text-gray-400 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
              Cargando los precios…
            </div>
          ) : loadError ? (
            <div role="alert" className="m-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {loadError}{' '}
              <button onClick={() => void cargarEntradas()} className="font-semibold underline">Probar de nuevo</button>
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
                    className="w-full max-md:min-h-10 text-[11px] border rounded-lg pl-7 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#2D8D68] bg-white"
                  />
                  {searchQ && (
                    <button
                      onClick={() => handleSearch('')}
                      aria-label="Borrar la búsqueda"
                      className="absolute right-0 md:right-2 top-1/2 -translate-y-1/2 max-md:w-10 max-md:h-10 inline-flex items-center justify-center text-gray-400 hover:text-gray-600"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Entries table */}
              {filtered.length > 0 || addingEntry ? (
                <>
                  <div className="text-[11px]" role="table" aria-label={`Precios de ${catalog.name}`}>
                    <div role="row" className={`${COLUMNAS} hidden @xl:grid bg-[#E8F5EE] text-[#143D34] font-medium`}>
                      <div role="columnheader" className="px-3 py-1.5">Código</div>
                      <div role="columnheader" className="px-3 py-1.5">Descripción y de dónde salió</div>
                      <div role="columnheader" className="px-2 py-1.5">Unidad</div>
                      <div role="columnheader" className="px-2 py-1.5 text-right">P. con IVA</div>
                      <div role="columnheader" className="px-2 py-1.5 text-right">P. sin IVA</div>
                      <div role="columnheader" className="px-3 py-1.5">Fecha</div>
                      <div role="columnheader" className="px-1 py-1.5"><span className="sr-only">Acciones</span></div>
                    </div>
                    {filtered.map((e, idx) => {
                      if (editingId === e.id) {
                        return (
                          <EntryForm key={e.id} entry={e} catalogId={catalog.id} onSaved={handleEntrySaved} onCancel={() => setEditingId(null)} />
                        )
                      }
                      const marca = resaltado?.id === e.id ? resaltado.texto : null
                      return (
                        <Fragment key={e.id}>
                          <div
                            role="row"
                            data-entry-id={e.id}
                            data-testid="precio-renglon"
                            className={`${COLUMNAS} border-b items-start transition-colors ${
                              marca ? 'bg-[#E8F5EE] ring-2 ring-inset ring-[#2D8D68]/40' : `hover:bg-[#E8F5EE]/40 ${idx % 2 === 0 ? '' : 'bg-gray-50/50'}`
                            }`}
                          >
                            <div role="cell" className="hidden @xl:block px-3 py-1.5 font-mono text-gray-400 [overflow-wrap:anywhere]">{e.codigo}</div>
                            <div role="cell" className="px-3 py-1.5 min-w-0">
                              {marca && (
                                <div role="status" className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[#1B5E4B] bg-white rounded-full px-2 py-0.5">
                                  <CheckCircle size={11} className="text-[#2D8D68] flex-shrink-0" /> {marca}
                                </div>
                              )}
                              <div className="@xl:hidden font-mono text-[10px] text-gray-400 [overflow-wrap:anywhere]">
                                {[e.codigo, e.unidad].filter(Boolean).join(' · ')}
                              </div>
                              <div className="text-gray-800 [overflow-wrap:anywhere]">{e.descripcion}</div>
                              <OrigenPrecio entrada={e} className="mt-0.5" />
                              {entryError?.id === e.id && (
                                <p role="alert" className="mt-1 text-[10px] text-red-600">{entryError.mensaje}</p>
                              )}
                            </div>
                            <div role="cell" className="hidden @xl:block px-2 py-1.5 text-gray-500 [overflow-wrap:anywhere]">{e.unidad}</div>
                            <div role="cell" className="hidden @xl:block px-2 py-1.5 text-right tabular-nums">{e.precio_con_iva ? fmtCurrency(e.precio_con_iva) : '—'}</div>
                            <div role="cell" className="px-3 @xl:px-2 pb-1 @3xs:py-1.5 flex items-baseline gap-2 @3xs:block @3xs:text-right">
                              <div className="font-medium tabular-nums" data-testid="precio-sin-iva">{e.precio_sin_iva ? fmtPesos(e.precio_sin_iva) : '—'}</div>
                              <div className={`@xl:hidden text-[10px] ${e.fecha_precio ? 'text-gray-400' : 'text-amber-600'}`}>
                                {e.fecha_precio ? fmtDate(e.fecha_precio) : 'sin fecha'}
                              </div>
                            </div>
                            <div
                              role="cell"
                              className={`hidden @xl:block px-3 py-1.5 ${e.fecha_precio ? 'text-gray-500' : 'text-amber-600'}`}
                              title={e.fecha_precio ? (e.proveedor ? `Proveedor: ${e.proveedor}` : undefined) : 'Precio sin fecha'}
                            >
                              {fmtDate(e.fecha_precio)}
                            </div>
                            <div role="cell" className="@3xs:col-span-2 @xl:col-span-1 px-2 @xl:px-1 pb-1.5 @xl:py-1">
                              {confirmarBorrar === e.id ? (
                                <div className="flex flex-wrap items-center justify-end gap-1">
                                  <button
                                    onClick={() => handleDeleteEntry(e.id)}
                                    disabled={deletingId === e.id}
                                    className="text-[10px] font-semibold bg-red-600 hover:bg-red-700 text-white rounded px-2 py-1 disabled:opacity-50"
                                  >
                                    {deletingId === e.id ? 'Eliminando…' : 'Eliminar'}
                                  </button>
                                  <button onClick={() => setConfirmarBorrar(null)} className="text-[10px] text-gray-500 hover:text-gray-800 px-1">
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-0.5 justify-end">
                                  {puedeEditar && (
                                    <button
                                      onClick={() => setBuscando(e)}
                                      className={`${accion} hover:text-sky-700 hover:bg-sky-50`}
                                      title="Buscar en internet"
                                      aria-label={`Buscar en internet el precio de ${e.descripcion ?? e.codigo ?? 'este renglón'}`}
                                      data-testid="buscar-en-internet"
                                    >
                                      <IconoBuscarInternet size={13} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setHistorial((h) => (h === e.id ? null : e.id))}
                                    className={`${accion} hover:text-[#2D8D68] hover:bg-[#E8F5EE] ${historial === e.id ? 'text-[#2D8D68] bg-[#E8F5EE]' : ''}`}
                                    title="Historial del precio"
                                    aria-label="Historial del precio"
                                    aria-expanded={historial === e.id}
                                  >
                                    <History size={13} />
                                  </button>
                                  {puedeEditar && (
                                    <>
                                      <button
                                        onClick={() => setEditingId(e.id)}
                                        className={`${accion} hover:text-[#2D8D68] hover:bg-[#E8F5EE]`}
                                        title="Editar"
                                        aria-label="Editar"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                      <button
                                        onClick={() => setConfirmarBorrar(e.id)}
                                        className={`${accion} hover:text-red-600 hover:bg-red-50`}
                                        title="Eliminar"
                                        aria-label="Eliminar"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {historial === e.id && <HistorialPrecio catalogId={catalog.id} entry={e} />}
                        </Fragment>
                      )
                    })}
                    {addingEntry && puedeEditar && (
                      <EntryForm entry={null} catalogId={catalog.id} onSaved={handleEntryAdded} onCancel={() => setAddingEntry(false)} />
                    )}
                  </div>
                  {/* Footer */}
                  <div className="px-3 py-2 bg-[#E8F5EE]/50 text-[10px] text-gray-500 border-t flex items-center justify-between gap-2">
                    <span>
                      {searchQ
                        ? `${filtered.length} de ${entries.length} precios`
                        : `${entries.length} precios`}
                    </span>
                    {!addingEntry && puedeEditar && (
                      <button
                        onClick={() => setAddingEntry(true)}
                        className="max-md:min-h-10 flex items-center gap-1 text-[#2D8D68] hover:text-[#1B5E4B] font-semibold text-[11px]"
                      >
                        <Plus size={11} /> Agregar un precio
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-4 text-xs text-gray-400 italic flex items-center justify-between">
                  <span>{searchQ ? 'Sin resultados para la búsqueda.' : 'Esta lista no tiene precios.'}</span>
                  {!searchQ && !addingEntry && puedeEditar && (
                    <button
                      onClick={() => setAddingEntry(true)}
                      className="max-md:min-h-10 flex items-center gap-1 text-[#2D8D68] hover:text-[#1B5E4B] font-semibold text-[11px]"
                    >
                      <Plus size={11} /> Agregar un precio
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Apply to budget */}
          {puedeEditar && (
          <div className="border-t p-4 bg-[#E8F5EE]/50">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-[#2D8D68]" />
              <span className="text-xs font-semibold text-gray-700">Aplicar a presupuesto</span>
            </div>
            {budgets.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedBudgetId}
                  onChange={(e) => setSelectedBudgetId(e.target.value)}
                  className="flex-1 min-w-0 text-xs border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2D8D68] focus:border-transparent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">Elegí un presupuesto…</option>
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
              <p className="text-xs text-gray-400">Todavía no hay presupuestos. Creá uno primero.</p>
            )}
            {applyResult && (
              <div
                role={applyResult.success ? 'status' : 'alert'}
                className={`mt-2 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 ${
                  applyResult.success
                    ? 'bg-[#E8F5EE] text-[#166534] border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {applyResult.success && <Check size={12} />}
                <span className="flex-1">{applyResult.message}</span>
                {!applyResult.success && (
                  <button onClick={() => setApplyResult(null)} aria-label="Cerrar" className="opacity-60 hover:opacity-100"><X size={12} /></button>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {buscando && (
        <BuscarPrecio
          destino={{ modo: 'entrada', catalogId: catalog.id, catalogo: catalog.name, entrada: buscando }}
          onGuardado={handleBuscado}
          onClose={() => setBuscando(null)}
        />
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Catalogs() {
  const { puedeEditar } = useAuth()
  const [catalogs, setCatalogs] = useState<PriceCatalog[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUploads, setShowUploads] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [showExcelUpload, setShowExcelUpload] = useState(false)
  // "Buscar un precio" (uno que todavía no está en la lista) y lo que se guardó con él
  const [buscarNuevo, setBuscarNuevo] = useState(false)
  const [guardado, setGuardado] = useState<(GuardadoEnLista & { catalogo: string; sinOrigen: boolean }) | null>(null)
  // La última lista subida desde un .csv: el aviso de arriba y cuál abrir
  const [subido, setSubido] = useState<CsvSubido | null>(null)
  const [abrirLista, setAbrirLista] = useState<{ id: string; n: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([catalogApi.list(), budgetApi.list()])
      .then(([cats, buds]) => {
        setCatalogs(cats)
        setBudgets(buds)
      })
      .catch((err) => {
        setError(textoDeError(err, 'No se pudieron cargar las listas de precios.'))
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleUploaded(r: CsvSubido) {
    setShowUpload(false)
    setGuardado(null)
    setSubido(r)
    // La lista entera de nuevo (con la nueva, tal cual la guardó el servidor); si no responde, se agrega la nueva igual
    let cats: PriceCatalog[] | null = null
    try {
      cats = await catalogApi.list()
    } catch {
      cats = null
    }
    setCatalogs((prev) => {
      if (cats && (!r.id || cats.some((c) => c.id === r.id))) return cats
      if (!r.id || prev.some((c) => c.id === r.id)) return prev
      return [{ id: r.id, org_id: '', name: r.nombre, created_at: new Date().toISOString(), oficial: false }, ...prev]
    })
    if (r.id) setAbrirLista((prev) => ({ id: r.id, n: (prev?.n ?? 0) + 1 }))
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

  function handleBuscadoNuevo(g: PrecioGuardado) {
    setBuscarNuevo(false)
    setGuardado((prev) => ({ catalogId: g.catalogId, entrada: g.entrada, n: (prev?.n ?? 0) + 1, catalogo: g.catalogo, sinOrigen: g.sinOrigen }))
  }

  const hayOficial = catalogs.some((c) => c.oficial)

  return (
    <div className="px-3 py-5 sm:p-6 fade-in">
      <div className="max-w-5xl">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <BookOpen size={14} /> PRECIOS
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
            <h1 className="text-xl font-extrabold text-gray-900">LISTA DE PRECIOS</h1>
            <span className="bg-[#E8F5EE] text-[#1B5E4B] text-xs font-medium px-2 py-0.5 rounded-full">
              {catalogs.length} {catalogs.length === 1 ? 'lista' : 'listas'}
            </span>
          </div>
          {puedeEditar && (
            <div className="flex flex-col items-start sm:items-end gap-1 w-full sm:w-auto">
              <button
                onClick={() => setBuscarNuevo(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-white border border-[#2D8D68]/50 text-[#1B5E4B] hover:bg-[#E8F5EE] font-semibold px-4 py-2 rounded-xl text-sm shadow-sm transition-colors"
              >
                <IconoBuscarInternet size={15} /> Buscar un precio
              </button>
              <EstadoBuscadorChip className="max-sm:pl-1 max-sm:pb-1 sm:text-right" />
            </div>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4 pl-4 max-w-3xl">
          Cada lista tiene el precio, la fecha y de dónde salió cada uno. La app calcula con la lista <strong>oficial</strong>; las demás son solo para consultar.
        </p>
      </div>

      {/* Upload link: panels start collapsed */}
      {puedeEditar && (
      <div className="mb-4 max-w-3xl">
        <button
          onClick={() => {
            setShowUploads((prev) => !prev)
            setShowUpload(false)
            setShowExcelUpload(false)
          }}
          className="max-md:min-h-10 text-xs text-[#2D8D68] hover:text-[#1B5E4B] underline underline-offset-2"
        >
          {showUploads ? 'Ocultar' : 'Subir una lista nueva'}
        </button>
        {showUploads && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              onClick={() => { setShowUpload((prev) => !prev); setShowExcelUpload(false) }}
              className={`max-md:min-h-10 flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg transition-colors ${
                showUpload
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  : 'bg-[#2D8D68] hover:bg-[#1B5E4B] text-white'
              }`}
            >
              {showUpload ? <X size={13} /> : <Plus size={13} />}
              {showUpload ? 'Cancelar' : 'Subir un archivo (.csv)'}
            </button>
            <button
              onClick={() => { setShowExcelUpload((prev) => !prev); setShowUpload(false) }}
              className={`max-md:min-h-10 flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border transition-colors ${
                showExcelUpload
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'
                  : 'border-[#2D8D68] text-[#2D8D68] hover:bg-[#E8F5EE]'
              }`}
            >
              {showExcelUpload ? <X size={13} /> : <FileSpreadsheet size={13} />}
              {showExcelUpload ? 'Cancelar' : 'Subir Excel (4 solapas)'}
            </button>
          </div>
        )}
      </div>
      )}

      <div className="max-w-5xl space-y-3">
        {/* Lo que dejó la subida de un .csv */}
        {subido && (
          <AvisoCsvSubido
            subido={subido}
            catalog={catalogs.find((c) => c.id === subido.id)}
            onOficial={handleChanged}
            onClose={() => setSubido(null)}
          />
        )}

        {/* Lo que se guardó con "Buscar un precio" */}
        {guardado && (
          <div role="status" data-testid="precio-guardado" className="flex items-start gap-2 rounded-xl border border-[#2D8D68]/30 bg-[#E8F5EE] px-3 py-2.5 text-xs text-[#143D34]">
            <CheckCircle size={15} className="flex-shrink-0 mt-px text-[#2D8D68]" />
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <p>
                <strong>Guardado en «{guardado.catalogo}»:</strong>{' '}
                {[guardado.entrada.codigo, guardado.entrada.descripcion].filter(Boolean).join(' · ')}
                {guardado.entrada.precio_sin_iva ? `, ${fmtPesos(guardado.entrada.precio_sin_iva)} sin IVA` : ''}.
              </p>
              <OrigenPrecio entrada={guardado.entrada} className="mt-0.5" />
              {guardado.sinOrigen && (
                <p className="mt-1 text-amber-800">El precio se guardó, pero el servidor todavía no guarda de dónde salió (falta actualizarlo).</p>
              )}
            </div>
            <button onClick={() => setGuardado(null)} aria-label="Cerrar" className="opacity-60 hover:opacity-100 flex-shrink-0"><X size={14} /></button>
          </div>
        )}

        {/* Upload forms */}
        {showUpload && puedeEditar && (
          <UploadForm onSuccess={handleUploaded} onCancel={() => setShowUpload(false)} />
        )}
        {showExcelUpload && puedeEditar && (
          <ExcelUploadForm onSuccess={handleExcelUploaded} onCancel={() => setShowExcelUpload(false)} />
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Cargando listas de precios...
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <p className="font-semibold mb-1">No se pudieron cargar las listas de precios</p>
            <p className="text-xs">{error}</p>
          </div>
        )}

        {!loading && catalogs.length > 0 && !error && (
          !hayOficial && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
              Ninguna lista es oficial: la app toma el precio más nuevo entre todas. Marcá como oficial la que mantenés; las otras quedan para consultar.
            </div>
          )
        )}

        {!loading && catalogs.length === 0 && !error && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center text-gray-400">
            <BookOpen size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Todavía no hay listas de precios.</p>
            <p className="text-xs mt-1">Subí un archivo (.csv) o un Excel para crear tu primera lista.</p>
          </div>
        )}

        {catalogs.map((c) => (
          <CatalogRow
            key={c.id}
            catalog={c}
            budgets={budgets}
            onDeleted={handleDeleted}
            onChanged={handleChanged}
            guardado={guardado}
            abrir={abrirLista?.id === c.id ? abrirLista.n : 0}
          />
        ))}
      </div>

      {buscarNuevo && (
        <BuscarPrecio destino={{ modo: 'nueva' }} onGuardado={handleBuscadoNuevo} onClose={() => setBuscarNuevo(false)} />
      )}
    </div>
  )
}
