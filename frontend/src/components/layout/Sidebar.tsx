import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutGrid, Edit3, BarChart2, Layers,
  Download, Upload, Settings, BookOpen, RefreshCw, LogOut, FilePlus2,
  ArrowLeft, Library, ClipboardCheck, CircleHelp, X, ChevronsLeft, ChevronsRight,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { rolEnPalabras } from '../../lib/roles'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { budgetApi } from '../../lib/api'
import { usePantalla } from '../../lib/pantalla'
import LogoSole from './LogoSole'

// Cómo se muestra el menú:
// - 'fijo': 224 px con íconos y nombres (1280 px o más, igual que siempre; o entre 1024 y 1279 si Sol lo agrandó)
// - 'angosto': 64 px, solo íconos con el nombre al pasar el mouse (arranca así entre 1024 y 1279 px)
// - 'cajon': debajo de 1024 px, se abre con ☰ desde la izquierda y tapa el contenido
type Modo = 'fijo' | 'angosto' | 'cajon'

const ANCHO_MENU_COMPLETO = 1280

/** ¿La ventana mide 1280 px o más? (ahí el menú va siempre completo, como siempre) */
function useAncha(): boolean {
  const consulta = `(min-width: ${ANCHO_MENU_COMPLETO}px)`
  const [ancha, setAncha] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const cambiar = () => setAncha(mq.matches)
    cambiar()
    mq.addEventListener('change', cambiar)
    return () => mq.removeEventListener('change', cambiar)
  }, [consulta])
  return ancha
}

// La elección «/» se guarda por usuario en el navegador. Si el navegador no deja guardar, arranca angosto.
function leerAngosto(clave: string): boolean {
  try {
    return window.localStorage.getItem(clave) !== '0'
  } catch {
    return true
  }
}
function guardarAngosto(clave: string, angosto: boolean) {
  try {
    window.localStorage.setItem(clave, angosto ? '1' : '0')
  } catch {
    /* sin lugar para guardar: vale solo mientras la página siga abierta */
  }
}

interface Pista {
  texto: string
  top: number
}

