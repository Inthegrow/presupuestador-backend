import { useEffect, useRef, useState } from 'react'
import { Library, X } from 'lucide-react'
import { templateApi, esFaltaConversion, esConfirmarReemplazo, esFalloAplicar } from '../../lib/api'
import type { FaltaConversion, TemplateSugerencias } from '../../lib/api'
import BuscadorFormulas from './BuscadorFormulas'
import PreguntaConversion, { factorComoTexto, leerFactor } from './PreguntaConversion'

// La ventana para elegir y aplicar la fórmula de un trabajo: «Cambiar fórmula» en el detalle y «Elegir fórmula» en
// el editor (el renglón de un trabajo sin fórmula). Aplica con el mismo pedido de siempre y avisa si hay que
// confirmar el reemplazo o responder la conversión de unidades.

export interface ElegirFormulaProps {
  budgetId: string
  itemId: string
  // true si el trabajo ya tiene fórmula o recursos: aplicar otra los reemplaza
  reemplaza: boolean
  // cuántos recursos tiene cargados ahora (para el texto de la confirmación)
  recursosCargados: number
  // Nombre y unidad del trabajo: con eso el servidor propone una fórmula ("Quizás sea:")
  descripcion: string
  unidad: string | null
  onApplied: () => Promise<void> | void
  onClose: () => void
}

// Paso intermedio antes de aplicar: confirmar el reemplazo o responder la conversión de unidades
type Paso =
  | { tipo: 'confirmar'; tmpl: any; mensaje: string }
  | { tipo: 'conversion'; tmpl: any; det: FaltaConversion; valor: string; reemplazar: boolean }

