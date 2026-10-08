import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true'

const SOLE_LOGO = (
  <svg width="48" height="48" viewBox="0 0 512 512" fill="none">
    <path
      d="M256 72C170.947 72 102 140.947 102 226C102 311.053 170.947 380 256 380C316.134 380 368.215 345.533 393.832 295.282"
      stroke="#E0A33A" strokeWidth="28" strokeLinecap="round"
    />
    <circle cx="390" cy="179" r="28" fill="#E0A33A" />
    <path
      d="M251 334V250C251 221.768 273.768 199 302 199H319"
      stroke="#143D34" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"
    />
    <path d="M251 280C216.14 280 188 251.86 188 217V206C222.86 206 251 234.14 251 269V280Z" fill="#2D8D68" />
    <path d="M257 248C257 209.34 288.34 178 327 178H338C338 216.66 306.66 248 268 248H257Z" fill="#2D8D68" />
  </svg>
)

export default function Login() {
  const { user, signIn, error: errorServidor, clearError } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    clearError()
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError('El mail o la clave no son correctos.')
    } else {
      navigate('/app/dashboard', { replace: true })
    }
  }

  // Already signed in (second visit from SOLÉ): straight in; AuthProvider kept ?org=
  if (AUTH_ENABLED && user && !errorServidor) {
    return <Navigate to="/app/dashboard" replace />
  }

  return (
    // html y body no se deslizan (la app tiene su propio lugar que se desliza): esta pantalla se desliza sola,
    // así en un celular chico o con el teclado abierto se llega a todo
    <div className="h-full overflow-y-auto bg-[#F5F6F8]">
    <div className="min-h-full flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-[#143D34] px-6 sm:px-8 py-6 sm:py-8 flex flex-col items-center">
            {SOLE_LOGO}
            <div className="mt-4 text-center">
              <div className="text-white font-extrabold text-xl tracking-wide">SOLE</div>
              <div className="text-[#E0A33A] text-[10px] tracking-[0.3em] font-bold">IN THE GROW</div>
            </div>
            <div className="mt-3 text-center">
              <div className="text-white font-semibold text-sm">PRESUPUESTADOR PRO</div>
              <div className="text-[#2D8D68] text-xs mt-0.5">Sistema de Presupuestación v3</div>
            </div>
          </div>

          {/* Form */}
          <div className="px-5 sm:px-8 py-6">
            <h2 className="font-bold text-gray-900 text-lg mb-1">Iniciar sesión</h2>
            <p className="text-gray-500 text-sm mb-6">Entrá con el mismo mail y clave de SOLÉ.</p>

            {(error || errorServidor) && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error || errorServidor}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-mail" className="block text-xs font-semibold text-gray-700 mb-1.5">Mail</label>
                <input
                  id="login-mail"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@terrac.com"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#2D8D68] focus:ring-1 focus:ring-[#2D8D68] transition"
                />
              </div>
              <div>
                <label htmlFor="login-clave" className="block text-xs font-semibold text-gray-700 mb-1.5">Clave</label>
                <input
                  id="login-clave"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#2D8D68] focus:ring-1 focus:ring-[#2D8D68] transition"
                />
              </div>
              <div className="text-right -mt-2">
                <Link to="/olvide-mi-clave" className="inline-block py-2 sm:py-0 text-xs text-[#2D8D68] hover:text-[#1B5E4B] font-medium">
                  Olvidé mi clave
                </Link>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-11 bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Ingresando...
                  </>
                ) : 'Ingresar'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-400">
              Sole Presupuestador PRO · v3.0 · 2026
            </p>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
