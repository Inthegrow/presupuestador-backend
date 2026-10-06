import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { ApiError, budgetApi, templateApi, esFaltaConversion, mensajeDeError } from '../../lib/api'
import type { AgregarTrabajoPayload, AgregarTrabajoResult, FaltaConversion, TemplateSugerencias, TemplateSugerida } from '../../lib/api'
import BuscadorFormulas from './BuscadorFormulas'
import type { FormulaBuscable } from './BuscadorFormulas'
import PreguntaConversion, { factorComoTexto, leerFactor } from './PreguntaConversion'

// Renglón "Agregá un trabajo" del editor: se escribe como se habla, se elige la fórmula, la cantidad y Enter.
// El servidor crea el trabajo con la fórmula aplicada, dentro del rubro de la fórmula (o del rubro elegido).

interface Formula extends FormulaBuscable {
  id: string
}

interface Elegida {
  formula: Formula
  // true si es la propuesta de "Quizás sea": la app reconoció lo que escribió Sol
  desdePropuesta: boolean
  // Conversión que trae la propuesta (ej. el espesor de "contrapiso e=8cm"): arranca la pregunta con ese valor
  factorPropuesto: number | null
}

interface Props {
  budgetId: string
  // Rubro que Sol eligió en el árbol: el trabajo va ahí en vez de al rubro de la fórmula
  rubroElegido: { id: string; nombre: string } | null
  onSoltarRubro: () => void
  onAgregado: (res: AgregarTrabajoResult) => Promise<void> | void
  onVerTrabajo?: (itemId: string) => void
  // Lo que va debajo del renglón (el formulario sin fórmula)
  pie?: ReactNode
}

function normUnidad(u?: string | null): string {
  return (u || '').replace('²', '2').replace('³', '3').trim().toLowerCase()
}