export default function ElegirFormula({ budgetId, itemId, reemplaza, recursosCargados, descripcion, unidad, onApplied, onClose }: ElegirFormulaProps) {
  const [templates, setTemplates] = useState<any[]>([])
  const [sugerencias, setSugerencias] = useState<TemplateSugerencias | null>(null)
  // Conversión que trae la propuesta (si la regla o la memoria la conocen): solo vale para esa fórmula
  const factorPropuesto = useRef<{ id: string; factor: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paso, setPaso] = useState<Paso | null>(null)

  // La lista de fórmulas; si no vino, «Reintentar» la pide de nuevo
  const [listaFallo, setListaFallo] = useState(false)
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    setLoading(true)
    setListaFallo(false)
    templateApi.list()
      .then((tmplList) => setTemplates(Array.isArray(tmplList) ? tmplList : []))
      .catch(() => setListaFallo(true))
      .finally(() => setLoading(false))
  }, [intento])

  // Si el pedido falla, la ventana funciona igual, sin "Quizás sea:"
  useEffect(() => {
    let vigente = true
    if (!descripcion.trim()) return
    templateApi.sugerir(descripcion, unidad)
      .then((r) => { if (vigente && r && typeof r === 'object') setSugerencias(r) })
      .catch(() => {})
    return () => { vigente = false }
  }, [descripcion, unidad])

  // Texto de la confirmación según lo que la pantalla sabe del trabajo
  const mensajeReemplazo = () =>
    recursosCargados > 0
      ? recursosCargados === 1
        ? 'Este trabajo ya tiene 1 recurso cargado (material, mano de obra o subcontrato). La fórmula lo reemplaza.'
        : `Este trabajo ya tiene ${recursosCargados} recursos cargados (materiales, mano de obra o subcontratos). La fórmula los reemplaza.`
      : 'Reemplaza los materiales y la mano de obra que tiene ahora.'

  // Pide al servidor aplicar la fórmula. Si el trabajo ya tiene recursos pide confirmar (409 CONFIRMAR_REEMPLAZO);
  // si falta la conversión de unidades, abre el recuadro para responderla. `reemplazar` se arrastra en todos los reenvíos.
  const aplicar = async (tmpl: any, opts: { factor?: number; reemplazar?: boolean } = {}) => {
    setApplying(tmpl.id)
    setError(null)
    try {
      const body: { factor?: number; reemplazar?: boolean } = {}
      if (opts.factor !== undefined) body.factor = opts.factor
      if (opts.reemplazar) body.reemplazar = true
      await templateApi.apply(tmpl.id, budgetId, itemId, Object.keys(body).length ? body : undefined)
      await onApplied()
      onClose()
    } catch (err) {
      if (esConfirmarReemplazo(err)) {
        setPaso({ tipo: 'confirmar', tmpl, mensaje: err.detail.mensaje || mensajeReemplazo() })
      } else if (esFaltaConversion(err)) {
        // Si Sol eligió la propuesta y trae su conversión, arranca con ese valor; si no, con la del servidor
        const guardado = factorPropuesto.current
        const deLaPropuesta = guardado && guardado.id === tmpl.id ? guardado.factor : null
        const prop = deLaPropuesta ?? err.detail.factor_propuesto
        setPaso({
          tipo: 'conversion',
          tmpl,
          det: err.detail,
          valor: factorComoTexto(prop),
          reemplazar: !!opts.reemplazar,
        })
      } else if (esFalloAplicar(err)) {
        setPaso(null)
        // El mensaje del servidor dice si quedó como estaba o si hay que revisar antes de seguir
        setError(err.detail.mensaje)
        // Si pudo quedar a medias, mostrar lo que hay guardado de verdad (sin cerrar el aviso)
        if (err.detail.codigo === 'A_MEDIAS') Promise.resolve(onApplied()).catch(() => {})
      } else {
        setPaso(null)
        setError('No se pudo aplicar la fórmula. Probá de nuevo.')
      }
      setApplying(null)
    }
  }

  // Al elegir una fórmula: si el trabajo ya tiene una, primero se pide confirmación en la misma ventana
  const handleElegir = (tmpl: any, factor: number | null = null) => {
    setError(null)
    factorPropuesto.current = factor != null ? { id: tmpl.id, factor } : null
    if (reemplaza) setPaso({ tipo: 'confirmar', tmpl, mensaje: mensajeReemplazo() })
    else aplicar(tmpl)
  }

  // Una de "Quizás sea:": se cruza con la lista completa por id o código (si no está, sirve la sugerencia misma)
  const elegirSugerida = (s: { id?: string; codigo: string; nombre: string }, esPropuesta: boolean) => {
    const tmpl = templates.find((t) => t.id === s.id) ?? templates.find((t) => t.codigo && t.codigo === s.codigo) ?? s
    handleElegir(tmpl, esPropuesta ? sugerencias?.propuesta?.factor ?? null : null)
  }

  const enviarConversion = () => {
    if (!paso || paso.tipo !== 'conversion') return
    const n = leerFactor(paso.valor)
    if (n === null) {
      setError('Escribí un número mayor que cero.')
      return
    }
    aplicar(paso.tmpl, { factor: n, reemplazar: paso.reemplazar })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Elegir fórmula" data-testid="elegir-formula">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh] max-md:mx-0 max-md:max-w-none max-md:rounded-none max-md:h-[100dvh] max-md:max-h-none">
        {/* Modal header */}
        <div className="bg-[#E8F5EE] px-5 py-4 flex items-center justify-between border-b border-[#C3E5D3] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Library size={16} className="text-[#2D8D68]" />
            <span className="font-bold text-[#143D34] text-base">Fórmulas</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 max-md:w-10 max-md:h-10 max-md:flex max-md:items-center max-md:justify-center rounded-lg hover:bg-[#C3E5D3] text-[#2D8D68] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Confirmar el reemplazo */}
        {paso?.tipo === 'confirmar' && (
          <div className="px-4 py-4 flex-shrink-0">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <div className="font-semibold text-[#143D34] mb-1">{paso.tmpl.nombre}</div>
              <p>{paso.mensaje}</p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => aplicar(paso.tmpl, { reemplazar: true })}
                  disabled={applying !== null}
                  className="flex items-center gap-1.5 text-xs bg-[#2D8D68] hover:bg-[#1E6B4E] text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {applying !== null ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Aplicando...
                    </>
                  ) : (
                    'Reemplazar'
                  )}
                </button>
                <button
                  onClick={() => { setPaso(null); setError(null) }}
                  disabled={applying !== null}
                  className="text-xs bg-white border text-gray-700 px-3 py-1.5 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* La unidad de la fórmula no es la del trabajo: preguntar cuánto es */}
        {paso?.tipo === 'conversion' && (
          <div className="px-4 py-4 flex-shrink-0">
            <PreguntaConversion
              titulo={paso.tmpl.nombre}
              det={paso.det}
              valor={paso.valor}
              onValor={(v) => setPaso({ ...paso, valor: v })}
              onEnviar={enviarConversion}
              onCancelar={() => { setPaso(null); setError(null) }}
              ocupado={applying !== null}
            />
          </div>
        )}

        {/* Buscador: "Quizás sea:" arriba y la lista completa por rubro debajo */}
        {!paso && (
          <div className="flex-1 min-h-0 flex flex-col">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
                <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                Cargando fórmulas...
              </div>
            ) : listaFallo ? (
              <div role="alert" data-testid="error-lista-formulas" className="m-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex-1 min-w-[12rem]">No pude traer la lista de fórmulas.</span>
                <button
                  type="button"
                  onClick={() => setIntento((n) => n + 1)}
                  className="min-h-10 md:min-h-0 bg-white border border-red-200 text-red-700 font-semibold px-3 py-1.5 rounded-lg text-sm hover:bg-red-100"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <BuscadorFormulas
                recetas={templates}
                onElegir={(t) => handleElegir(t)}
                deshabilitado={applying !== null}
                ayuda="Elegí la fórmula correcta para este trabajo."
                quizas={sugerencias ? {
                  propuesta: sugerencias.propuesta,
                  parecidas: sugerencias.parecidas,
                  onElegir: elegirSugerida,
                } : undefined}
                className="flex-1 min-h-0 flex flex-col max-md:[&_button]:min-h-11 max-md:[&_input]:min-h-8"
                listaClassName="flex-1 overflow-y-auto min-h-[10rem]"
              />
            )}
            {applying !== null && (
              <div className="px-4 py-2 flex items-center gap-2 text-xs text-gray-500 border-t">
                <div className="w-3 h-3 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
                Aplicando...
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 pb-3 flex-shrink-0">
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
