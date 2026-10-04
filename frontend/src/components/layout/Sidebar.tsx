import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutGrid, Edit3, BarChart2, Layers,
  Download, Upload, Settings, BookOpen, RefreshCw, LogOut, Plus,
  ArrowLeft, Library, ClipboardCheck,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { rolEnPalabras } from '../../lib/roles'
import { useEffect, useState } from 'react'
import { budgetApi } from '../../lib/api'

const SOLE_LOGO = (
  <svg width="28" height="28" viewBox="0 0 512 512" fill="none">
    <path
      d="M256 72C170.947 72 102 140.947 102 226C102 311.053 170.947 380 256 380C316.134 380 368.215 345.533 393.832 295.282"
      stroke="#E0A33A" strokeWidth="28" strokeLinecap="round"
    />
    <circle cx="390" cy="179" r="28" fill="#E0A33A" />
    <path
      d="M251 334V250C251 221.768 273.768 199 302 199H319"
      stroke="#143D34" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"
    />
    <path
      d="M251 280C216.14 280 188 251.86 188 217V206C222.86 206 251 234.14 251 269V280Z"
      fill="#2D8D68"
    />
    <path
      d="M257 248C257 209.34 288.34 178 327 178H338C338 216.66 306.66 248 268 248H257Z"
      fill="#2D8D68"
    />
  </svg>
)

function NavItem({
  to, icon, label, end,
}: {
  to: string
  icon: React.ReactNode
  label: string
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded text-[13px] transition-all border-l-[3px] ${
          isActive
            ? 'bg-[#E8F5EE] border-l-[#2D8D68] text-[#143D34] font-semibold'
            : 'border-l-transparent text-gray-500 hover:bg-[#F0FAF5]'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

export default function Sidebar() {
  const { user, org, role, puedeEditar, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Detect if we're inside a budget
  const budgetMatch = location.pathname.match(/\/app\/budgets\/([^/]+)/)
  const currentBudgetId = budgetMatch ? budgetMatch[1] : null

  // Fetch budget name when inside a budget
  const [budgetName, setBudgetName] = useState<string | null>(null)
  useEffect(() => {
    if (!currentBudgetId) {
      setBudgetName(null)
      return
    }
    budgetApi.get(currentBudgetId)
      .then((b) => setBudgetName(b.name || 'Proyecto actual'))
      .catch(() => setBudgetName('Proyecto actual'))
  }, [currentBudgetId])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const orgName = org?.name ?? ''
  const initials = orgName.slice(0, 1).toUpperCase()

  return (
    <aside className="w-56 bg-white border-r flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-4 py-3 flex items-center gap-2 border-b">
        {SOLE_LOGO}
        <div>
          <div className="text-[#143D34] font-extrabold text-xs tracking-wide leading-tight">SOLE</div>
          <div className="text-[#9D7A32] text-[8px] tracking-[0.2em] font-bold">IN THE GROW</div>
        </div>
      </div>

      {/* PRESUPUESTADOR PRO — always visible */}
      <div className="px-3 pt-4 pb-1">
        <div className="text-[10px] font-bold text-[#2D8D68] tracking-wider mb-1.5 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-[#2D8D68] rounded-full" />
          PRESUPUESTADOR PRO
        </div>
      </div>
      <nav className="px-2 space-y-0.5 text-[13px]">
        <NavItem to="/app/dashboard" end icon={<LayoutGrid size={15} />} label="Mis Presupuestos" />
        {puedeEditar && (
          <>
            <NavItem to="/app/new-project" icon={<Plus size={15} />} label="+ Nuevo Presupuesto" />
            <NavItem to="/app/cargar-obra" icon={<ClipboardCheck size={15} />} label="Cargar obra (con recetas)" />
            <NavItem to="/app/import" icon={<Upload size={15} />} label="Importar Excel" />
          </>
        )}
      </nav>

      {/* PROYECTO ACTUAL — only when inside a budget */}
      {currentBudgetId && (
        <div className="mx-2 mt-3 mb-1 rounded-lg bg-[#F0FAF5] border-l-[3px] border-l-[#E0A33A]">
          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => navigate('/app/dashboard')}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-[#2D8D68] transition-colors mb-1.5"
            >
              <ArrowLeft size={10} />
              Volver
            </button>
            <div className="text-[10px] font-bold text-[#E0A33A] tracking-wider mb-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-[#E0A33A] rounded-full" />
              PROYECTO ACTUAL
            </div>
            <div className="text-[12px] font-semibold text-[#143D34] truncate mb-2" title={budgetName || 'Proyecto actual'}>
              {budgetName || 'Proyecto actual'}
            </div>
          </div>
          <nav className="px-1 pb-2 space-y-0.5 text-[13px]">
            <NavItem to={`/app/budgets/${currentBudgetId}/editor`} icon={<Edit3 size={15} />} label="Editor de Obra" />
            <NavItem to={`/app/budgets/${currentBudgetId}/analysis`} icon={<BarChart2 size={15} />} label="Analisis" />
            <NavItem to={`/app/budgets/${currentBudgetId}/ai`} icon={<Layers size={15} />} label="IA + Planos" />
            <NavItem to={`/app/budgets/${currentBudgetId}/export`} icon={<Download size={15} />} label="Exportar" />
            <NavItem to={`/app/budgets/${currentBudgetId}/versions`} icon={<RefreshCw size={15} />} label="Versiones" />
          </nav>
        </div>
      )}

      {/* CONFIGURACIÓN — always visible */}
      <div className="px-2 flex-1 overflow-y-auto">
        <div className="border-t my-2 mx-1" />
        <div className="text-[10px] font-bold text-gray-400 tracking-wider mb-1 px-1">CONFIGURACION</div>
        <nav className="space-y-0.5 text-[13px]">
          <NavItem to="/app/settings/markups" icon={<Settings size={15} />} label="Cadena de Markups" />
          <NavItem to="/app/catalogs" icon={<BookOpen size={15} />} label="Catalogos" />
          <NavItem to="/app/templates" icon={<Library size={15} />} label="Templates" />
        </nav>
      </div>

      {/* User */}
      <div className="p-3 border-t flex items-center gap-2">
        <div className="w-8 h-8 bg-[#2D8D68] rounded-full flex items-center justify-center font-bold text-white text-[10px]">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-gray-800 truncate">{orgName}</div>
          <div className="text-[10px] text-gray-400 truncate">
            {user?.email ? `${user.email.split('@')[0]} · ` : ''}{rolEnPalabras(role)}
          </div>
        </div>
      </div>
      <button
        onClick={handleSignOut}
        className="px-4 py-2 text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1.5 border-t transition-colors"
      >
        <LogOut size={13} />
        CERRAR SESION
      </button>
    </aside>
  )
}
