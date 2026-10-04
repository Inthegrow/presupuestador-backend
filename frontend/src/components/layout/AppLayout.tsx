import { Navigate, Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useAuth } from '../../contexts/AuthContext'
import ElegirEmpresa from '../../pages/ElegirEmpresa'
import ServidorDespertando from './ServidorDespertando'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true'

function AppLayoutContenido() {
  const { user, loading, org, needsOrgSelect, error, reload } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500 font-medium">Cargando...</span>
        </div>
      </div>
    )
  }

  // Sin clave no se ve nada (solo con VITE_AUTH_ENABLED=true; en modo demo no hay sesión)
  if (AUTH_ENABLED && !user) {
    return <Navigate to="/login" replace />
  }

  // Varias empresas y todavía no eligió una
  if (needsOrgSelect) {
    return <ElegirEmpresa />
  }

  // No se pudo saber con qué empresa trabaja: sin eso no se muestra nada
  if (!org) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center px-4">
        <div className="bg-white border rounded-2xl shadow-sm max-w-md w-full px-8 py-8 text-center">
          <p className="text-sm text-gray-700 mb-5">
            {error || 'No pudimos saber con qué empresa trabajás.'}
          </p>
          <button
            onClick={() => void reload()}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            Probar de nuevo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {/* Con otra empresa los datos son otros: se vuelve a armar la pantalla */}
        <main key={org.id} className="flex-1 overflow-y-auto bg-[#F5F6F8]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// The strip lives outside the content so it also shows while the session is loading
export default function AppLayout() {
  return (
    <>
      <ServidorDespertando />
      <AppLayoutContenido />
    </>
  )
}