function NavItem({
  to, icon, label, end, modo, onElegir, onPista,
}: {
  to: string
  icon: (size: number) => ReactNode
  label: string
  end?: boolean
  modo: Modo
  onElegir?: () => void
  onPista?: (p: Pista | null) => void
}) {
  if (modo === 'angosto') {
    const mostrar = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      onPista?.({ texto: label, top: r.top + r.height / 2 })
    }
    return (
      <NavLink
        to={to}
        end={end}
        aria-label={label}
        onMouseEnter={(e) => mostrar(e.currentTarget)}
        onMouseLeave={() => onPista?.(null)}
        onFocus={(e) => mostrar(e.currentTarget)}
        onBlur={() => onPista?.(null)}
        onClick={() => onPista?.(null)}
        className={({ isActive }) =>
          `mx-auto flex items-center justify-center w-10 h-10 rounded-lg transition-colors ${
            isActive ? 'bg-[#E8F5EE] text-[#143D34] ring-1 ring-[#2D8D68]/30' : 'text-gray-500 hover:bg-[#F0FAF5] hover:text-[#143D34]'
          }`
        }
      >
        {icon(18)}
      </NavLink>
    )
  }
  if (modo === 'cajon') {
    return (
      <NavLink
        to={to}
        end={end}
        onClick={onElegir}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 min-h-11 rounded-lg text-[15px] transition-colors border-l-[3px] ${
            isActive
              ? 'bg-[#E8F5EE] border-l-[#2D8D68] text-[#143D34] font-semibold'
              : 'border-l-transparent text-gray-600 active:bg-[#E8F5EE] hover:bg-[#F0FAF5]'
          }`
        }
      >
        {icon(18)}
        {label}
      </NavLink>
    )
  }
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
      {icon(15)}
      {label}
    </NavLink>
  )
}

/** Título de un grupo del menú; en el menú angosto es solo una raya */
function Grupo({ modo, children }: { modo: Modo; children: ReactNode }) {
  if (modo === 'angosto') return <div className="border-t my-2 mx-3" />
  return (
    <>
      <div className="border-t my-2 mx-1" />
      <div className={`font-bold text-gray-400 tracking-wider mb-1 px-1 ${modo === 'cajon' ? 'text-[11px] px-2' : 'text-[10px]'}`}>
        {children}
      </div>
    </>
  )
}

export default function Sidebar({
  cajonAbierto = false,
  onCerrarCajon,
}: {
  cajonAbierto?: boolean
  onCerrarCajon?: () => void
}) {
  const { user, org, orgs, role, puedeEditar, signOut, switchOrg } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { chica } = usePantalla()
  const ancha = useAncha()

  // Menú angosto entre 1024 y 1279 px: la elección queda guardada para este usuario
  const clave = `presupuestador:menu-angosto:${user?.id ?? 'sin-usuario'}`
  const [angostoGuardado, setAngostoGuardado] = useState(() => leerAngosto(clave))
  useEffect(() => setAngostoGuardado(leerAngosto(clave)), [clave])
  const cambiarAncho = () => {
    const nuevo = !angostoGuardado
    setAngostoGuardado(nuevo)
    guardarAngosto(clave, nuevo)
    setPista(null)
  }

  const [pista, setPista] = useState<Pista | null>(null)

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

  // El cajón se cierra al cambiar de pantalla (por ejemplo, con "atrás" del celular)
  const cerrarRef = useRef(onCerrarCajon)
  cerrarRef.current = onCerrarCajon
  useEffect(() => {
    cerrarRef.current?.()
  }, [location.pathname])

  const handleSignOut = async () => {
    onCerrarCajon?.()
    await signOut()
    navigate('/login')
  }

  const orgName = org?.name ?? ''
  const initials = orgName.slice(0, 1).toUpperCase()

  if (chica) {
    if (!cajonAbierto) return null
    const modo: Modo = 'cajon'
    const elegir = () => onCerrarCajon?.()
    return (
      <Cajon onCerrar={() => onCerrarCajon?.()}>
        {(botonCerrar) => (
          <>
            {/* Logo, la empresa y la X */}
            <div className="px-4 pt-3 pb-3 border-b flex items-start gap-3">
              <LogoSole size={32} />
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="text-[#143D34] font-extrabold text-xs tracking-wide leading-tight">SOLE</div>
                <div className="text-[#9D7A32] text-[8px] tracking-[0.2em] font-bold">IN THE GROW</div>
              </div>
              {botonCerrar}
            </div>
            <div className="px-4 py-3 border-b bg-[#FAFBFC]" data-testid="cajon-empresa">
              <div className="text-[10px] font-bold text-[#2D8D68] tracking-wider flex items-center gap-1 mb-1">
                <span className="w-1.5 h-1.5 bg-[#2D8D68] rounded-full" />
                PRESUPUESTADOR PRO
              </div>
              {orgs.length > 1 ? (
                <label className="block">
                  <span className="sr-only">Empresa</span>
                  <select
                    value={org?.id ?? ''}
                    onChange={(e) => { onCerrarCajon?.(); void switchOrg(e.target.value) }}
                    aria-label="Cambiar de empresa"
                    className="w-full min-h-10 text-[#E8663C] font-semibold bg-white border border-gray-200 rounded-lg px-2.5 outline-none focus:ring-2 focus:ring-[#2D8D68]/30"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="text-[#E8663C] text-sm font-semibold truncate">{orgName}</div>
              )}
            </div>
            <MenuEntradas
              modo={modo}
              puedeEditar={puedeEditar}
              currentBudgetId={currentBudgetId}
              budgetName={budgetName}
              onElegir={elegir}
              onVolver={() => { elegir(); navigate('/app/dashboard') }}
            />
            <div className="mt-auto">
              <div className="px-4 py-3 border-t flex items-center gap-3">
                <div className="w-9 h-9 bg-[#2D8D68] rounded-full flex items-center justify-center font-bold text-white text-xs">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{orgName}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {user?.email ? `${user.email.split('@')[0]} · ` : ''}{rolEnPalabras(role)}
                  </div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full px-4 min-h-12 text-xs font-semibold text-gray-500 hover:text-gray-700 active:bg-gray-50 flex items-center gap-2 border-t transition-colors"
              >
                <LogOut size={15} />
                CERRAR SESIÓN
              </button>
            </div>
          </>
        )}
      </Cajon>
    )
  }

  const modo: Modo = !ancha && angostoGuardado ? 'angosto' : 'fijo'
  const botonAncho = !ancha && (
    <button
      type="button"
      onClick={cambiarAncho}
      data-testid="menu-ancho"
      aria-label={modo === 'angosto' ? 'Agrandar el menú' : 'Achicar el menú'}
      aria-expanded={modo !== 'angosto'}
      title={modo === 'angosto' ? 'Agrandar el menú' : 'Achicar el menú'}
      className={
        modo === 'angosto'
          ? 'mx-auto my-1 w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-[#143D34] hover:bg-[#F0FAF5] transition-colors'
          : 'mx-2 my-1 px-3 py-1.5 rounded text-[11px] text-gray-400 hover:text-[#143D34] hover:bg-[#F0FAF5] flex items-center gap-1.5 transition-colors'
      }
    >
      {modo === 'angosto' ? <ChevronsRight size={18} /> : <><ChevronsLeft size={14} /> Achicar el menú</>}
    </button>
  )

  if (modo === 'angosto') {
    const mostrar = (texto: string) => (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      setPista({ texto, top: r.top + r.height / 2 })
    }
    return (
      <aside className="w-16 bg-white border-r flex flex-col flex-shrink-0" data-modo="angosto">
        <div className="h-[53px] flex items-center justify-center border-b">
          <LogoSole size={28} />
        </div>
        {/* En una notebook baja con el proyecto abierto no entra todo: el medio del menú se desliza */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2" onScroll={() => setPista(null)}>
          <MenuEntradas
            modo={modo}
            puedeEditar={puedeEditar}
            currentBudgetId={currentBudgetId}
            budgetName={budgetName}
            onPista={setPista}
            onVolver={() => navigate('/app/dashboard')}
            mostrarPista={mostrar}
          />
        </div>
        {botonAncho}
        <div className="py-2 border-t flex justify-center">
          <div
            className="w-8 h-8 bg-[#2D8D68] rounded-full flex items-center justify-center font-bold text-white text-[10px]"
            tabIndex={0}
            aria-label={`${orgName} · ${rolEnPalabras(role)}`}
            onMouseEnter={(e) => mostrar(`${orgName} · ${rolEnPalabras(role)}`)(e.currentTarget)}
            onMouseLeave={() => setPista(null)}
            onFocus={(e) => mostrar(`${orgName} · ${rolEnPalabras(role)}`)(e.currentTarget)}
            onBlur={() => setPista(null)}
          >
            {initials}
          </div>
        </div>
        <button
          onClick={handleSignOut}
          aria-label="Cerrar sesión"
          onMouseEnter={(e) => mostrar('Cerrar sesión')(e.currentTarget)}
          onMouseLeave={() => setPista(null)}
          onFocus={(e) => mostrar('Cerrar sesión')(e.currentTarget)}
          onBlur={() => setPista(null)}
          className="h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 border-t transition-colors"
        >
          <LogOut size={15} />
        </button>
        {pista && (
          <div
            role="tooltip"
            className="fixed left-[70px] z-50 -translate-y-1/2 bg-[#143D34] text-white text-xs font-medium px-2.5 py-1.5 rounded-md shadow-lg pointer-events-none whitespace-nowrap fade-in"
            style={{ top: pista.top }}
          >
            {pista.texto}
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside className="w-56 bg-white border-r flex flex-col flex-shrink-0" data-modo="fijo">
      {/* Logo */}
      <div className="px-4 py-3 flex items-center gap-2 border-b">
        <LogoSole size={28} />
        <div>
          <div className="text-[#143D34] font-extrabold text-xs tracking-wide leading-tight">SOLE</div>
          <div className="text-[#9D7A32] text-[8px] tracking-[0.2em] font-bold">IN THE GROW</div>
        </div>
      </div>

      {/* En una notebook baja con el proyecto abierto no entra todo: el medio del menú se desliza */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        <MenuEntradas
          modo={modo}
          puedeEditar={puedeEditar}
          currentBudgetId={currentBudgetId}
          budgetName={budgetName}
          onVolver={() => navigate('/app/dashboard')}
        />
      </div>
      {botonAncho}

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
        CERRAR SESIÓN
      </button>
    </aside>
  )
}

/** Las entradas del menú, en el mismo orden en las tres formas */
function MenuEntradas({
  modo, puedeEditar, currentBudgetId, budgetName, onElegir, onVolver, onPista, mostrarPista,
}: {
  modo: Modo
  puedeEditar: boolean
  currentBudgetId: string | null
  budgetName: string | null
  onElegir?: () => void
  onVolver: () => void
  onPista?: (p: Pista | null) => void
  mostrarPista?: (texto: string) => (el: HTMLElement) => void
}) {
  const item = (to: string, icon: (s: number) => ReactNode, label: string, end?: boolean) => (
    <NavItem key={to} to={to} end={end} icon={icon} label={label} modo={modo} onElegir={onElegir} onPista={onPista} />
  )
  const angosto = modo === 'angosto'
  const cajon = modo === 'cajon'
  const proyecto = budgetName || 'Proyecto actual'

  return (
    <>
      {/* PRESUPUESTADOR PRO — always visible */}
      {angosto ? (
        <div className="pt-3" />
      ) : !cajon ? (
        <div className="px-3 pt-4 pb-1">
          <div className="text-[10px] font-bold text-[#2D8D68] tracking-wider mb-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-[#2D8D68] rounded-full" />
            PRESUPUESTADOR PRO
          </div>
        </div>
      ) : (
        <div className="pt-2" />
      )}
      <nav className={angosto ? 'space-y-1' : cajon ? 'px-2 space-y-0.5' : 'px-2 space-y-0.5 text-[13px]'}>
        {/* textos-ok: la ruta, no un texto */}
        {item('/app/dashboard', (s) => <LayoutGrid size={s} />, 'Mis presupuestos', true)}
        {puedeEditar && (
          <>
            {item('/app/cargar-obra', (s) => <ClipboardCheck size={s} />, 'Cargar obra')}
            {item('/app/new-project', (s) => <FilePlus2 size={s} />, 'Nuevo presupuesto')}
            {item('/app/import', (s) => <Upload size={s} />, 'Importar Excel')}
          </>
        )}
      </nav>

      {/* PROYECTO ACTUAL — only when inside a budget */}
      {currentBudgetId && (angosto ? (
        <div className="mx-1.5 mt-3 mb-1 py-1.5 rounded-lg bg-[#F0FAF5] border-l-[3px] border-l-[#E0A33A] space-y-1">
          <button
            onClick={onVolver}
            aria-label="Volver a Mis presupuestos"
            onMouseEnter={(e) => mostrarPista?.('Volver a Mis presupuestos')(e.currentTarget)}
            onMouseLeave={() => onPista?.(null)}
            onFocus={(e) => mostrarPista?.('Volver a Mis presupuestos')(e.currentTarget)}
            onBlur={() => onPista?.(null)}
            className="mx-auto flex items-center justify-center w-10 h-8 rounded-lg text-gray-400 hover:text-[#2D8D68] transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <ProyectoEntradas id={currentBudgetId} item={item} />
        </div>
      ) : (
        <div className={`mx-2 mt-3 mb-1 rounded-lg bg-[#F0FAF5] border-l-[3px] border-l-[#E0A33A] ${cajon ? '' : ''}`}>
          <div className="px-3 pt-3 pb-1">
            <button
              onClick={onVolver}
              title="Volver a Mis presupuestos"
              className={`flex items-center gap-1 text-gray-400 hover:text-[#2D8D68] transition-colors mb-1.5 ${
                cajon ? 'text-xs min-h-10 -ml-1 px-1' : 'text-[10px]'
              }`}
            >
              <ArrowLeft size={cajon ? 13 : 10} />
              Volver
            </button>
            <div className="text-[10px] font-bold text-[#E0A33A] tracking-wider mb-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-[#E0A33A] rounded-full" />
              PROYECTO ACTUAL
            </div>
            <div className={`font-semibold text-[#143D34] truncate mb-2 ${cajon ? 'text-sm' : 'text-[12px]'}`} title={proyecto}>
              {proyecto}
            </div>
          </div>
          <nav className={`px-1 pb-2 space-y-0.5 ${cajon ? '' : 'text-[13px]'}`}>
            <ProyectoEntradas id={currentBudgetId} item={item} />
          </nav>
        </div>
      ))}

      {/* CONFIGURACIÓN — always visible */}
      <div className={angosto ? '' : 'px-2 pb-2'}>
        <Grupo modo={modo}>CONFIGURACIÓN</Grupo>
        <nav className={angosto ? 'space-y-1' : cajon ? 'space-y-0.5' : 'space-y-0.5 text-[13px]'}>
          {item('/app/settings/markups', (s) => <Settings size={s} />, 'Coeficiente de pase')}
          {item('/app/catalogs', (s) => <BookOpen size={s} />, 'Lista de precios')}
          {item('/app/templates', (s) => <Library size={s} />, 'Fórmulas')}
        </nav>
        <Grupo modo={modo}>AYUDA</Grupo>
        <nav className={angosto ? 'space-y-1 pb-2' : cajon ? 'space-y-0.5' : 'space-y-0.5 text-[13px]'}>
          {item('/app/ayuda', (s) => <CircleHelp size={s} />, 'Ayuda')}
        </nav>
      </div>
    </>
  )
}

