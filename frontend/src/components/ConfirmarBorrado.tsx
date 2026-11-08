import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
import { mensajeDeError } from '../lib/api'

// Borrar con doble verificación: hay que escribir el nombre (sin importar mayúsculas ni espacios de los costados)
// para que se habilite «Borrar para siempre». Se usa en Mis presupuestos y en el menú del editor.

export function mismoNombre(escrito: string, nombre: string): boolean {
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
  return norm(escrito) !== '' && norm(escrito) === norm(nombre)
}

interface Props {
  nombre: string
  // Lo que se borra, para la frase de abajo ("el presupuesto con todos sus trabajos")
  queSeBorra?: string
  onConfirmar: () => Promise<void>
  onCerrar: () => void
}

export default function ConfirmarBorrado({ nombre, queSeBorra = 'el presupuesto con todos sus trabajos, sus recursos y sus versiones', onConfirmar, onCerrar }: Props) {
  const [escrito, setEscrito] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const idTitulo = useId()
  const idCampo = useId()
  const coincide = mismoNombre(escrito, nombre)

  const cerrarRef = useRef(onCerrar)
  cerrarRef.current = onCerrar
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])
  // Esc cierra (mientras no esté borrando)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !borrando) cerrarRef.current() }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [borrando])

  async function borrar(e?: FormEvent) {
    e?.preventDefault()
    if (!coincide || borrando) return
    setBorrando(true)
    setError(null)
    try {
      await onConfirmar()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo borrar. Probá de nuevo.'))
      setBorrando(false)
    }
  }

  // En el body: así no lo corta ni lo mueve la tarjeta o el encabezado donde se abre
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4"
      onClick={(e) => { e.stopPropagation(); if (!borrando) onCerrar() }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        data-testid="confirmar-borrado"
        onSubmit={borrar}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={idTitulo} className="text-base font-bold text-gray-900">Borrar para siempre</h2>
            <p className="text-sm text-gray-600 mt-1 [overflow-wrap:anywhere]">
              Se borra {queSeBorra}. No se puede deshacer.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={borrando}
            aria-label="Cerrar"
            className="w-10 h-10 -mr-2 -mt-2 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-4">
          <label htmlFor={idCampo} className="block text-sm text-gray-800 [overflow-wrap:anywhere]">
            Para borrar «<strong>{nombre}</strong>», escribí su nombre
          </label>
          <input
            id={idCampo}
            ref={inputRef}
            value={escrito}
            onChange={(e) => { setEscrito(e.target.value); setError(null) }}
            disabled={borrando}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={nombre}
            data-testid="confirmar-borrado-nombre"
            className="mt-2 w-full h-11 px-3 text-base sm:text-sm border border-gray-300 rounded-xl outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200 disabled:opacity-60"
          />
          <p className="text-xs text-gray-500 mt-1.5 min-h-4" aria-live="polite">
            {escrito.trim() && !coincide ? 'Todavía no coincide con el nombre.' : ''}
          </p>
          {error && (
            <p role="alert" className="mt-1 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 mt-1">
          <button
            type="button"
            onClick={onCerrar}
            disabled={borrando}
            className="h-11 sm:h-10 px-4 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!coincide || borrando}
            className="h-11 sm:h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:bg-red-300 disabled:cursor-not-allowed"
          >
            {borrando ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {borrando ? 'Borrando…' : 'Borrar para siempre'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
