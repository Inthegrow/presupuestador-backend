import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle, ChevronDown, ChevronUp, ClipboardCheck, RotateCcw, Trash2 } from 'lucide-react'
import FileUpload from '../components/ui/FileUpload'
import BuscadorFormulas from '../components/ui/BuscadorFormulas'
import { catalogApi, obraApi, textoDeError } from '../lib/api'
import { borrarBorrador, duenoBorrador, guardarBorrador, haceCuanto, leerBorrador } from '../lib/borrador'
import type { Borrador } from '../lib/borrador'
import { useAuth } from '../contexts/AuthContext'
import type { ObraAnalisis, ObraAsignaciones, ObraCarga, ObraPrecio, ObraPropuesta, ObraRecetaCatalogo, ObraTarea } from '../lib/api'
import { fmtCurrency, fmtDate, unidadEnPalabras } from '../lib/format'
import { ESTILO } from '../lib/semaforo'
import type { PriceCatalog } from '../types'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true'

// The server's message, whole (quotes, accents and line breaks included): lib/api.ts mensajeDeTexto
const errorText = (e: unknown): string => textoDeError(e)

function normUnidad(u?: string | null): string {
  return (u || '').replace('²', '2').replace('³', '3').trim().toLowerCase()
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)
}

function fmtMillones(n: number): string {
  return Math.abs(n) >= 1_000_000 ? `$${fmtNum(n / 1_000_000)} M` : fmtCurrency(n)
}

// What happened with the yellow jobs that went in without confirmation
function fraseSinConfirmar(sc: { total: number; con_receta: number; sin_receta: number }) {
  const uno = sc.total === 1
  const cabeza = `${sc.total} ${uno ? 'trabajo entró' : 'trabajos entraron'} sin confirmar`
  let detalle: string
  if (sc.sin_receta === 0) detalle = uno ? 'con la fórmula propuesta' : 'todos con la fórmula propuesta'
  else if (sc.con_receta === 0) detalle = uno ? 'con el precio del Excel' : 'todos con el precio del Excel'
  else detalle = `${sc.con_receta} con la fórmula propuesta y ${sc.sin_receta} con el precio del Excel`
  return { cabeza: `${cabeza}: ${detalle}.`, revisar: uno ? 'Podés revisarlo en el presupuesto: en las notas dice ' : 'Podés revisarlos en el presupuesto: en las notas dicen ' }
}

type Pendiente = { codigo: string; nombre: string; unidad: string }
type Filtro = 'revisar' | 'rojo' | 'amarillo' | 'verde' | 'todos'
type Semaforo = ObraTarea['estado']

