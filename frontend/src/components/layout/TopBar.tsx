import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Menu, Plus } from 'lucide-react'
import { rolEnPalabras } from '../../lib/roles'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { FORMAS_DE_EMPEZAR } from './formasDeEmpezar'
import LogoSole from './LogoSole'

const AI_ICON = (
  <svg width="18" height="18" viewBox="0 0 512 512" fill="none">
    <path
      d="M256 72C170.947 72 102 140.947 102 226C102 311.053 170.947 380 256 380C316.134 380 368.215 345.533 393.832 295.282"
      stroke="#E0A33A" strokeWidth="28" strokeLinecap="round"
    />
    <circle cx="390" cy="179" r="28" fill="#E0A33A" />
  </svg>
)

// En el celular: ☰, el logo chico, la IA, NUEVO como "+" y el avatar. La empresa va dentro del cajón.
// Entre 768 y 1023 px: ☰ y la barra completa. Desde 1024 px: igual que siempre.
export default function TopBar({ onAbrirMenu }: { onAbrirMenu?: () => void }) {
  const { user, org, orgs, role, puedeEditar, switchOrg } = useAuth()
  const navigate = useNavigate()

  const orgName = org?.name ?? ''
  const displayName = user?.email?.split('@')[0]?.toUpperCase() || 'CS'
  const initials = displayName.slice(0, 2)

  return (
    <header className="bg-white border-b flex items-center justify-between gap-2 pl-1.5 pr-3 md:px-4 h-14 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-1.5 md:gap-3 min-w-0">
        {onAbrirMenu && (
          <button
            type="button"
            onClick={onAbrirMenu}
            aria-label="Abrir el menú"
            data-testid="abrir-menu"
            className="lg:hidden w-10 h-10 -mr-0.5 rounded-lg flex items-center justify-center text-[#143D34] hover:bg-gray-100 active:bg-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D8D68]/40"
          >
            <Menu size={22} />
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/app/dashboard')}
          aria-label="Ir a Mis presupuestos"
          className="md:hidden w-10 h-10 rounded-lg flex items-center justify-center"
        >
          <LogoSole size={30} />
        </button>
        <div className="hidden md:flex items-center gap-1.5 text-[#2D8D68]">
          <LayoutGridIcon />
        </div>
        <div className="hidden md:block min-w-0">
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
        <div className="relative" aria-label="Asistente con IA" role="img">
          <div className="w-9 h-9 bg-gradient-to-br from-[#2D8D68] to-[#1B5E4B] rounded-full flex items-center justify-center">
            {AI_ICON}
          </div>
          <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
          <div className="absolute -bottom-1 -right-1 bg-[#E8663C] text-white text-[7px] font-bold px-1 rounded">IA</div>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 md:gap-3">
        {puedeEditar && <MenuNuevo onElegir={(ruta) => navigate(ruta)} />}
        <div className="flex items-center gap-2">
          <div className="text-right leading-tight hidden sm:block">
            <div className="text-xs font-semibold text-gray-700">{displayName}</div>
            <div className="text-[10px] text-gray-400">{rolEnPalabras(role)}</div>
          </div>
          <div
            className="w-9 h-9 md:w-8 md:h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600"
            title={`${displayName} · ${rolEnPalabras(role)}`}
          >
            {initials}
          </div>
        </div>
      </div>
    </header>
  )
}

// Green "NUEVO" button: a small menu with the three ways to start (Cargar obra, Nuevo presupuesto, Importar Excel).
// Keyboard: Enter/Space/↓ open it on the first option, ↑/↓ move, Escape closes it and goes back to the button.
function MenuNuevo({ onElegir }: { onElegir: (ruta: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const cajaRef = useRef<HTMLDivElement>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const opcionesRef = useRef<(HTMLButtonElement | null)[]>([])

  const enfocar = (i: number) => {
    const n = FORMAS_DE_EMPEZAR.length
    opcionesRef.current[((i % n) + n) % n]?.focus()
  }
  const cerrar = (volverAlBoton: boolean) => {
    setAbierto(false)
    if (volverAlBoton) botonRef.current?.focus()
  }

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  const abrir = (foco: number | null) => {
    setAbierto(true)
    if (foco !== null) requestAnimationFrame(() => enfocar(foco))
  }

  const teclaBoton = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      abrir(0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      abrir(FORMAS_DE_EMPEZAR.length - 1)
    } else if (e.key === 'Escape' && abierto) {
      e.preventDefault()
      cerrar(true)
    }
  }
  const teclaOpcion = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); enfocar(i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); enfocar(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); enfocar(0) }
    else if (e.key === 'End') { e.preventDefault(); enfocar(FORMAS_DE_EMPEZAR.length - 1) }
    else if (e.key === 'Escape') { e.preventDefault(); cerrar(true) }
    else if (e.key === 'Tab') setAbierto(false)
  }

  return (
    <div className="relative" ref={cajaRef}>
      <button
        ref={botonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls="menu-nuevo"
        onClick={() => (abierto ? cerrar(false) : abrir(null))}
        onKeyDown={teclaBoton}
        data-testid="boton-nuevo"
        className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold w-10 h-10 justify-center rounded-full shadow-sm md:shadow-none md:w-auto md:h-auto md:px-4 md:py-1.5 md:rounded-lg text-xs flex items-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D8D68]/40 focus-visible:ring-offset-1"
      >
        <Plus size={14} className="hidden md:block" />
        <Plus size={22} strokeWidth={2.5} className="md:hidden" aria-hidden="true" />
        <span className="sr-only md:not-sr-only">NUEVO</span>
        <ChevronDown size={13} className={`hidden md:block transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div className="md:hidden fixed inset-x-0 top-14 bottom-0 bg-[#0F2A24]/25 z-40 cajon-fondo" onClick={() => cerrar(false)} aria-hidden="true" />
      )}
      {abierto && (
        <div
          id="menu-nuevo"
          role="menu"
          aria-label="Formas de empezar un presupuesto"
          className="fixed inset-x-3 top-[60px] md:absolute md:inset-x-auto md:top-auto md:right-0 md:mt-2 md:w-80 bg-white rounded-xl border border-gray-100 shadow-xl md:shadow-lg p-1.5 z-50 fade-in"
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold text-gray-400 tracking-wider">¿CÓMO QUERÉS EMPEZAR?</div>
          {FORMAS_DE_EMPEZAR.map((f, i) => (
            <button
              key={f.clave}
              ref={(el) => { opcionesRef.current[i] = el }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => { setAbierto(false); onElegir(f.ruta) }}
              onKeyDown={(e) => teclaOpcion(e, i)}
              className="w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-lg hover:bg-[#F0FAF5] focus:bg-[#E8F5EE] focus:outline-none transition-colors"
            >
              <span className="w-8 h-8 rounded-lg bg-[#E8F5EE] text-[#2D8D68] flex items-center justify-center flex-shrink-0">
                <f.Icono size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#143D34]">{f.titulo}</span>
                <span className="block text-xs text-gray-500 leading-snug">{f.linea}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