// Con la primera letra en mayúscula ("contrapiso e=8cm" → "Contrapiso e=8cm")
function oracion(t: string): string {
  const s = t.trim()
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function enLista(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join('')
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

const MAX_NOMBRES = 4

export default function AgregarTrabajo({ budgetId, rubroElegido, onSoltarRubro, onAgregado, onVerTrabajo, pie }: Props) {
  const [recetas, setRecetas] = useState<Formula[]>([])
  const [recetasError, setRecetasError] = useState(false)
  const [texto, setTexto] = useState('')
  // "Quizás sea:" para un texto (puede ser de lo que estaba escrito hace un momento)
  const [sug, setSug] = useState<{ para: string; r: TemplateSugerencias } | null>(null)
  const [elegida, setElegida] = useState<Elegida | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [unidad, setUnidad] = useState('')
  const [conversion, setConversion] = useState<{ det: FaltaConversion; valor: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ texto: string; faltan: boolean; itemId: string } | null>(null)
  const [foco, setFoco] = useState<'buscador' | 'cantidad' | null>(null)
  const buscadorRef = useRef<HTMLInputElement>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    templateApi.list()
      .then((l) => setRecetas(Array.isArray(l) ? l.filter((t) => t && t.id) : []))
      .catch(() => setRecetasError(true))
  }, [])

  // "Quizás sea:" sobre lo que se escribe, con una espera corta entre teclas. Si falla, no aparece y listo.
  useEffect(() => {
    const t = texto.trim()
    if (!t) { setSug(null); return }
    let vigente = true
    const espera = setTimeout(() => {
      templateApi.sugerir(t, '')
        .then((r) => { if (vigente && r && typeof r === 'object') setSug({ para: t, r }) })
        .catch(() => {})
    }, 300)
    return () => { vigente = false; clearTimeout(espera) }
  }, [texto])

  // El foco se mueve después de que el renglón cambia (el buscador se vuelve a montar al limpiar)
  useEffect(() => {
    if (!foco) return
    if (foco === 'buscador') buscadorRef.current?.focus()
    else cantidadRef.current?.focus()
    setFoco(null)
  }, [foco, elegida])

  const recetaDe = (s: { id?: string; codigo: string; nombre: string; unidad?: string | null; categoria?: string | null }): Formula | null => {
    const r = recetas.find((t) => t.id === s.id) ?? recetas.find((t) => t.codigo && t.codigo === s.codigo)
    if (r) return r
    return s.id ? { id: s.id, codigo: s.codigo, nombre: s.nombre, unidad: s.unidad, categoria: s.categoria } : null
  }

  const elegir = (formula: Formula, desdePropuesta = false, factorPropuesto: number | null = null) => {
    setElegida({ formula, desdePropuesta, factorPropuesto })
    // La unidad la pone la fórmula. Si la propuesta trae una conversión de m³ (el espesor de un contrapiso
    // o una carpeta), el trabajo se mide en m² y al agregar se pregunta el espesor.
    const conEspesor = desdePropuesta && factorPropuesto != null && factorPropuesto !== 1 && normUnidad(formula.unidad) === 'm3'
    setUnidad(conEspesor ? 'm2' : (formula.unidad || ''))
    setConversion(null)
    setError(null)
    setFoco('cantidad')
  }

  const elegirSugerida = (s: TemplateSugerida, esPropuesta: boolean) => {
    const f = recetaDe(s)
    if (!f) return
    elegir(f, esPropuesta, esPropuesta ? sug?.r.propuesta?.factor ?? null : null)
  }

  // Enter en el buscador: la propuesta, si no la primera de "Quizás sea", si no la primera de la lista
  const enterEnBuscador = async (primera: Formula | null) => {
    const t = texto.trim()
    if (!t) return
    let r = sug && sug.para === t ? sug.r : null
    if (!r) {
      setBuscando(true)
      try {
        r = await templateApi.sugerir(t, '')
        if (r && typeof r === 'object') setSug({ para: t, r })
      } catch {
        r = null
      } finally {
        setBuscando(false)
      }
    }
    if (r?.propuesta) {
      const f = recetaDe(r.propuesta)
      if (f) return elegir(f, true, r.propuesta.factor ?? null)
    }
    const parecida = r?.parecidas?.[0]
    const f = parecida ? recetaDe(parecida) : primera
    if (f) elegir(f)
    else setError('No encontré una fórmula para eso. Probá con otra palabra.')
  }

  const cambiarFormula = () => {
    setElegida(null)
    setUnidad('')
    setConversion(null)
    setError(null)
    setFoco('buscador')
  }

  const limpiar = () => {
    setTexto('')
    setSug(null)
    setElegida(null)
    setCantidad('')
    setUnidad('')
    setConversion(null)
    setError(null)
    setFoco('buscador')
  }

  const agregar = async (factor?: number) => {
    if (enviando) return
    if (!elegida) {
      setError('Elegí una fórmula: escribí el trabajo y tocá una de la lista.')
      setFoco('buscador')
      return
    }
    const cant = leerFactor(cantidad)
    if (cant === null) {
      setError('Escribí la cantidad: un número mayor que cero.')
      setFoco('cantidad')
      return
    }
    setEnviando(true)
    setError(null)
    setAviso(null)
    const body: AgregarTrabajoPayload = { template_id: elegida.formula.id, cantidad: cant }
    if (elegida.desdePropuesta && texto.trim()) body.descripcion = oracion(texto)
    if (unidad.trim()) body.unidad = unidad.trim()
    if (rubroElegido) body.parent_id = rubroElegido.id
    if (factor !== undefined) body.factor = factor
    try {
      const res = await budgetApi.agregarTrabajo(budgetId, body)
      const faltan = Array.isArray(res?.precios_faltantes) ? res.precios_faltantes : []
      const nombres = faltan.map((p) => p.descripcion || p.codigo)
      const lista = nombres.length > MAX_NOMBRES
        ? `${nombres.slice(0, MAX_NOMBRES).join(', ')} y ${nombres.length - MAX_NOMBRES} más`
        : enLista(nombres)
      setAviso({
        texto: faltan.length === 0
          ? 'Agregado.'
          : `Agregado. ${faltan.length === 1 ? 'Falta 1 precio' : `Faltan ${faltan.length} precios`}: ${lista}.`,
        faltan: faltan.length > 0,
        itemId: res?.item?.id,
      })
      limpiar()
      // Refrescar el árbol y la tabla no debe tapar que el trabajo ya quedó guardado
      try { await onAgregado(res) } catch { /* la pantalla se pone al día en el próximo cambio */ }
    } catch (err) {
      if (esFaltaConversion(err)) {
        const prop = elegida.factorPropuesto ?? err.detail.factor_propuesto
        setConversion({ det: err.detail, valor: factorComoTexto(prop) })
      } else {
        setConversion(null)
        // El mensaje del servidor ({codigo, mensaje}) ya dice qué pasó; un texto suelto va con contexto
        const d = err instanceof ApiError ? err.detail : null
        const conMensaje = !!d && typeof d === 'object' && typeof (d as { mensaje?: unknown }).mensaje === 'string'
        setError(conMensaje
          ? (d as { mensaje: string }).mensaje
          : `No se pudo agregar el trabajo: ${mensajeDeError(err, 'probá de nuevo.')}`)
      }
    } finally {
      setEnviando(false)
    }
  }

  const enviarConversion = () => {
    if (!conversion) return
    const n = leerFactor(conversion.valor)
    if (n === null) {
      setError('Escribí un número mayor que cero.')
      return
    }
    agregar(n)
  }

  // El botón y el Enter del renglón: si está la pregunta de conversión abierta, la responden
  const enviar = () => (conversion ? enviarConversion() : agregar())

  const onEnterCampo = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); enviar() }
    if (e.key === 'Escape' && elegida) cambiarFormula()
  }

  const destino = rubroElegido ? (
    <>
      Va a <b className="font-semibold text-gray-700">{rubroElegido.nombre}</b>, el rubro elegido en el árbol.{' '}
      <button onClick={onSoltarRubro} className="text-[#2D8D68] font-medium hover:underline">
        Que vaya al rubro de su fórmula
      </button>
    </>
  ) : elegida?.formula.categoria ? (
    <>Va al rubro de su fórmula: <b className="font-semibold text-gray-700">{elegida.formula.categoria}</b> (si no está, se crea).</>
  ) : (
    <>Cada trabajo va al rubro de su fórmula (si no está, se crea). Si elegís un rubro en el árbol, va a ese.</>
  )

  return (
    <section aria-label="Agregá un trabajo" className="border-b px-4 py-3 bg-[#F8FBF9] flex-shrink-0">
      <div className="text-xs font-bold text-[#143D34] mb-1.5">
        Agregá un trabajo: <span className="font-normal text-gray-600">escribí como hablás</span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[15rem]">
          {elegida ? (
            <div className="flex items-center gap-2 border border-[#2D8D68]/40 rounded-xl bg-white px-3 py-2 min-h-[38px]">
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-medium text-[#143D34]">{elegida.formula.nombre}</span>
                {elegida.formula.unidad && <span className="text-xs text-gray-500"> ({elegida.formula.unidad})</span>}
                {elegida.desdePropuesta && texto.trim() && (
                  <span className="block text-[11px] text-gray-500">Se va a llamar «{oracion(texto)}»</span>
                )}
              </span>
              <button
                onClick={cambiarFormula}
                disabled={enviando}
                title="Elegir otra fórmula"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
              >
                <X size={12} /> Cambiar
              </button>
            </div>
          ) : (
            <BuscadorFormulas<Formula, TemplateSugerida>
              recetas={recetas}
              texto={texto}
              onTexto={(t) => { setTexto(t); setError(null) }}
              inputRef={buscadorRef}
              autoFocus={false}
              soloConTexto
              placeholder="hueco 18, contrapiso, pintura…"
              onElegir={(r) => elegir(r)}
              onEnter={enterEnBuscador}
              deshabilitado={enviando}
              quizas={sug ? { propuesta: sug.r.propuesta, parecidas: sug.r.parecidas, onElegir: elegirSugerida } : undefined}
              className="border rounded-xl bg-white focus-within:border-[#2D8D68] focus-within:ring-2 focus-within:ring-[#2D8D68]/20"
              listaClassName="max-h-60 overflow-y-auto"
            />
          )}
        </div>
        <input
          ref={cantidadRef}
          type="text"
          inputMode="decimal"
          aria-label="Cantidad"
          placeholder="Cantidad"
          value={cantidad}
          onChange={(e) => { setCantidad(e.target.value); setConversion(null) }}
          onKeyDown={onEnterCampo}
          className="w-24 border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
        />
        <input
          type="text"
          aria-label="Unidad"
          placeholder="Unidad"
          title="La de la fórmula. Si ponés otra, te pregunto la conversión."
          value={unidad}
          onChange={(e) => { setUnidad(e.target.value); setConversion(null) }}
          onKeyDown={onEnterCampo}
          className="w-20 border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
        />
        <button
          onClick={enviar}
          disabled={enviando || buscando}
          className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] hover:from-[#1B5E4B] hover:to-[#143D34] disabled:opacity-60 transition-all"
        >
          {enviando || buscando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {enviando ? 'Agregando…' : 'Agregar'}
        </button>
      </div>

      <p className="text-[11px] text-gray-500 mt-1.5">{destino}</p>
      {recetasError && (
        <p className="text-[11px] text-amber-700 mt-1">No pude traer la lista de fórmulas; igual podés escribir y elegir de «Quizás sea».</p>
      )}

      {conversion && elegida && (
        <div className="mt-2 max-w-xl">
          <PreguntaConversion
            titulo={elegida.formula.nombre}
            det={conversion.det}
            valor={conversion.valor}
            onValor={(v) => setConversion({ ...conversion, valor: v })}
            onEnviar={enviarConversion}
            onCancelar={() => { setConversion(null); setError(null); setFoco('cantidad') }}
            ocupado={enviando}
            accion="Agregar"
            accionEnCurso="Agregando…"
          />
        </div>
      )}

      {error && (
        <div role="alert" className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {aviso && !error && (
        <p
          role="status"
          className={`mt-2 text-xs font-medium ${aviso.faltan ? 'text-red-600' : 'text-[#1B5E4B]'}`}
        >
          {aviso.texto}
          {aviso.faltan && aviso.itemId && onVerTrabajo && (
            <>
              {' '}
              <button onClick={() => onVerTrabajo(aviso.itemId)} className="underline text-[#2D8D68] font-medium">
                Ver el trabajo
              </button>
            </>
          )}
        </p>
      )}

      {pie}
    </section>
  )
}
