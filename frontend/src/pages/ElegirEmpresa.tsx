import { ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { rolEnPalabras } from '../lib/roles'
import AuthCard from '../components/layout/AuthCard'

// Pantalla completa: el usuario tiene varias empresas y todavía no eligió una
export default function ElegirEmpresa() {
  const { orgs, switchOrg, signOut } = useAuth()

  return (
    <AuthCard title="¿Con qué empresa entrás?" subtitle="Después podés cambiar desde la barra de arriba.">
      <div className="space-y-2.5">
        {orgs.map((o) => (
          <button
            key={o.id}
            onClick={() => switchOrg(o.id)}
            className="w-full flex items-center gap-3 text-left border border-gray-200 hover:border-[#2D8D68] hover:bg-[#F0FAF5] rounded-xl px-4 py-3.5 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-[#143D34] text-[#E0A33A] font-bold flex items-center justify-center flex-shrink-0">
              {o.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900 text-sm truncate">{o.name}</div>
              <div className="text-xs text-gray-500">{rolEnPalabras(o.role)}</div>
            </div>
            <ChevronRight size={16} className="text-gray-300 group-hover:text-[#2D8D68]" />
          </button>
        ))}
      </div>
      <button
        onClick={() => void signOut()}
        className="mt-5 w-full text-center text-xs text-gray-400 hover:text-gray-600"
      >
        Salir
      </button>
    </AuthCard>
  )
}
