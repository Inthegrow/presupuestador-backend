import { Plus } from 'lucide-react'
import { rolEnPalabras } from '../../lib/roles'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

const AI_ICON = (
  <svg width="18" height="18" viewBox="0 0 512 512" fill="none">
    <path
      d="M256 72C170.947 72 102 140.947 102 226C102 311.053 170.947 380 256 380C316.134 380 368.215 345.533 393.832 295.282"
      stroke="#E0A33A" strokeWidth="28" strokeLinecap="round"
    />
    <circle cx="390" cy="179" r="28" fill="#E0A33A" />
  </svg>
)

export default function TopBar() {
  const { user, org, orgs, role, puedeEditar, switchOrg } = useAuth()
  const navigate = useNavigate()

  const orgName = org?.name ?? ''
  const displayName = user?.email?.split('@')[0]?.toUpperCase() || 'CS'
  const initials = displayName.slice(0, 2)

  return (
    <header className="bg-white border-b flex items-center justify-between px-4 h-14 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[#2D8D68]">
          <LayoutGridIcon />
        </div>
        <div>
          <div className="font-bold text-gray-900 text-sm tracking-tight">PRESUPUESTADOR PRO</div>
          {orgs.length > 1 ? (
            <select
              value={org?.id ?? ''}
              onChange={(e) => void switchOrg(e.target.value)}
              aria-label="Cambiar de empresa"
              className="text-[#E8663C] text-[10px] font-semibold bg-transparent -ml-0.5 pr-1 outline-none cursor-pointer hover:bg-gray-50 rounded"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          ) : (
            <div className="text-[#E8663C] text-[10px] font-semibold">{orgName}</div>
          )}
        </div>
      </div>

      {/* Center AI icon */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="w-9 h-9 bg-gradient-to-br from-[#2D8D68] to-[#1B5E4B] rounded-full flex items-center justify-center">
            {AI_ICON}
          </div>
          <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
          <div className="absolute -bottom-1 -right-1 bg-[#E8663C] text-white text-[7px] font-bold px-1 rounded">IA</div>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {puedeEditar && (
          <button
            onClick={() => navigate('/app/import')}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} />
            NUEVO
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="text-right leading-tight hidden sm:block">
            <div className="text-xs font-semibold text-gray-700">{displayName}</div>
            <div className="text-[10px] text-gray-400">{rolEnPalabras(role)}</div>
          </div>
          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600">
            {initials}
          </div>
        </div>
      </div>
    </header>
  )
}

function LayoutGridIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}
