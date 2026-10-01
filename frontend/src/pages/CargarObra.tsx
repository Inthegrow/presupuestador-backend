import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, ClipboardCheck, RefreshCw, Trash2 } from 'lucide-react'
import FileUpload from '../components/ui/FileUpload'
import { catalogApi, obraApi } from '../lib/api'
import type { ObraAnalisis, ObraAsignaciones, ObraCarga, ObraPrecio, ObraTarea } from '../lib/api'
import { fmtCurrency, fmtDate } from '../lib/format'
import type { PriceCatalog } from '../types'

const SIN_RECETA = '__sin__'

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // The API answers "409: {...json...}": show only the message
  const m = msg.match(/"mensaje"\s*:\s*"([^"]+)"/) || msg.match(/"detail"\s*:\s*"([^"]+)"/)
  return m ? m[1] : msg
}

// ─── Paso 2a: un código sin precio, repetido o que no está ─────────────────────

function PrecioRow({ p, catalogs, onFixed }: { p: ObraPrecio; catalogs: PriceCatalog[]; onFixed: () => void }) {
  const [precio, setPrecio] = useState('')
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      onFixed()
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(false)
  }

  const valor = Number(String(precio).replace(',', '.'))
  const valido = precio !== '' && valor > 0

  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-3">
        <div className="font-mono text-xs font-semibold">{p.codigo}</div>
        <div className="text-[11px] text-gray-500">{p.descripcion}</div>
      </td>
      <td className="py-2 pr-3 text-xs">
        <span className="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
          {p.motivo}
        </span>
        <div className="text-[11px] text-gray-400 mt-1">
          Afecta a {p.items.length} {p.items.length === 1 ? 'trabajo' : 'trabajos'}
        </div>
      </td>
      <td className="py-2">
        {p.problema === 'sin_precio' && p.entradas[0] && (
          <div className="flex items-center gap-2">
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder={`Precio sin IVA por ${p.unidad || 'unidad'}`}
              className="border rounded-lg px-2 py-1 text-xs w-44"
            />
            <button
              disabled={busy || !valido}
              onClick={() => run(() => catalogApi.updateEntry(p.entradas[0].catalog_id, p.entradas[0].id, { precio_sin_iva: valor }))}
              className="bg-[#2D8D68] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1 rounded-lg"
            >
              Guardar
            </button>
          </div>
        )}

        {p.problema === 'duplicado' && (
          <div className="space-y-1">
            <div className="text-[11px] text-gray-500">Dejá uno solo: borrá el que no va.</div>
            {p.entradas.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded px-2 py-1">
                <div className="flex-1">
                  <span className="font-mono">{e.codigo}</span> · {e.descripcion} ·{' '}
                  <strong>{e.precio_sin_iva ? fmtCurrency(e.precio_sin_iva) : 'sin precio'}</strong>
                  {e.fecha_precio && <span className="text-gray-400"> · {fmtDate(e.fecha_precio)}</span>}
                  {e.catalogo && <span className="text-gray-400"> · {e.catalogo}</span>}
                </div>
                <button
                  disabled={busy}
                  title="Borrar este"
                  onClick={() => {
                    if (window.confirm(`¿Borrar "${e.codigo} - ${e.descripcion}" del catálogo?`)) {
                      run(() => catalogApi.deleteEntry(e.catalog_id, e.id))
                    }
                  }}
                  className="text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {p.problema === 'no_esta' && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={catalogId} onChange={(e) => setCatalogId(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
              {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder={`Precio sin IVA por ${p.unidad || 'unidad'}`}
              className="border rounded-lg px-2 py-1 text-xs w-44"
            />
            <button
              disabled={busy || !valido || !catalogId}
              onClick={() => run(() => catalogApi.createEntry(catalogId, {
                codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad, tipo: p.tipo, precio_sin_iva: valor,
              }))}
              className="bg-[#2D8D68] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1 rounded-lg"
            >
              Agregar al catálogo
            </button>
          </div>
        )}
        {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
      </td>
    </tr>
  )
}

// ─── Paso 2b: receta de cada trabajo ───────────────────────────────────────────

function TareaRow({
  t, plantillas, onChange,
}: {
  t: ObraTarea
  plantillas: ObraAnalisis['plantillas']
  onChange: (plantillas: [string, number][]) => void
}) {
  const actual = t.plantillas.length ? JSON.stringify(t.plantillas.map((p) => [p.codigo, p.factor])) : SIN_RECETA
  const combinada = t.plantillas.length > 1
  const una = t.plantillas.length === 1 ? t.plantillas[0] : null
  const unidadReceta = una ? plantillas.find((p) => p.codigo === una.codigo)?.unidad : undefined
  const pideFactor = !!una && !!unidadReceta && !!t.unidad &&
    unidadReceta.replace('²', '2').replace('³', '3').toLowerCase() !== t.unidad.replace('²', '2').replace('³', '3').toLowerCase()
  const [factor, setFactor] = useState(String(una?.factor ?? 1))

  useEffect(() => { setFactor(String(una?.factor ?? 1)) }, [una?.factor])

  return (
    <tr className={`border-t align-top ${t.plantillas.length ? '' : 'bg-amber-50/40'}`}>
      <td className="py-2 pr-3">
        <div className="text-xs font-medium text-gray-800">{t.descripcion}</div>
        <div className="text-[11px] text-gray-400">
          {t.veces} {t.veces === 1 ? 'vez' : 'veces'} · {t.unidad || 's/u'} · Excel {fmtCurrency(t.total_excel)}
        </div>
        {t.nota && <div className="text-[11px] text-amber-700 mt-0.5">{t.nota}</div>}
      </td>
      <td className="py-2 w-[360px]">
        <select
          value={actual}
          onChange={(e) => onChange(e.target.value === SIN_RECETA ? [] : JSON.parse(e.target.value))}
          className="border rounded-lg px-2 py-1 text-xs w-full"
        >
          <option value={SIN_RECETA}>Sin receta (usar el precio del Excel)</option>
          {combinada && (
            <option value={actual}>{t.plantillas.map((p) => p.codigo).join(' + ')} (combinada)</option>
          )}
          {plantillas.map((p) => (
            <option key={p.codigo} value={JSON.stringify([[p.codigo, una?.codigo === p.codigo ? una.factor : 1]])}>
              {p.codigo} · {p.nombre} ({p.unidad})
            </option>
          ))}
        </select>
        {pideFactor && una && (
          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-600">
            ¿Cuántos {unidadReceta} hay en 1 {t.unidad}?
            <input
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              onBlur={() => {
                const f = Number(factor.replace(',', '.'))
                if (f > 0 && f !== una.factor) onChange([[una.codigo, f]])
              }}
              className="border rounded px-1 py-0.5 w-20"
            />
          </div>
        )}
      </td>
    </tr>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CargarObra() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [analisis, setAnalisis] = useState<ObraAnalisis | null>(null)
  const [asignaciones, setAsignaciones] = useState<ObraAsignaciones>({})
  const [catalogs, setCatalogs] = useState<PriceCatalog[]>([])
  const [revisando, setRevisando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [permitir, setPermitir] = useState(false)
  const [carga, setCarga] = useState<ObraCarga | null>(null)
  const [verTodas, setVerTodas] = useState(false)

  useEffect(() => { catalogApi.list().then(setCatalogs).catch(() => setCatalogs([])) }, [])

  async function revisar(f: File | null = file, asig: ObraAsignaciones = asignaciones) {
    if (!f) return
    setRevisando(true)
    setError('')
    try {
      setAnalisis(await obraApi.analizar(f, asig))
    } catch (e) {
      setError(errorText(e))
    }
    setRevisando(false)
  }

  function elegirArchivo(f: File) {
    setFile(f)
    setAnalisis(null)
    setCarga(null)
    setAsignaciones({})
    setPermitir(false)
    setNombre(f.name.replace(/\.xlsx?$/i, '').replace(/_/g, ' '))
    revisar(f, {})
  }

  function elegirReceta(t: ObraTarea, plantillas: [string, number][]) {
    const next = { ...asignaciones, [t.clave]: { plantillas } }
    setAsignaciones(next)
    revisar(file, next)
  }

  async function cargar() {
    if (!file || !analisis) return
    setCargando(true)
    setError('')
    try {
      setCarga(await obraApi.cargar(file, asignaciones, nombre.trim(), permitir))
    } catch (e) {
      setError(errorText(e))
      revisar()
    }
    setCargando(false)
  }

  const r = analisis?.resumen
  const sinReceta = analisis?.tareas.filter((t) => !t.plantillas.length) || []
  const tareasVisibles = verTodas ? analisis?.tareas || [] : sinReceta
  const faltanPrecios = (analisis?.precios.length || 0) > 0
  const puedeCargar = !!analisis && !!nombre.trim() && !analisis.plantillas_faltantes.length && (!faltanPrecios || permitir)

  return (
    <div className="p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <ClipboardCheck size={14} /> CARGAR OBRA
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">CARGAR OBRA CON LAS RECETAS</h1>
      </div>
      <p className="text-gray-500 text-sm mb-6 ml-4">
        Subí el Excel de cómputo de la obra. La app toma las cantidades, calcula los precios con las recetas del Maestro
        y te muestra lo que falta corregir antes de cargar.
      </p>

      <div className="max-w-5xl space-y-5">
        {/* Paso 1 */}
        {!carga && (
          <div>
            <div className="text-xs font-bold text-gray-500 mb-2">1. SUBÍ EL EXCEL DE LA OBRA</div>
            <FileUpload
              accept=".xlsx"
              label="Arrastrá el Excel de la obra acá"
              hint="El que tiene la hoja 01_C&P (cómputo y presupuesto)"
              onFile={elegirArchivo}
            />
          </div>
        )}

        {revisando && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Revisando el Excel…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        {/* Paso 2 */}
        {analisis && r && !carga && (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-500">2. REVISÁ Y CORREGÍ</div>
                <button onClick={() => revisar()} disabled={revisando} className="text-xs text-[#2D8D68] flex items-center gap-1">
                  <RefreshCw size={12} /> Revisar de nuevo
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-white border rounded-xl p-3">
                  <div className="text-xl font-bold text-gray-900">{r.items}</div>
                  <div className="text-[11px] text-gray-500">trabajos en {r.subrubros} pisos/partes</div>
                </div>
                <div className="bg-[#E8F5EE] rounded-xl p-3">
                  <div className="text-xl font-bold text-[#2D8D68]">{r.con_receta}</div>
                  <div className="text-[11px] text-gray-500">con receta: los calcula la app</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-3">
                  <div className="text-xl font-bold text-amber-600">{r.sin_receta}</div>
                  <div className="text-[11px] text-gray-500">sin receta: precio del Excel</div>
                </div>
                <div className={`${faltanPrecios ? 'bg-red-50' : 'bg-[#E8F5EE]'} rounded-xl p-3`}>
                  <div className={`text-xl font-bold ${faltanPrecios ? 'text-red-600' : 'text-[#2D8D68]'}`}>
                    {analisis.precios.length}
                  </div>
                  <div className="text-[11px] text-gray-500">precios para corregir</div>
                </div>
              </div>
            </div>

            {analisis.plantillas_faltantes.length > 0 && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                Faltan recetas en la app: {analisis.plantillas_faltantes.join(', ')}.
              </div>
            )}

            {faltanPrecios ? (
              <div className="bg-white border rounded-xl p-4">
                <div className="flex items-center gap-2 font-semibold text-sm text-gray-900 mb-1">
                  <AlertTriangle size={16} className="text-amber-500" /> Precios para corregir
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Lo que corrijas acá queda guardado en los catálogos de la app (precios al {fmtDate(analisis.fecha_precios)}),
                  y sirve para las próximas obras.
                </p>
                <table className="w-full text-left">
                  <tbody>
                    {analisis.precios.map((p) => (
                      <PrecioRow key={p.codigo} p={p} catalogs={catalogs} onFixed={() => revisar()} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-[#E8F5EE] border border-green-200 text-[#143D34] text-sm px-4 py-3 rounded-lg flex items-center gap-2">
                <CheckCircle size={16} className="text-[#2D8D68]" /> Todos los materiales tienen precio.
              </div>
            )}

            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-sm text-gray-900">
                  {verTodas ? 'Receta de cada trabajo' : `Trabajos sin receta (${sinReceta.length})`}
                </div>
                <button onClick={() => setVerTodas(!verTodas)} className="text-xs text-[#2D8D68]">
                  {verTodas ? 'Ver solo los que no tienen receta' : `Ver todos los trabajos (${analisis.tareas.length})`}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Si un trabajo no tiene receta, se carga con el precio del Excel. Podés elegirle una receta de la lista.
              </p>
              <table className="w-full text-left">
                <tbody>
                  {tareasVisibles.map((t) => (
                    <TareaRow key={t.clave} t={t} plantillas={analisis.plantillas} onChange={(p) => elegirReceta(t, p)} />
                  ))}
                </tbody>
              </table>
            </div>

            {analisis.correcciones_excel.length > 0 && (
              <div className="text-xs text-gray-500 bg-gray-50 border rounded-lg px-4 py-3">
                <div className="font-semibold mb-1">Datos del Excel que se corrigen solos al cargar</div>
                <ul className="list-disc ml-4 space-y-0.5">
                  {analisis.correcciones_excel.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            )}

            {/* Paso 3 */}
            <div className="bg-white border rounded-xl p-4">
              <div className="text-xs font-bold text-gray-500 mb-2">3. CARGAR</div>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre del presupuesto"
                  className="border rounded-lg px-3 py-2 text-sm w-80"
                />
                <button
                  onClick={cargar}
                  disabled={!puedeCargar || cargando || revisando}
                  className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm flex items-center gap-2"
                >
                  {cargando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {cargando ? 'Cargando…' : 'Cargar presupuesto'}
                </button>
              </div>
              {faltanPrecios && (
                <label className="flex items-center gap-2 text-xs text-gray-600 mt-3">
                  <input type="checkbox" checked={permitir} onChange={(e) => setPermitir(e.target.checked)} />
                  Cargar igual: los {analisis.precios.length} códigos sin precio quedan en $0 y esos trabajos salen más baratos.
                </label>
              )}
            </div>
          </>
        )}

        {/* Resultado */}
        {carga && (
          <div className="bg-white rounded-xl border p-6 fade-in">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle size={28} className="text-[#2D8D68]" />
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{carga.nombre}</h3>
                <p className="text-xs text-gray-500">
                  Cargado y calculado: {carga.items} trabajos, {carga.con_receta} con receta.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5 max-w-lg">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-[11px] text-gray-500">Total del Excel</div>
                <div className="text-lg font-bold text-gray-900">{fmtCurrency(carga.total_excel)}</div>
              </div>
              <div className="bg-[#E8F5EE] rounded-lg p-3">
                <div className="text-[11px] text-gray-500">Total calculado por la app</div>
                <div className="text-lg font-bold text-[#2D8D68]">{fmtCurrency(carga.resumen?.neto_total)}</div>
              </div>
            </div>
            {carga.precios_en_cero > 0 && (
              <p className="text-xs text-amber-700 mb-4">
                Ojo: {carga.precios_en_cero} códigos quedaron en $0. Cuando tengan precio, usá “Actualizar precios” en Versiones.
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/app/budgets/${carga.budget_id}/editor`)}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2.5 rounded-lg text-sm"
              >
                Abrir el presupuesto
              </button>
              <button
                onClick={() => { setFile(null); setAnalisis(null); setCarga(null) }}
                className="bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50"
              >
                Cargar otra obra
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