function ProyectoEntradas({
  id,
  item,
}: {
  id: string
  item: (to: string, icon: (s: number) => ReactNode, label: string) => ReactNode
}) {
  return (
    <>
      {item(`/app/budgets/${id}/editor`, (s) => <Edit3 size={s} />, 'Editor de obra')}
      {item(`/app/budgets/${id}/analysis`, (s) => <BarChart2 size={s} />, 'Análisis')}
      {item(`/app/budgets/${id}/ai`, (s) => <Layers size={s} />, 'Planos con IA')}
      {item(`/app/budgets/${id}/export`, (s) => <Download size={s} />, 'Exportar')}
      {item(`/app/budgets/${id}/versions`, (s) => <RefreshCw size={s} />, 'Versiones')}
    </>
  )
}

/**
 * El cajón del celular: tapa el contenido desde la izquierda. Se cierra con la X, con Esc o tocando afuera;
 * el foco queda adentro mientras está abierto y vuelve a ☰ al cerrarlo.
 */
function Cajon({ onCerrar, children }: { onCerrar: () => void; children: (botonCerrar: ReactNode) => ReactNode }) {
  const panelRef = useRef<HTMLElement>(null)
  const cerrarBtnRef = useRef<HTMLButtonElement>(null)

  const teclas = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCerrar()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const enfocables = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, [tabindex="0"]')
      if (!enfocables.length) return
      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    },
    [onCerrar],
  )

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    cerrarBtnRef.current?.focus()
    document.addEventListener('keydown', teclas)
    return () => {
      document.removeEventListener('keydown', teclas)
      // vuelve al botón ☰ (o a donde estaba)
      const menu = document.querySelector<HTMLElement>('[data-testid="abrir-menu"]')
      ;(menu ?? antes)?.focus?.()
    }
  }, [teclas])

  const botonCerrar = (
    <button
      ref={cerrarBtnRef}
      type="button"
      onClick={onCerrar}
      aria-label="Cerrar el menú"
      data-testid="cerrar-menu"
      className="-mr-1.5 w-10 h-10 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors"
    >
      <X size={20} />
    </button>
  )

  return (
    <div className="fixed inset-0 z-[60]" data-testid="cajon-menu">
      <div className="absolute inset-0 bg-[#0F2A24]/45 cajon-fondo" onClick={onCerrar} data-testid="cajon-fondo" aria-hidden="true" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        className="absolute inset-y-0 left-0 w-[86vw] max-w-[320px] bg-white shadow-2xl flex flex-col overflow-y-auto overscroll-contain cajon-panel"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children(botonCerrar)}
      </aside>
    </div>
  )
}