// Cuánto se espera después del último cambio para pedirle al servidor que revise de nuevo (un solo pedido)
const ESPERA_REVISION = 700

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
      className="min-h-10 md:min-h-0 bg-white border text-gray-700 text-xs font-semibold px-3 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
    >
      Va en $0
    </button>
  )

  return (
    <tr className="border-t align-top block md:table-row py-2 md:py-0">
      <td className="block md:table-cell md:py-2 md:pr-3">
        <div className="font-mono text-xs font-semibold">{p.codigo}</div>
        <div className="text-[11px] text-gray-500">{p.descripcion}</div>
      </td>
      <td className="block md:table-cell py-1.5 md:py-2 md:pr-3 text-xs">
        <span className="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
          {p.motivo}
        </span>
        <div className="text-[11px] text-gray-400 mt-1">
          Afecta a {p.items.length} {p.items.length === 1 ? 'trabajo' : 'trabajos'}
        </div>
      </td>
      <td className="block md:table-cell md:py-2">
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
                  className="min-h-10 md:min-h-0 bg-white border text-[#143D34] text-[11px] font-semibold px-3 md:px-2 py-0.5 rounded-lg hover:bg-[#E8F5EE] disabled:opacity-50"
                >
                  Usar este
                </button>
              </div>
            ))}
          </div>
        )}

        {p.problema === 'sin_precio' && p.entradas[0] && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              inputMode="decimal"
              placeholder={`Precio sin IVA por ${unidadEnPalabras(p.unidad)}`}
              className="border rounded-lg px-2 py-1 min-h-10 md:min-h-0 text-xs w-full md:w-44"
            />
            {botonCero}
            <button
              disabled={busy || bloqueado || !valido}
              onClick={guardar}
              className="flex-1 md:flex-none min-h-10 md:min-h-0 bg-[#2D8D68] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1 rounded-lg"
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
                <div className="flex-1 min-w-0 break-words">
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
                  aria-label="Borrar este"
                  className="w-10 h-10 md:w-auto md:h-auto flex items-center justify-center text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {p.problema === 'no_esta' && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={catalogId} onChange={(e) => setCatalogElegido(e.target.value)} className="border rounded-lg px-2 py-1 min-h-10 md:min-h-0 text-xs w-full md:w-auto">
              {elegibles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              inputMode="decimal"
              placeholder={`Precio sin IVA por ${unidadEnPalabras(p.unidad)}`}
              className="border rounded-lg px-2 py-1 min-h-10 md:min-h-0 text-xs w-full md:w-44"
            />
            {botonCero}
            <button
              disabled={busy || bloqueado || !valido || !catalogId}
              onClick={guardar}
              className="flex-1 md:flex-none min-h-10 md:min-h-0 bg-[#2D8D68] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1 rounded-lg"
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

// ─── Tarjeta de un trabajo ─────────────────────────────────────────────────────

function TareaCard({
  t, estadoLocal, recienConfirmada, actualizando, recetas, excelConPrecios, pendiente,
  onConfirmar, onDeshacer, onElegir, onSinReceta, onValor, onCorregirPrecios,
}: {
  t: ObraTarea
  // El estado con lo que Sol ya hizo en esta pantalla (lo confirma el servidor al revisar)
  estadoLocal: Semaforo
  // Confirmada recién, en esta lista: se queda en su lugar con "Deshacer" hasta cambiar de filtro
  recienConfirmada: boolean
  // Sol la cambió y el servidor todavía no la revisó
  actualizando: boolean
  recetas: ObraRecetaCatalogo[]
  excelConPrecios: boolean
  pendiente?: Pendiente
  onConfirmar: () => void
  onDeshacer: () => void
  onElegir: (r: ObraRecetaCatalogo) => void
  onSinReceta: () => void
  onValor: (codigo: string, valor: number) => void
  onCorregirPrecios: () => void
}) {
  const [buscando, setBuscando] = useState(false)
  const preguntaServidor = t.pregunta
  // Si Sol eligió una fórmula con otra unidad, la pregunta se muestra acá hasta que escriba el número
  const pregunta = pendiente
    ? { texto: `¿Cuántos ${pendiente.unidad} hay en 1 ${t.unidad || 'unidad'}?`, receta: pendiente.codigo, unidad_receta: pendiente.unidad, valor: null as number | null, dato: null as string | null }
    : preguntaServidor
  const [valor, setValor] = useState(pregunta?.valor != null ? String(pregunta.valor) : '')
  useEffect(() => { setValor(pregunta?.valor != null ? String(pregunta.valor) : '') }, [pregunta?.receta, pregunta?.valor])
  // Con "dato" la conversión ya está resuelta: se muestra como frase y el campo aparece solo al tocar "cambiar"
  const [editando, setEditando] = useState(false)
  useEffect(() => { setEditando(false) }, [pregunta?.receta, pregunta?.dato])

  const estado = pendiente || (pregunta && pregunta.valor == null) ? 'rojo' : estadoLocal
  const est = ESTILO[estado]
  const receta = t.receta
  // Red because it has no recipe and no price in the Excel: it can only be solved by picking a recipe
  const sinRecetaNiPrecio = !pendiente && t.estado === 'rojo' && t.motivo_rojo === 'sin_receta'
  const nombreReceta = pendiente
    ? pendiente.nombre
    : receta
      ? receta.partes.length > 1 ? receta.partes.map((p) => p.nombre).join(' + ') : receta.nombre
      : sinRecetaNiPrecio
        ? 'Sin fórmula, y este trabajo no tiene precio en el Excel. Elegí una fórmula.'
        : t.total_excel <= 0
          ? 'Sin fórmula y el Excel lo tiene en $0: si no lo cotizás, confirmá; si no, elegí una fórmula.'
          : 'Sin fórmula: se usa el precio del Excel'

  function enviarValor() {
    const n = Number(valor.replace(',', '.'))
    if (pregunta && n > 0 && n !== pregunta.valor) onValor(pregunta.receta, n)
    else if (pregunta?.dato) setEditando(false)
  }

  return (
    <div
      className={`bg-white border border-l-4 ${est.borde} rounded-xl p-4 transition-colors`}
      data-testid="tarea-obra"
      data-estado={estado}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-3 items-start">
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-medium text-gray-900">{t.descripcion}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {t.veces} {t.veces === 1 ? 'vez' : 'veces'} · {fmtNum(t.cantidad_total)} {t.unidad || 's/u'}{excelConPrecios ? ` · Excel ${fmtMillones(t.total_excel)}` : ''}
          </div>
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 mb-1">
            {recienConfirmada && estado === 'verde' ? (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold rounded px-1.5 py-0.5 ${est.chip}`} data-testid="confirmado">
                Confirmado <Check size={11} strokeWidth={3} />
              </span>
            ) : (
              <span className={`inline-block text-[10px] font-bold rounded px-1.5 py-0.5 ${est.chip}`}>{est.texto}</span>
            )}
            {actualizando && (
              <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                <span className="w-2.5 h-2.5 border-[1.5px] border-gray-300 border-t-transparent rounded-full animate-spin" />
                Actualizando…
              </span>
            )}
          </div>
          <div className="text-sm text-gray-800">{nombreReceta}</div>
          {!pendiente && receta?.porque && <div className="text-[11px] text-gray-500">porque: {receta.porque.charAt(0).toLowerCase() + receta.porque.slice(1)}</div>}
          {!pendiente && !receta && t.sugerencias.length > 0 && (
            <div className="text-[11px] text-gray-500 mt-1">
              Quizás sea:{' '}
              {t.sugerencias.map((s, i) => (
                <span key={s.codigo}>
                  {i > 0 && ' · '}
                  <button
                    className="text-[#2D8D68] hover:underline py-1.5 md:py-0"
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
        <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
          {estado === 'amarillo' && !pendiente && (
            <button
              onClick={onConfirmar}
              className="flex-1 md:flex-none min-h-10 md:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white text-sm md:text-xs font-semibold px-3 py-1.5 rounded-lg"
            >
              Confirmar
            </button>
          )}
          {recienConfirmada && estado === 'verde' && (
            <button
              onClick={onDeshacer}
              className="flex-1 md:flex-none min-h-10 md:min-h-0 inline-flex items-center justify-center gap-1.5 bg-white border border-[#2D8D68]/40 text-[#1B5E4B] text-sm md:text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#E8F5EE]"
            >
              <RotateCcw size={13} /> Deshacer
            </button>
          )}
          <button
            onClick={() => setBuscando(!buscando)}
            className="flex-1 md:flex-none min-h-10 md:min-h-0 bg-white border text-gray-700 text-sm md:text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            {receta || pendiente ? 'Cambiar' : 'Elegir fórmula'}
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
          <button onClick={() => setEditando(true)} className="text-[#2D8D68] hover:underline font-semibold min-h-10 md:min-h-0 px-1">
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
            className="border rounded-lg px-2 py-1 min-h-10 md:min-h-0 w-28 md:w-24 bg-white"
          />
          <span className="text-gray-500">{pregunta.unidad_receta}</span>
        </div>
      )}

      {t.precios_faltantes.length > 0 && (
        <div className="mt-3 text-xs text-red-600">
          Faltan precios: {t.precios_faltantes.join(', ')}{' '}
          <button onClick={onCorregirPrecios} className="underline font-semibold min-h-10 md:min-h-0 px-1">corregir</button>
        </div>
      )}

      {buscando && (
        // En el celular el buscador ocupa toda la pantalla, con el trabajo arriba para no perder de vista cuál es
        <div className="fixed inset-0 z-[70] bg-white flex flex-col md:static md:z-auto md:bg-transparent md:block" role="dialog" aria-label="Elegir fórmula">
        <div className="md:hidden px-4 pt-3 pb-2 border-b bg-[#F5F6F8]">
          <div className="text-[10px] font-bold text-gray-400 tracking-wider">ELEGIR FÓRMULA</div>
          <div className="text-sm font-semibold text-gray-900 line-clamp-2">{t.descripcion}</div>
        </div>
        <BuscadorFormulas
          recetas={recetas}
          className="flex-1 min-h-0 flex flex-col md:block md:mt-3 md:border md:rounded-xl md:bg-white md:shadow-sm"
          listaClassName="flex-1 min-h-0 overflow-y-auto overscroll-contain md:flex-none md:max-h-64"
          onCerrar={() => setBuscando(false)}
          onElegir={(r) => { setBuscando(false); onElegir(r) }}
          ayuda={`Elegí la fórmula correcta para este trabajo.${!excelConPrecios ? '' : t.total_excel <= 0 ? ' Si no lo cotizás, dejalo en $0.' : ' Si ninguna sirve, usá el precio del Excel.'}`}
          extra={excelConPrecios && (
            <button
              onClick={() => { setBuscando(false); onSinReceta() }}
              className="w-full text-left px-3 py-2 text-[#143D34] bg-[#E8F5EE] hover:bg-[#d8eee2]"
            >
              <span className="block text-sm font-medium">
                {t.total_excel <= 0 ? 'Dejarlo en $0 como en el Excel (sin fórmula)' : 'Usar el precio del Excel (sin fórmula)'}
              </span>
              <span className="block text-[11px] text-gray-500 font-normal">
                {t.total_excel <= 0
                  ? 'Tu Excel no lo cotiza: la app no suma nada por este trabajo.'
                  : 'Se carga con lo que cobró tu Excel; la app no desglosa materiales.'}
              </span>
            </button>
          )}
        />
        </div>
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
  // Revisión agrupada: cada cambio suma 1; una respuesta vale solo si no hubo cambios después de pedirla
  const cambios = useRef(0)
  const timerRevision = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [revisionPendiente, setRevisionPendiente] = useState(false)
  const [errorRevision, setErrorRevision] = useState('')
  // Lo que Sol ya decidió y el servidor todavía no revisó: el estado que se muestra mientras tanto
  const [optimista, setOptimista] = useState<Record<string, Semaforo>>({})
  // Trabajos que Sol cambió y esperan la revisión (para avisar en la tarjeta)
  const [cambiadas, setCambiadas] = useState<Record<string, true>>({})
  // Confirmadas en esta lista: se quedan en su lugar (con "Deshacer") hasta que Sol cambie de filtro
  const [fijas, setFijas] = useState<Record<string, true>>({})
  // Lo que había antes de confirmar, para "Deshacer"
  const previas = useRef<Record<string, ObraAsignaciones[string] | undefined>>({})
  const [confirmandoTodos, setConfirmandoTodos] = useState(false)
  // "Cargar presupuesto" tocado con una revisión en camino: carga apenas termina
  const [cargarAlTerminar, setCargarAlTerminar] = useState(false)
  const analisisRef = useRef<ObraAnalisis | null>(null)
  analisisRef.current = analisis

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

  function cancelarRevisionProgramada() {
    if (timerRevision.current) clearTimeout(timerRevision.current)
    timerRevision.current = null
  }

  // Le pide al servidor que revise ya. Si mientras tanto Sol cambió algo, la respuesta no se usa:
  // ya hay otra revisión programada con lo último.
  async function revisar(f: File | null = file, asig: ObraAsignaciones = asignaciones) {
    if (!f) return
    cancelarRevisionProgramada()
    const mio = ++pedido.current
    const version = cambios.current
    const primera = !analisisRef.current
    setRevisando(true)
    setRevisionPendiente(false)
    setError('')
    setErrorRevision('')
    try {
      const res = await obraApi.analizar(f, asig)
      if (mio === pedido.current && version === cambios.current) {
        // Manda lo del servidor: lo optimista se descarta
        setAnalisis(res)
        setOptimista({})
        setCambiadas({})
      }
    } catch (e) {
      if (mio === pedido.current) {
        // Lo confirmado acá no se pierde: sigue en las asignaciones (y en el borrador)
        if (primera) setError(errorText(e))
        else setErrorRevision(errorText(e))
        setCargarAlTerminar(false)
      }
    }
    if (mio === pedido.current) setRevisando(false)
  }

  // Un cambio de Sol: se revisa una sola vez, un rato después del último
  function programarRevision(asig: ObraAsignaciones, espera = ESPERA_REVISION) {
    cambios.current++
    cancelarRevisionProgramada()
    setRevisionPendiente(true)
    setErrorRevision('')
    const f = file
    timerRevision.current = setTimeout(() => {
      timerRevision.current = null
      void revisar(f, asig)
    }, espera)
  }
  useEffect(() => () => cancelarRevisionProgramada(), [])

  function reiniciar() {
    pedido.current++
    lote.current++
    cambios.current++
    cancelarRevisionProgramada()
    setRevisionPendiente(false)
    setErrorRevision('')
    setOptimista({})
    setCambiadas({})
    setFijas({})
    previas.current = {}
    setConfirmandoTodos(false)
    setCargarAlTerminar(false)
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
    setCambiadas((c) => ({ ...c, [clave]: true }))
    programarRevision(next)
  }

  // Lo que se manda al confirmar un amarillo: la fórmula propuesta, o sin fórmula (el precio del Excel)
  function asignacionPropuesta(t: ObraTarea): [string, number][] {
    return t.receta ? t.receta.partes.map((p) => [p.codigo, p.factor] as [string, number]) : []
  }

  // La conversión que escribió Sol vale solo para esa parte: las otras partes de una
  // fórmula combinada (ej. placas EPS + contrapiso) se conservan como estaban
  function responder(t: ObraTarea, codigo: string, valor: number) {
    const pendiente = pendientes[t.clave]
    const partes: [string, number][] = pendiente
      ? [[pendiente.codigo, valor]]
      : (t.receta?.partes ?? []).map((p) => [p.codigo, p.codigo === codigo ? valor : p.factor] as [string, number])
    if (!partes.some(([c]) => c === codigo)) partes.push([codigo, valor])
    asignar(t.clave, partes)
  }

  // Confirmar: la tarjeta queda verde enseguida, sin esperar al servidor; los contadores también
  function confirmarVarias(lista: ObraTarea[], espera = ESPERA_REVISION) {
    if (lista.length === 0) return
    const next = { ...asignaciones }
    const verdes: Record<string, Semaforo> = {}
    const marcadas: Record<string, true> = {}
    for (const t of lista) {
      if (!(t.clave in previas.current)) previas.current[t.clave] = asignaciones[t.clave]
      next[t.clave] = { plantillas: asignacionPropuesta(t), confirmada: true }
      verdes[t.clave] = 'verde'
      marcadas[t.clave] = true
    }
    setAsignaciones(next)
    setOptimista((o) => ({ ...o, ...verdes }))
    setFijas((f) => ({ ...f, ...marcadas }))
    programarRevision(next, espera)
  }

  function confirmar(t: ObraTarea) {
    confirmarVarias([t])
  }

  // Deshacer: vuelve a como estaba antes de confirmar (amarillo, para confirmar)
  function deshacer(t: ObraTarea) {
    const previa = previas.current[t.clave]
    delete previas.current[t.clave]
    const next = { ...asignaciones }
    if (previa) next[t.clave] = previa
    else delete next[t.clave]
    setAsignaciones(next)
    setOptimista((o) => ({ ...o, [t.clave]: 'amarillo' }))
    programarRevision(next)
  }

  function cambiarFiltro(f: Filtro) {
    setFiltro(f)
    setFijas({})
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
    // Nunca con un análisis viejo: si hay una revisión en camino (o programada), se espera y después se carga
    if (revisionPendiente || revisando) {
      setCargarAlTerminar(true)
      if (timerRevision.current) void revisar(file, asignaciones)
      return
    }
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
  // El estado con lo optimista encima (lo que Sol confirmó o deshizo y el servidor todavía no revisó)
  const estadoDe = (t: ObraTarea): Semaforo => optimista[t.clave] ?? t.estado
  const esRojo = (t: ObraTarea) => hayPendiente(t) || estadoDe(t) === 'rojo'
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
  const listasParaConfirmar = tareas.filter((t) => !esRojo(t) && estadoDe(t) === 'amarillo')
  const amarillos = listasParaConfirmar.length
  const verdes = tareas.filter((t) => !esRojo(t) && estadoDe(t) === 'verde').length

  const visibles = tareas.filter((t) => {
    if (fijas[t.clave]) return true
    const e = esRojo(t) ? 'rojo' : estadoDe(t)
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
    rojosSinReceta > 0 && `${rojosSinReceta} ${rojosSinReceta === 1 ? 'fórmula' : 'fórmulas'}`,
    rojosPregunta > 0 && `${rojosPregunta} ${rojosPregunta === 1 ? 'pregunta' : 'preguntas'}`,
    rojosPrecio > 0 && precios,
  ].filter((x): x is string => !!x)
  // "Te falta 1 fórmula" only when there is a single missing thing
  const unoSolo = faltantes.length === 1 && /^1 /.test(faltantes[0])
  const fraseFalta = rojosOtros > 0
    ? `${unoSolo ? 'Te falta' : 'Te faltan'} ${faltantes.length > 1 ? `${faltantes.slice(0, -1).join(', ')} y ${faltantes[faltantes.length - 1]}` : faltantes[0]}`
    : rojosPrecio > 0
      ? `${nPrecios === 1 ? 'Falta' : 'Faltan'} ${precios}: ${nPrecios === 1 ? 'cargalo' : 'cargalos'} arriba, o marcá 'Cargar igual' y ${nPrecios === 1 ? 'ese material va' : 'esos materiales van'} en $0.`
      : ''

  const paso = carga ? 3 : analisis ? 2 : 1
  const enRevision = revisando || revisionPendiente

  // "Cargar presupuesto" esperando la revisión: apenas llega, carga (si sigue todo listo)
  useEffect(() => {
    if (!cargarAlTerminar || revisando || revisionPendiente) return
    setCargarAlTerminar(false)
    if (puedeCargar && !errorRevision) void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargarAlTerminar, revisando, revisionPendiente])

  if (!puedeEditar) {
    return (
      <div className="p-4 md:p-6 fade-in">
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
    <div className="p-4 md:p-6 fade-in">
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <ClipboardCheck size={14} /> CARGAR OBRA
      </div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-7 bg-[#2D8D68] rounded-full" />
        <h1 className="text-xl font-extrabold text-gray-900">CARGAR UNA OBRA</h1>
      </div>
      <p className="text-gray-500 text-sm mb-4 ml-4">
        Subí el cómputo de la obra (hoja 01_C&amp;P): la app le pone las fórmulas y los precios.
      </p>

      <div className="max-w-5xl space-y-5">
        <div className="flex gap-1.5 sm:gap-2 text-xs font-bold">
          {[['1', 'Subir'], ['2', 'Revisar'], ['3', 'Cargar']].map(([n, txt]) => (
            <div
              key={n}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-full whitespace-nowrap ${Number(n) === paso ? 'bg-[#2D8D68] text-white' : Number(n) < paso ? 'bg-[#E8F5EE] text-[#143D34]' : 'bg-gray-100 text-gray-500'}`}
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
              className="flex-1 sm:flex-none min-h-10 sm:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-1.5 rounded-lg text-sm"
            >
              Seguir
            </button>
            <button
              onClick={descartarBorrador}
              className="flex-1 sm:flex-none min-h-10 sm:min-h-0 bg-white border text-gray-600 font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50"
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
              labelCelular="Elegí el Excel de la obra"
              hint="El cómputo de la obra que hacés siempre, el que tiene la hoja 01_C&P, o una planilla que bajaste de la app (Exportar). No hay que agregarle nada."
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
          <div role="alert" data-testid="error-cargar-obra" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg whitespace-pre-line">{error}</div>
        )}

        {/* Paso 2 */}
        {analisis && r && !carga && (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-500">2. REVISÁ LOS TRABAJOS</div>
                {enRevision && (
                  <div className="flex items-center gap-2 text-xs text-gray-500" role="status" data-testid="revisando">
                    <div className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                    Revisando…
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <div className="bg-white border rounded-xl p-3">
                  <div className="text-xl font-bold text-gray-900">{r.grupos}</div>
                  <div className="text-[11px] text-gray-500">trabajos distintos ({r.trabajos} en total, {r.pisos} pisos)</div>
                </div>
                <div className="bg-[#E8F5EE] rounded-xl p-3">
                  <div className="text-xl font-bold text-[#2D8D68]">{verdes}</div>
                  <div className="text-[11px] text-gray-500">listos</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-3">
                  <div className="text-xl font-bold text-amber-600" data-testid="contador-para-confirmar">{amarillos}</div>
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
              {analisis.planilla_simple && (
                <div data-testid="aviso-planilla-simple" className="mt-2 text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                  Es la planilla simple que bajó la app (Exportar): se cargan los trabajos con sus cantidades, rubros y
                  pisos, y la comparación es contra los precios de esa planilla, no contra el Excel original de la obra.
                </div>
              )}
              {!analisis.excel_con_precios && (
                <div className="mt-2 text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                  Este Excel no trae precios: la app calcula todo con las fórmulas y la lista de precios.
                </div>
              )}
              {analisis.titulo_dudoso && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  El Excel dice '{analisis.titulo}'. ¿Es la obra correcta?
                </div>
              )}
            </div>

            {errorRevision && (
              <div role="alert" data-testid="error-revision" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex-1 min-w-[200px] whitespace-pre-line">
                  No se pudo revisar con el servidor: {errorRevision} Lo que confirmaste sigue guardado.
                </span>
                <button
                  onClick={() => void revisar(file, asignaciones)}
                  className="min-h-10 sm:min-h-0 bg-white border border-red-200 text-red-700 font-semibold px-3 py-1.5 rounded-lg text-sm hover:bg-red-100"
                >
                  Probar de nuevo
                </button>
              </div>
            )}

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
                  onClick={() => cambiarFiltro(k)}
                  className={`min-h-10 sm:min-h-0 text-[13px] sm:text-xs font-semibold px-3.5 sm:px-3 py-1.5 rounded-full border ${filtro === k ? 'bg-[#143D34] text-white border-[#143D34]' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {txt} ({n})
                </button>
              ))}
            </div>

            <div ref={panelRef} className="bg-white border rounded-xl p-4">
              <button
                onClick={() => setPanelPrecios(!panelAbierto)}
                className="w-full min-h-10 sm:min-h-0 flex items-center justify-between gap-2 text-left"
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
                        className="w-full sm:w-auto justify-center min-h-10 sm:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-2"
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
                  <table className="w-full text-left block md:table">
                    <tbody className="block md:table-row-group">
                      {analisis.precios.map((p) => (
                        <PrecioRow key={p.codigo} p={p} elegibles={elegibles} bloqueado={!!guardandoExcel} onFixed={() => revisar()} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {amarillos > 0 && (
              <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-4 py-3" data-testid="confirmar-todos">
                {!confirmandoTodos ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex-1 min-w-[200px] text-xs text-amber-800">
                      {amarillos === 1
                        ? 'Queda 1 trabajo para confirmar.'
                        : `Quedan ${amarillos} trabajos para confirmar.`}{' '}
                      Si te sirve lo que propone la app, confirmalos de una vez.
                    </span>
                    <button
                      onClick={() => setConfirmandoTodos(true)}
                      className="w-full sm:w-auto min-h-10 sm:min-h-0 bg-white border border-amber-300 text-amber-800 font-semibold px-3 py-1.5 rounded-lg text-sm sm:text-xs hover:bg-amber-100"
                    >
                      {amarillos === 1 ? 'Confirmar el que queda' : `Confirmar los ${amarillos} para confirmar`}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5" role="group" aria-label="Confirmar todos">
                    <p className="text-sm text-amber-900">
                      Se {amarillos === 1 ? 'confirma 1 trabajo' : `confirman ${amarillos} trabajos`} tal como los propone la app:
                      los que tienen fórmula, con esa fórmula; los que no, con el precio del Excel. Podés cambiar
                      cualquiera después.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => { setConfirmandoTodos(false); confirmarVarias(listasParaConfirmar, 0) }}
                        className="flex-1 sm:flex-none min-h-10 sm:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-1.5 rounded-lg text-sm"
                      >
                        {amarillos === 1 ? 'Sí, confirmarlo' : `Sí, confirmar los ${amarillos}`}
                      </button>
                      <button
                        onClick={() => setConfirmandoTodos(false)}
                        className="flex-1 sm:flex-none min-h-10 sm:min-h-0 bg-white border text-gray-600 font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {visibles.map((t) => (
                <TareaCard
                  key={t.clave}
                  t={t}
                  estadoLocal={esRojo(t) ? 'rojo' : estadoDe(t)}
                  recienConfirmada={!!fijas[t.clave] && !!asignaciones[t.clave]?.confirmada}
                  actualizando={!!cambiadas[t.clave] && !optimista[t.clave] && enRevision}
                  recetas={analisis.recetas}
                  excelConPrecios={analisis.excel_con_precios}
                  pendiente={pendientes[t.clave]}
                  onConfirmar={() => confirmar(t)}
                  onDeshacer={() => deshacer(t)}
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
                  aria-label="Nombre del presupuesto"
                  className="border rounded-lg px-3 py-2 min-h-10 text-sm w-full sm:w-80 max-w-full"
                />
                <button
                  onClick={cargar}
                  disabled={!puedeCargar || cargando || cargarAlTerminar}
                  className="w-full sm:w-auto justify-center min-h-11 sm:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm flex items-center gap-2"
                >
                  {(cargando || cargarAlTerminar) && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {cargando
                    ? `Calculando ${r.trabajos} ${r.trabajos === 1 ? 'trabajo' : 'trabajos'}… ${segundos} s`
                    : cargarAlTerminar ? 'Revisando antes de cargar…' : 'Cargar presupuesto'}
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
                <label className={`flex items-start sm:items-center gap-2 text-xs mt-3 min-h-10 sm:min-h-0 ${rojosOtros > 0 ? 'text-gray-400' : 'text-gray-600'}`}>
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
                  Cargado y calculado: {carga.items} trabajos, {carga.con_receta} con fórmula.
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
