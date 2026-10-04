import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AuthCard from '../components/layout/AuthCard'

export default function OlvideMiClave() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const mail = email.trim()
    const { error } = await supabase.auth.resetPasswordForEmail(mail, {
      redirectTo: `${window.location.origin}/nueva-clave`,
    })
    setLoading(false)
    if (error) {
      setError('No pudimos mandar el enlace. Probá de nuevo en un rato.')
    } else {
      setEnviado(mail)
    }
  }

  return (
    <AuthCard title="Olvidé mi clave" subtitle={enviado ? undefined : 'Escribí tu mail y te mandamos un enlace para crear una clave nueva.'}>
      {enviado ? (
        <div className="space-y-5">
          <div className="bg-[#F0FAF5] border border-[#2D8D68]/30 text-[#143D34] text-sm px-4 py-3 rounded-lg">
            Te mandamos un enlace a <span className="font-semibold">{enviado}</span>. Fijate también en correo no deseado.
          </div>
          <Link to="/login" className="block text-center text-sm text-[#2D8D68] hover:text-[#1B5E4B] font-medium">
            Volver a entrar
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Mail</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#2D8D68] focus:ring-1 focus:ring-[#2D8D68] transition"
              />
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700">
                Volver
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Enviando...
                  </>
                ) : 'Enviarme el enlace'}
              </button>
            </div>
          </form>
        </>
      )}
    </AuthCard>
  )
}
