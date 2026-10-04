import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import AuthCard from '../components/layout/AuthCard'

const MIN_CLAVE = 8

export default function NuevaClave() {
  const { user, loading: sesionCargando, reload } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const primerIngreso = params.get('invite') === '1'

  const [clave, setClave] = useState('')
  const [repetir, setRepetir] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (clave.length < MIN_CLAVE) {
      setError(`La clave tiene que tener al menos ${MIN_CLAVE} caracteres.`)
      return
    }
    if (clave !== repetir) {
      setError('Las dos claves tienen que ser iguales.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    if (error) {
      setLoading(false)
      setError('No pudimos guardar la clave. Pedí un enlace nuevo y probá de nuevo.')
      return
    }
    await reload()
    navigate('/app/dashboard')
  }

  const titulo = primerIngreso ? 'Creá tu clave' : 'Elegí tu clave nueva'

  if (sesionCargando) {
    return (
      <AuthCard title={titulo}>
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Un momento...
        </div>
      </AuthCard>
    )
  }

  if (!user) {
    return (
      <AuthCard title="El enlace ya no sirve">
        <p className="text-sm text-gray-600 mb-5">El enlace venció o ya se usó. Pedí uno nuevo y listo.</p>
        <Link
          to="/olvide-mi-clave"
          className="block text-center bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
        >
          Pedir un enlace nuevo
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={titulo}
      subtitle={primerIngreso ? 'Es tu primer ingreso. Elegí la clave con la que vas a entrar.' : 'Escribila dos veces para estar seguros.'}
    >
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">Clave</label>
          <input
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#2D8D68] focus:ring-1 focus:ring-[#2D8D68] transition"
          />
          <p className="text-[11px] text-gray-400 mt-1">Al menos {MIN_CLAVE} caracteres.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">Repetir la clave</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#2D8D68] focus:ring-1 focus:ring-[#2D8D68] transition"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Guardando...
            </>
          ) : 'Guardar la clave'}
        </button>
      </form>
    </AuthCard>
  )
}
