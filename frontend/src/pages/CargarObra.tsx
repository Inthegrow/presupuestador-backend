import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, ClipboardCheck, Search, Trash2 } from 'lucide-react'
import FileUpload from '../components/ui/FileUpload'
import { catalogApi, obraApi } from '../lib/api'
import { borrarBorrador, duenoBorrador, guardarBorrador, leerBorrador } from '../lib/borrador'
import type { Borrador } from '../lib/borrador'
import { useAuth } from '../contexts/AuthContext'
import type { ObraAnalisis, ObraAsignaciones, ObraCarga, ObraPrecio, ObraPropuesta, ObraRecetaCatalogo, ObraTarea } from '../lib/api'
import { fmtCurrency, fmtDate, unidadEnPalabras } from '../lib/format'
import type { PriceCatalog } from '../types'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true'

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // The API answers "409: {...json...}": show only the message
  const m = msg.match(/"mensaje"\s*:\s*"([^"]+)"/) || msg.match(/"detail"\s*:\s*"([^"]+)"/)
  return m ? m[1] : msg
}

function normUnidad(u?: string | null): string {
  return (u || '').replace('²', '2').replace('³', '3').trim().toLowerCase()
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)
}

function fmtMillones(n: number): string {
  return Math.abs(n) >= 1_000_000 ? `$${fmtNum(n / 1_000_000)} M` : fmtCurrency(n)
}

// "hace 12 minutos", "hace 3 horas", "ayer" or the date
function haceCuanto(iso: string, ahora = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const min = Math.floor((ahora.getTime() - d.getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const mismoDia = d.toDateString() === ahora.toDateString()
  if (mismoDia) {
    const h = Math.floor(min / 60)
    return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`
  }
  const ayer = new Date(ahora)
  ayer.setDate(ayer.getDate() - 1)
  if (d.toDateString() === ayer.toDateString()) return 'ayer'
  return fmtDate(iso.slice(0, 10))
}

// What happened with the yellow jobs that went in without confirmation
function fraseSinConfirmar(sc: { total: number; con_receta: number; sin_receta: number }) {
  const uno = sc.total === 1
  const cabeza = `${sc.total} ${uno ? 'trabajo entró' : 'trabajos entraron'} sin confirmar`
  let detalle: string
  if (sc.sin_receta === 0) detalle = uno ? 'con la receta propuesta' : 'todos con la receta propuesta'
  else if (sc.con_receta === 0) detalle = uno ? 'con el precio del Excel' : 'todos con el precio del Excel'
  else detalle = `${sc.con_receta} con la receta propuesta y ${sc.sin_receta} con el precio del Excel`
  return { cabeza: `${cabeza}: ${detalle}.`, revisar: uno ? 'Podés revisarlo en el presupuesto: en las notas dice ' : 'Podés revisarlos en el presupuesto: en las notas dicen ' }
}

type Pendiente = { codigo: string; nombre: string; unidad: string }
type Filtro = 'revisar' | 'rojo' | 'amarillo' | 'verde' | 'todos'

// ─── Paso 2a: un código sin precio, repetido o que no está ─────────────────────

// "EJECUCION DE PINTURA EN PAREDES. INCLUYE ENDUIDO" → "Ejecucion de pintura en paredes"
function nombreCorto(texto?: string | null): string {
  const base = (texto || '').split('.')[0].trim().toLowerCase()
  if (!base) return ''
  const cap = base.charAt(0).toUpperCase() + base.slice(1)
  return cap.length > 48 ? `${cap.slice(0, 47)}…` : cap
}

function origenPropuesta(pr: ObraPropuesta): string {
  if (pr.origen === 'detalle') {
    const trabajo = nombreCorto(pr.trabajo)
    return `hoja ${pr.hoja}${trabajo ? `, ${trabajo}` : ''}`
  }
  return `lista de precios del Excel${pr.fecha ? `, ${fmtDate(pr.fecha)}` : ''}`
}

// Guarda un precio: si el código ya está sin precio lo completa; si no está, lo crea en el catálogo elegido
async function guardarPrecio(
  p: ObraPrecio,
  datos: { precio: number; fecha?: string; descripcion?: string; unidad?: string; catalogId: string },
) {
  // Without a date the server stamps its own "today" (Buenos Aires): the browser's clock may be on another day
  const fecha_precio = datos.fecha || undefined
  if (p.problema === 'sin_precio' && p.entradas[0]) {
    return catalogApi.updateEntry(p.entradas[0].catalog_id, p.entradas[0].id, {
      precio_sin_iva: datos.precio,
      fecha_precio,
    })
  }
  if (!datos.catalogId) throw new Error('No hay un catálogo donde guardarlo.')
  return catalogApi.createEntry(datos.catalogId, {
    codigo: p.codigo,
    descripcion: p.descripcion || datos.descripcion,
    unidad: p.unidad || datos.unidad,
    tipo: p.tipo,
    precio_sin_iva: datos.precio,
    fecha_precio,
  })
}

function destinoDe(p: ObraPrecio, elegibles: PriceCatalog[]): string {
  return p.catalogo_destino?.id || elegibles[0]?.id || ''
}

function PrecioRow({
  p, elegibles, bloqueado, onFixed,
}: { p: ObraPrecio; elegibles: PriceCatalog[]; bloqueado: boolean; onFixed: () => void }) {
  const propuesta = p.propuesta
  const [precio, setPrecio] = useState(propuesta ? String(propuesta.precio) : '')
  const [catalogElegido, setCatalogElegido] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const catalogId = catalogElegido || destinoDe(p, elegibles)

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
  const textoGuardar = propuesta
    ? valido && valor === propuesta.precio ? 'Guardar ese precio' : 'Guardar'
    : p.problema === 'no_esta' ? 'Agregar al catálogo' : 'Guardar'
  const referencias = !propuesta ? p.referencias.slice(0, 3) : []
  const sinSelector = p.problema === 'duplicado'

  function guardar() {
    run(() => guardarPrecio(p, {
      precio: valor,
      fecha: propuesta?.fecha ?? undefined,
      descripcion: propuesta?.descripcion,
      unidad: propuesta?.unidad,
      catalogId,
    }))
  }

  function vaEnCero() {
    run(() => guardarPrecio(p, {
      precio: 0,
      fecha: undefined,
      descripcion: propuesta?.descripcion,
      unidad: propuesta?.unidad,
      catalogId,
    }))
  }

  const botonCero = (
    <button
      disabled={busy || bloqueado || (p.problema === 'no_esta' && !catalogId)}
      onClick={vaEnCero}
      title="Este material no se cotiza: queda en $0 con fecha de hoy"
      className="bg-white border text-gray-700 text-xs font-semibold px-3 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
    >
      Va en $0
    </button>
  )

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
        {!sinSelector && propuesta && (
          <div className="text-[11px] text-gray-600 mb-1.5">
            <span className="font-semibold text-[#143D34]">En tu Excel usaste {fmtCurrency(propuesta.precio)}</span>{' '}
            <span className="text-gray-400">({origenPropuesta(propuesta)})</span>
            {propuesta.nota && <div className="text-amber-700">{propuesta.nota}</div>}
            {propuesta.otros.length > 0 && (
              <div className="text-gray-500">
                También figura a{' '}
                {propuesta.otros.map((o) => `${fmtCurrency(o.precio)} en ${o.hoja}`).join(' y a ')}.
              </div>
            )}
          </div>
        )}

        {!sinSelector && referencias.length > 0 && (
          <div className="space-y-1 mb-1.5">
            {referencias.map((ref) => (
              <div key={ref.id} className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                <span>
                  En {ref.catalogo || 'otra lista'} estaba a{' '}
                  <strong>{fmtCurrency(ref.precio_sin_iva)}</strong>
                  {ref.fecha_precio && <span className="text-gray-400"> ({fmtDate(ref.fecha_precio)})</span>}
                </span>
                <button
                  disabled={busy || bloqueado || !ref.precio_sin_iva || (p.problema === 'no_esta' && !catalogId)}
                  onClick={() => run(() => guardarPrecio(p, {
                    precio: ref.precio_sin_iva || 0,
                    fecha: ref.fecha_precio || undefined,
                    descripcion: ref.descripcion,
                    unidad: ref.unidad,
                    catalogId,
                  }))}
                  className="bg-white border text-[#143D34] text-[11px] font-semibold px-2 py-0.5 rounded-lg hover:bg-[#E8F5EE] disabled:opacity-50"
                >
                  Usar este
                </button>
              </div>
            ))}
          </div>
        )}

        {p.problema === 'sin_precio' && p.entradas[0] && (
          <div className="flex items-center gap-2">
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder={`Precio sin IVA por ${unidadEnPalabras(p.unidad)}`}
              className="border rounded-lg px-2 py-1 text-xs w-44"
            />
            {botonCero}
            <button
              disabled={busy || bloqueado || !valido}
              onClick={guardar}
              className="bg-[#2D8D68] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1 rounded-lg"
            >
              {textoGuardar}
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
                  disabled={busy || bloqueado}
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
            <select value={catalogId} onChange={(e) => setCatalogElegido(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
              {elegibles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder={`Precio sin IVA por ${unidadEnPalabras(p.unidad)}`}
              className="border rounded-lg px-2 py-1 text-xs w-44"
            />
            {botonCero}
            <button
              disabled={busy || bloqueado || !valido || !catalogId}
              onClick={guardar}
              className="bg-[#2D8D68] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1 rounded-lg"
            >
              {textoGuardar}
            </button>
          </div>
        )}
        {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
      </td>
    </tr>
  )
}

// ─── Buscador de recetas ───────────────────────────────────────────────────────

function RecetaBuscador({
  recetas, sinPrecioExcel, onElegir, onSinReceta, onCerrar,
}: {
  recetas: ObraRecetaCatalogo[]
  // The task has no price in the Excel: "use the Excel price" would load it at $0
  sinPrecioExcel: boolean
  onElegir: (r: ObraRecetaCatalogo) => void
  onSinReceta: () => void
  onCerrar: () => void
}) {
  const [q, setQ] = useState('')
  const texto = q.trim().toLowerCase()
  const filtradas = recetas.filter((r) =>
    !texto || `${r.nombre} ${r.categoria || ''}`.toLowerCase().includes(texto))
  const grupos: Record<string, ObraRecetaCatalogo[]> = {}
  for (const r of filtradas) (grupos[r.categoria || 'Otras'] ||= []).push(r)

  return (
    <div className="mt-3 border rounded-xl bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Search size={14} className="text-gray-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscá como hablás: revoque, pintura, contrapiso…"
          className="flex-1 text-sm outline-none"
        />
        <button onClick={onCerrar} className="text-xs text-gray-500 hover:text-gray-800">Cerrar</button>
      </div>
      <p className="px-3 py-1.5 text-[11px] text-gray-500 border-b">
        Elegí la receta correcta para este trabajo.{sinPrecioExcel ? '' : ' Si ninguna sirve, usá el precio del Excel.'}
      </p>
      <div className="max-h-64 overflow-y-auto">
        {!sinPrecioExcel && (
          <button
            onClick={onSinReceta}
            className="w-full text-left px-3 py-2 text-[#143D34] bg-[#E8F5EE] hover:bg-[#d8eee2]"
          >
            <span className="block text-sm font-medium">Usar el precio del Excel (sin receta)</span>
            <span className="block text-[11px] text-gray-500 font-normal">
              Se carga con lo que cobró tu Excel; la app no desglosa materiales.
            </span>
          </button>
        )}
        {Object.entries(grupos).map(([cat, items]) => (
          <div key={cat}>
            <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide">{cat}</div>
            {items.map((r) => (
              <button
                key={r.codigo}
                onClick={() => onElegir(r)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-baseline gap-2"
              >
                <span className="text-gray-800">{r.nombre}</span>
                <span className="text-xs text-gray-500">({r.unidad || 's/u'})</span>
                <span className="text-[10px] text-gray-400 ml-auto">{r.codigo}</span>
              </button>
            ))}
          </div>
        ))}
        {filtradas.length === 0 && <div className="px-3 py-3 text-xs text-gray-500">No encontré nada con esa palabra.</div>}
      </div>
    </div>
  )
}

// ─── Tarjeta de un trabajo ─────────────────────────────────────────────────────

const ESTILO = {
  verde: { borde: 'border-l-[#2D8D68]', chip: 'bg-[#E8F5EE] text-[#2D8D68]', texto: 'Listo' },
  amarillo: { borde: 'border-l-amber-400', chip: 'bg-amber-50 text-amber-700', texto: 'Para confirmar' },
  rojo: { borde: 'border-l-red-500', chip: 'bg-red-50 text-red-600', texto: 'Falta resolver' },
}

function TareaCard({
  t, recetas, excelConPrecios, pendiente, bloqueada, onConfirmar, onElegir, onSinReceta, onValor, onCorregirPrecios,
}: {
  t: ObraTarea
  recetas: ObraRecetaCatalogo[]
  excelConPrecios: boolean
  pendiente?: Pendiente
  bloqueada: boolean
  onConfirmar: () => void
  onElegir: (r: ObraRecetaCatalogo) => void
  onSinReceta: () => void
  onValor: (codigo: string, valor: number) => void
  onCorregirPrecios: () => void
}) {
  const [buscando, setBuscando] = useState(false)
  const preguntaServidor = t.pregunta
  // Si Sol eligió una receta con otra unidad, la pregunta se muestra acá hasta que escriba el número
  const pregunta = pendiente
    ? { texto: `¿Cuántos ${pendiente.unidad} hay en 1 ${t.unidad || 'unidad'}?`, receta: pendiente.codigo, unidad_receta: pendiente.unidad, valor: null as number | null, dato: null as string | null }
    : preguntaServidor
  const [valor, setValor] = useState(pregunta?.valor != null ? String(pregunta.valor) : '')
  useEffect(() => { setValor(pregunta?.valor != null ? String(pregunta.valor) : '') }, [pregunta?.receta, pregunta?.valor])
  // Con "dato" la conversión ya está resuelta: se muestra como frase y el campo aparece solo al tocar "cambiar"
  const [editando, setEditando] = useState(false)
  useEffect(() => { setEditando(false) }, [pregunta?.receta, pregunta?.dato])

  const estado = pendiente || (pregunta && pregunta.valor == null) ? 'rojo' : t.estado
  const est = ESTILO[estado]
  const receta = t.receta
  // Red because it has no recipe and no price in the Excel: it can only be solved by picking a recipe
  const sinRecetaNiPrecio = !pendiente && t.estado === 'rojo' && t.motivo_rojo === 'sin_receta'
  const nombreReceta = pendiente
    ? pendiente.nombre
    : receta
      ? receta.partes.length > 1 ? receta.partes.map((p) => p.nombre).join(' + ') : receta.nombre
      : sinRecetaNiPrecio
        ? 'Sin receta, y este trabajo no tiene precio en el Excel. Elegí una receta.'
        : t.total_excel <= 0
          ? 'Sin receta y el Excel lo tiene en $0: si no lo cotizás, confirmá; si no, elegí una receta.'
          : 'Sin receta: se usa el precio del Excel'

  function enviarValor() {
    const n = Number(valor.replace(',', '.'))
    if (pregunta && n > 0 && n !== pregunta.valor) onValor(pregunta.receta, n)
    else if (pregunta?.dato) setEditando(false)
  }

  return (
    <div className={`bg-white border border-l-4 ${est.borde} rounded-xl p-4`}>
      <div className="flex flex-wrap gap-4 items-start">
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-medium text-gray-900">{t.descripcion}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {t.veces} {t.veces === 1 ? 'vez' : 'veces'} · {fmtNum(t.cantidad_total)} {t.unidad || 's/u'}{excelConPrecios ? ` · Excel ${fmtMillones(t.total_excel)}` : ''}
          </div>
        </div>
        <div className="flex-1 min-w-[220px]">
          <span className={`inline-block text-[10px] font-bold rounded px-1.5 py-0.5 mb-1 ${est.chip}`}>{est.texto}</span>
          <div className="text-sm text-gray-800">{nombreReceta}</div>
          {!pendiente && receta?.porque && <div className="text-[11px] text-gray-500">porque: {receta.porque.charAt(0).toLowerCase() + receta.porque.slice(1)}</div>}
          {!pendiente && !receta && t.sugerencias.length > 0 && (
            <div className="text-[11px] text-gray-500 mt-1">
              Quizás sea:{' '}
              {t.sugerencias.map((s, i) => (
                <span key={s.codigo}>
                  {i > 0 && ' · '}
                  <button
                    className="text-[#2D8D68] hover:underline"
                    title={s.porque}
                    onClick={() => onElegir({ codigo: s.codigo, nombre: s.nombre, unidad: s.unidad })}
                  >
                    {s.nombre}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {t.estado === 'amarillo' && !pendiente && !bloqueada && (
            <button onClick={onConfirmar} className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
              Confirmar
            </button>
          )}
          <button
            onClick={() => setBuscando(!buscando)}
            className="bg-white border text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            {receta || pendiente ? 'Cambiar' : 'Elegir receta'}
          </button>
        </div>
      </div>

      {t.avisos.length > 0 && (
        <ul className="mt-2 text-[11px] text-amber-700 list-disc ml-4 space-y-0.5">
          {t.avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}

      {pregunta && pregunta.dato && !editando && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
          <span>{pregunta.dato}</span>
          <button onClick={() => setEditando(true)} className="text-[#2D8D68] hover:underline font-semibold">
            cambiar
          </button>
        </div>
      )}

      {pregunta && (!pregunta.dato || editando) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
          <span>{pregunta.texto}</span>
          <input
            type="number"
            min="0"
            step="any"
            autoFocus={editando}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onBlur={enviarValor}
            onKeyDown={(e) => { if (e.key === 'Enter') enviarValor() }}
            className="border rounded-lg px-2 py-1 w-24 bg-white"
          />
          <span className="text-gray-500">{pregunta.unidad_receta}</span>
        </div>
      )}

      {t.precios_faltantes.length > 0 && (
        <div className="mt-3 text-xs text-red-600">
          Faltan precios: {t.precios_faltantes.join(', ')}{' '}
          <button onClick={onCorregirPrecios} className="underline font-semibold">corregir</button>
        </div>
      )}

      {buscando && (
        <RecetaBuscador
          recetas={recetas}
          sinPrecioExcel={t.total_excel <= 0}
          onCerrar={() => setBuscando(false)}
          onSinReceta={() => { setBuscando(false); onSinReceta() }}
          onElegir={(r) => { setBuscando(false); onElegir(r) }}
        />
      )}
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CargarObra() {
  const { puedeEditar, user, org } = useAuth()
  // The draft belongs to this user in this company (null until both are known)
  const dueno = duenoBorrador(user?.id ?? (AUTH_ENABLED ? null : 'demo'), org?.id)
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [analisis, setAnalisis] = useState<ObraAnalisis | null>(null)
  const [asignaciones, setAsignaciones] = useState<ObraAsignaciones>({})
  const [pendientes, setPendientes] = useState<Record<string, Pendiente>>({})
  const [catalogs, setCatalogs] = useState<PriceCatalog[]>([])
  const [revisando, setRevisando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [permitir, setPermitir] = useState(false)
  const [carga, setCarga] = useState<ObraCarga | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('revisar')
  // null = sin tocar: abierto solo si hay precios en rojo
  const [panelPrecios, setPanelPrecios] = useState<boolean | null>(null)
  const [guardandoExcel, setGuardandoExcel] = useState<{ hecho: number; total: number } | null>(null)
  const [noGuardados, setNoGuardados] = useState<string[]>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const [segundos, setSegundos] = useState(0)
  // Draft left in this browser by a previous visit (null = none)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const pedido = useRef(0)
  const lote = useRef(0)

  useEffect(() => { catalogApi.list().then(setCatalogs).catch(() => setCatalogs([])) }, [])
  useEffect(() => {
    setBorrador(null)
    if (dueno) leerBorrador(dueno).then(setBorrador)
  }, [dueno])

  // Seconds counter while the budget is being calculated
  useEffect(() => {
    if (!cargando) return
    setSegundos(0)
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [cargando])

  // Keep the work in progress in this browser (debounced 500 ms)
  useEffect(() => {
    if (!file || !analisis || carga || !dueno) return
    const t = setTimeout(() => {
      void guardarBorrador(dueno, {
        archivo: file,
        nombreArchivo: file.name,
        nombre,
        asignaciones,
        pendientes,
        permitir,
        guardadoEn: new Date().toISOString(),
      })
    }, 500)
    return () => clearTimeout(t)
  }, [dueno, file, analisis, carga, nombre, asignaciones, pendientes, permitir])

  async function revisar(f: File | null = file, asig: ObraAsignaciones = asignaciones) {
    if (!f) return
    const mio = ++pedido.current
    setRevisando(true)
    setError('')
    try {
      const res = await obraApi.analizar(f, asig)
      if (mio === pedido.current) setAnalisis(res)
    } catch (e) {
      if (mio === pedido.current) setError(errorText(e))
    }
    if (mio === pedido.current) setRevisando(false)
  }

  function reiniciar() {
    pedido.current++
    lote.current++
    setFile(null)
    setAnalisis(null)
    setCarga(null)
    setAsignaciones({})
    setPendientes({})
    setPermitir(false)
    setRevisando(false)
    setError('')
    setFiltro('revisar')
    setPanelPrecios(null)
    setGuardandoExcel(null)
    setNoGuardados([])
  }

  function elegirArchivo(f: File) {
    reiniciar()
    setBorrador(null)
    setFile(f)
    setNombre(f.name.replace(/\.xlsx?$/i, '').replace(/_/g, ' '))
    revisar(f, {})
  }

  // Resume the draft as if the file had just been dropped, with everything already decided
  function seguirBorrador() {
    if (!borrador) return
    const b = borrador
    const f = new File([b.archivo], b.nombreArchivo, { type: b.archivo.type })
    reiniciar()
    setBorrador(null)
    setFile(f)
    setNombre(b.nombre)
    setAsignaciones(b.asignaciones)
    setPendientes(b.pendientes)
    setPermitir(b.permitir)
    revisar(f, b.asignaciones)
  }

  function descartarBorrador() {
    setBorrador(null)
    if (dueno) void borrarBorrador(dueno)
  }

  // "Quitar" on the uploaded file: start over and forget the draft
  function quitarArchivo() {
    reiniciar()
    setBorrador(null)
    if (dueno) void borrarBorrador(dueno)
  }

  function asignar(clave: string, plantillas: [string, number][], confirmada = true) {
    const next = { ...asignaciones, [clave]: { plantillas, confirmada } }
    setAsignaciones(next)
    setPendientes((p) => { const { [clave]: _quitada, ...resto } = p; return resto })
    revisar(file, next)
  }

  // La conversión que escribió Sol vale solo para esa parte: las otras partes de una
  // receta combinada (ej. placas EPS + contrapiso) se conservan como estaban
  function responder(t: ObraTarea, codigo: string, valor: number) {
    const pendiente = pendientes[t.clave]
    const partes: [string, number][] = pendiente
      ? [[pendiente.codigo, valor]]
      : (t.receta?.partes ?? []).map((p) => [p.codigo, p.codigo === codigo ? valor : p.factor] as [string, number])
    if (!partes.some(([c]) => c === codigo)) partes.push([codigo, valor])
    asignar(t.clave, partes)
  }

  function confirmar(t: ObraTarea) {
    if (!t.receta) return asignar(t.clave, [])
    asignar(t.clave, t.receta.partes.map((p) => [p.codigo, p.factor] as [string, number]))
  }

  function elegir(t: ObraTarea, r: ObraRecetaCatalogo) {
    if (normUnidad(r.unidad) !== normUnidad(t.unidad)) {
      // Hay que preguntarle a Sol cuánto es: no se manda nada hasta que escriba un número
      setPendientes((p) => ({ ...p, [t.clave]: { codigo: r.codigo, nombre: r.nombre, unidad: r.unidad || 'unidad' } }))
    } else {
      asignar(t.clave, [[r.codigo, 1]])
    }
  }

  async function cargar() {
    if (!file || !analisis) return
    setCargando(true)
    setError('')
    try {
      const res = await obraApi.cargar(file, asignaciones, nombre.trim(), permitir)
      if (res.tiempos) console.info('Carga de obra: tiempos del servidor', res.tiempos)
      setCarga(res)
      setBorrador(null)
      if (dueno) void borrarBorrador(dueno)
    } catch (e) {
      setError(errorText(e))
      revisar()
    }
    setCargando(false)
  }

  // Guarda de una vez todos los precios que trae el Excel, uno por uno; si uno falla sigue con los demás
  async function guardarTodosExcel() {
    const lista = propuestas
    if (lista.length === 0) return
    const mio = lote.current
    const fallidos: string[] = []
    setNoGuardados([])
    setGuardandoExcel({ hecho: 0, total: lista.length })
    for (let i = 0; i < lista.length; i++) {
      const p = lista[i]
      const pr = p.propuesta
      if (!pr) continue
      try {
        await guardarPrecio(p, {
          precio: pr.precio,
          fecha: pr.fecha ?? undefined,
          descripcion: pr.descripcion,
          unidad: pr.unidad,
          catalogId: destinoDe(p, elegibles),
        })
      } catch {
        fallidos.push(p.codigo)
      }
      if (mio !== lote.current) return
      setGuardandoExcel({ hecho: i + 1, total: lista.length })
    }
    setNoGuardados(fallidos)
    setGuardandoExcel(null)
    revisar()
  }

  function abrirPrecios() {
    setPanelPrecios(true)
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const r = analisis?.resumen
  const tareas = analisis?.tareas || []
  const hayPendiente = (t: ObraTarea) => !!pendientes[t.clave]
  const esRojo = (t: ObraTarea) => hayPendiente(t) || t.estado === 'rojo'
  const bloqueaPregunta = (t: ObraTarea) => !!t.pregunta && t.pregunta.valor == null
  // Rojo solo por precios: se puede cargar igual si Sol lo acepta
  const rojoSoloPrecio = (t: ObraTarea) =>
    t.estado === 'rojo' && !hayPendiente(t) && !bloqueaPregunta(t) && t.precios_faltantes.length > 0
  const rojosPrecio = tareas.filter(rojoSoloPrecio).length
  const rojosOtros = tareas.filter((t) => esRojo(t) && !rojoSoloPrecio(t)).length
  // Red with no recipe and no price in the Excel (not yet answered): counted as missing recipes
  const rojosSinReceta = tareas.filter((t) => !hayPendiente(t) && t.estado === 'rojo' && t.motivo_rojo === 'sin_receta').length
  const rojosPregunta = rojosOtros - rojosSinReceta
  const rojos = rojosPrecio + rojosOtros
  const amarillos = tareas.filter((t) => !esRojo(t) && t.estado === 'amarillo').length
  const verdes = tareas.filter((t) => !esRojo(t) && t.estado === 'verde').length

  const visibles = tareas.filter((t) => {
    const e = esRojo(t) ? 'rojo' : t.estado
    if (filtro === 'todos') return true
    if (filtro === 'revisar') return e !== 'verde'
    return e === filtro
  })

  const faltanPrecios = (analisis?.precios.length || 0) > 0
  const panelAbierto = panelPrecios ?? rojosPrecio > 0
  const oficial = !!analisis?.catalogo_oficial
  const elegibles = oficial ? catalogs.filter((c) => c.oficial) : catalogs
  const propuestas = (analisis?.precios || []).filter((p) => p.propuesta && p.problema !== 'duplicado')
  const puedeCargar = !!analisis && !!nombre.trim() && rojosOtros === 0 && (rojosPrecio === 0 || permitir)
  const frase = rojos > 0
    ? `Falta resolver ${rojos} ${rojos === 1 ? 'trabajo' : 'trabajos'} en rojo`
    : amarillos > 0
      ? `Todo listo para cargar. Te quedan ${amarillos} para confirmar (podés cargar igual).`
      : 'Todo listo para cargar'

  // Se cuentan códigos sin precio (un mismo material puede frenar varios trabajos), no trabajos
  const nPrecios = analisis?.precios.length ?? 0
  const precios = `${nPrecios} ${nPrecios === 1 ? 'precio' : 'precios'}`
  const faltantes = [
    rojosSinReceta > 0 && `${rojosSinReceta} ${rojosSinReceta === 1 ? 'receta' : 'recetas'}`,
    rojosPregunta > 0 && `${rojosPregunta} ${rojosPregunta === 1 ? 'pregunta' : 'preguntas'}`,
    rojosPrecio > 0 && precios,
  ].filter((x): x is string => !!x)
  // "Te falta 1 receta" only when there is a single missing thing
  const unoSolo = faltantes.length === 1 && /^1 /.test(faltantes[0])
  const fraseFalta = rojosOtros > 0
    ? `${unoSolo ? 'Te falta' : 'Te faltan'} ${faltantes.length > 1 ? `${faltantes.slice(0, -1).join(', ')} y ${faltantes[faltantes.length - 1]}` : faltantes[0]}`
    : rojosPrecio > 0
      ? `${nPrecios === 1 ? 'Falta' : 'Faltan'} ${precios}: ${nPrecios === 1 ? 'cargalo' : 'cargalos'} arriba, o marcá 'Cargar igual' y ${nPrecios === 1 ? 'ese material va' : 'esos materiales van'} en $0.`
      : ''

  const paso = carga ? 3 : analisis ? 2 : 1

  if (!puedeEditar) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <ClipboardCheck size={14} /> CARGAR OBRA
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
        <ClipboardCheck size={14} /> CARGAR OBRA
      </div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">CARGAR UNA OBRA</h1>
      </div>
      <p className="text-gray-500 text-sm mb-4 ml-4">
        Subí el cómputo de la obra (hoja 01_C&amp;P): la app le pone las recetas y los precios.
      </p>

      <div className="max-w-5xl space-y-5">
        <div className="flex gap-2 text-xs font-bold">
          {[['1', 'Subir'], ['2', 'Revisar'], ['3', 'Cargar']].map(([n, txt]) => (
            <div
              key={n}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${Number(n) === paso ? 'bg-[#2D8D68] text-white' : Number(n) < paso ? 'bg-[#E8F5EE] text-[#143D34]' : 'bg-gray-100 text-gray-500'}`}
            >
              <span>{n}</span><span>{txt}</span>
            </div>
          ))}
        </div>

        {/* Paso 1 */}
        {!carga && !file && borrador && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="text-sm font-bold text-amber-800">Tenías una carga a medias</div>
              <div className="text-xs text-amber-800">
                <span className="font-semibold">{borrador.nombreArchivo}</span>
                {haceCuanto(borrador.guardadoEn) && <>, {haceCuanto(borrador.guardadoEn)}</>}
              </div>
            </div>
            <button
              onClick={seguirBorrador}
              className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-1.5 rounded-lg text-sm"
            >
              Seguir
            </button>
            <button
              onClick={descartarBorrador}
              className="bg-white border text-gray-600 font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50"
            >
              Descartar
            </button>
          </div>
        )}

        {!carga && (
          <div>
            <div className="text-xs font-bold text-gray-500 mb-2">1. SUBÍ EL EXCEL</div>
            <FileUpload
              accept=".xlsx"
              label="Arrastrá el Excel de la obra acá"
              hint="El cómputo de la obra que hacés siempre, el que tiene la hoja 01_C&P. No hay que agregarle nada."
              onFile={elegirArchivo}
              value={file}
              onClear={quitarArchivo}
            />
          </div>
        )}

        {revisando && !analisis && (
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
                <div className="text-xs font-bold text-gray-500">2. REVISÁ LOS TRABAJOS</div>
                {revisando && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                    Revisando…
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border rounded-xl p-3">
                  <div className="text-xl font-bold text-gray-900">{r.grupos}</div>
                  <div className="text-[11px] text-gray-500">trabajos distintos ({r.trabajos} en total, {r.pisos} pisos)</div>
                </div>
                <div className="bg-[#E8F5EE] rounded-xl p-3">
                  <div className="text-xl font-bold text-[#2D8D68]">{verdes}</div>
                  <div className="text-[11px] text-gray-500">listos</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-3">
                  <div className="text-xl font-bold text-amber-600">{amarillos}</div>
                  <div className="text-[11px] text-gray-500">para confirmar</div>
                </div>
                <div className={`${rojos ? 'bg-red-50' : 'bg-[#E8F5EE]'} rounded-xl p-3`}>
                  <div className={`text-xl font-bold ${rojos ? 'text-red-600' : 'text-[#2D8D68]'}`}>{rojos}</div>
                  <div className="text-[11px] text-gray-500">en rojo</div>
                </div>
              </div>
              <div className={`mt-3 text-sm font-semibold ${rojos ? 'text-red-600' : 'text-[#143D34]'}`}>{frase}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Lo que elijas acá queda guardado para la próxima obra.
              </div>
              {!analisis.excel_con_precios && (
                <div className="mt-2 text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                  Este Excel no trae precios: la app calcula todo con las recetas y la lista de precios.
                </div>
              )}
              {analisis.titulo_dudoso && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  El Excel dice '{analisis.titulo}'. ¿Es la obra correcta?
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {([
                ['revisar', 'Para revisar', rojos + amarillos],
                ['rojo', 'Rojos', rojos],
                ['amarillo', 'Amarillos', amarillos],
                ['verde', 'Verdes', verdes],
                ['todos', 'Todos', tareas.length],
              ] as [Filtro, string, number][]).map(([k, txt, n]) => (
                <button
                  key={k}
                  onClick={() => setFiltro(k)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${filtro === k ? 'bg-[#143D34] text-white border-[#143D34]' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {txt} ({n})
                </button>
              ))}
            </div>

            <div ref={panelRef} className="bg-white border rounded-xl p-4">
              <button
                onClick={() => setPanelPrecios(!panelAbierto)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-2 font-semibold text-sm text-gray-900">
                  <AlertTriangle size={16} className={faltanPrecios ? 'text-amber-500' : 'text-[#2D8D68]'} />
                  {faltanPrecios
                    ? `Precios para corregir (${analisis.precios.length})`
                    : 'Todos los materiales tienen precio'}
                </div>
                {faltanPrecios && (panelAbierto ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
              </button>
              {faltanPrecios && panelAbierto && (
                <div className="mt-3">
                  <p className="text-xs text-gray-500 mb-3">
                    {oficial
                      ? <>Lo que corrijas acá queda guardado en el catálogo <strong>oficial</strong></>
                      : 'Lo que corrijas acá queda guardado en los catálogos de la app'}
                    {' '}(precios al {fmtDate(analisis.fecha_precios)}), y sirve para las próximas obras.
                  </p>
                  {propuestas.length >= 2 && (
                    <div className="flex flex-wrap items-center gap-3 mb-3 bg-[#E8F5EE] rounded-lg px-3 py-2">
                      <span className="text-xs text-[#143D34]">
                        {guardandoExcel
                          ? `Guardando ${Math.min(guardandoExcel.hecho + 1, guardandoExcel.total)} de ${guardandoExcel.total}…`
                          : 'Tu Excel ya trae estos precios.'}
                      </span>
                      <button
                        onClick={guardarTodosExcel}
                        disabled={!!guardandoExcel || revisando}
                        className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-2"
                      >
                        {guardandoExcel && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        Guardar los {propuestas.length} precios que trae el Excel
                      </button>
                    </div>
                  )}
                  {noGuardados.length > 0 && (
                    <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      No pude guardar {noGuardados.length === 1 ? 'este precio' : 'estos precios'}: {noGuardados.join(', ')}. Probá de a uno acá abajo.
                    </div>
                  )}
                  <table className="w-full text-left">
                    <tbody>
                      {analisis.precios.map((p) => (
                        <PrecioRow key={p.codigo} p={p} elegibles={elegibles} bloqueado={!!guardandoExcel} onFixed={() => revisar()} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {visibles.map((t) => (
                <TareaCard
                  key={t.clave}
                  t={t}
                  recetas={analisis.recetas}
                  excelConPrecios={analisis.excel_con_precios}
                  pendiente={pendientes[t.clave]}
                  bloqueada={revisando}
                  onConfirmar={() => confirmar(t)}
                  onElegir={(rec) => elegir(t, rec)}
                  onSinReceta={() => asignar(t.clave, [])}
                  onValor={(codigo, v) => responder(t, codigo, v)}
                  onCorregirPrecios={abrirPrecios}
                />
              ))}
              {visibles.length === 0 && (
                <div className="bg-[#E8F5EE] border border-green-200 text-[#143D34] text-sm px-4 py-3 rounded-lg flex items-center gap-2">
                  <CheckCircle size={16} className="text-[#2D8D68]" /> No hay trabajos en esta lista.
                </div>
              )}
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
                  className="border rounded-lg px-3 py-2 text-sm w-80 max-w-full"
                />
                <button
                  onClick={cargar}
                  disabled={!puedeCargar || cargando || revisando}
                  className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm flex items-center gap-2"
                >
                  {cargando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {cargando
                    ? `Calculando ${r.trabajos} ${r.trabajos === 1 ? 'trabajo' : 'trabajos'}… ${segundos} s`
                    : 'Cargar presupuesto'}
                </button>
              </div>
              {cargando && (
                <p className="text-xs text-gray-500 mt-2">
                  Puede tardar un minuto: la app arma los materiales de cada trabajo y recalcula la obra.
                </p>
              )}
              {fraseFalta && (
                <p className={`text-xs mt-2 ${rojosOtros > 0 ? 'text-red-600' : 'text-gray-600'}`}>{fraseFalta}</p>
              )}
              {rojosPrecio > 0 && (
                <label className={`flex items-center gap-2 text-xs mt-3 ${rojosOtros > 0 ? 'text-gray-400' : 'text-gray-600'}`}>
                  <input
                    type="checkbox"
                    checked={permitir && rojosOtros === 0}
                    disabled={rojosOtros > 0}
                    onChange={(e) => setPermitir(e.target.checked)}
                  />
                  Cargar igual: esos materiales quedan en $0 y los trabajos que los usan salen más baratos.
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
                  {carga.memoria_guardada ? ' La próxima obra se acuerda de lo que elegiste.' : ''}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5 max-w-lg">
              {carga.total_excel > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-[11px] text-gray-500">Total del Excel</div>
                  <div className="text-lg font-bold text-gray-900">{fmtCurrency(carga.total_excel)}</div>
                </div>
              )}
              <div className="bg-[#E8F5EE] rounded-lg p-3">
                <div className="text-[11px] text-gray-500">Total calculado por la app</div>
                <div className="text-lg font-bold text-[#2D8D68]">{fmtCurrency(carga.resumen?.neto_total)}</div>
              </div>
            </div>
            {carga.sin_confirmar && carga.sin_confirmar.total > 0 && (() => {
              const f = fraseSinConfirmar(carga.sin_confirmar)
              return (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-lg">
                  {f.cabeza} {f.revisar}<em>Para confirmar</em>.
                </p>
              )
            })()}
            {carga.precios_en_cero > 0 && (
              <p className="text-xs text-amber-700 mb-4">
                Ojo: {carga.precios_en_cero} códigos quedaron en $0. Cuando tengan precio, usá “Actualizar precios” en Versiones.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={reiniciar}
                className="bg-white border text-gray-600 px-5 py-2.5 rounded-lg text-sm hover:bg-gray-50"
              >
                Cargar otra obra
              </button>
              {carga.total_excel > 0 && (
                <button
                  onClick={() => navigate(`/app/budgets/${carga.budget_id}/diferencias`)}
                  className="bg-white border border-[#2D8D68] text-[#2D8D68] font-semibold px-5 py-2.5 rounded-lg text-sm hover:bg-[#E8F5EE]"
                >
                  Ver diferencias con el Excel
                </button>
              )}
              <button
                onClick={() => navigate(`/app/budgets/${carga.budget_id}/editor`)}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2.5 rounded-lg text-sm"
              >
                Abrir el presupuesto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
