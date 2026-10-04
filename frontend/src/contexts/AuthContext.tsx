import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getOrgActual, meApi, setOrgActual } from '../lib/api'
import type { Me, OrgResumen, Rol } from '../types'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true'

interface AuthContextType {
  user: User | null
  session: Session | null
  // Hasta tener la sesión y los datos de /me
  loading: boolean
  orgs: OrgResumen[]
  // Empresa activa
  org: OrgResumen | null
  role: Rol | null
  needsOrgSelect: boolean
  error: string
  // admin o leader
  puedeEditar: boolean
  esAdmin: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  switchOrg: (orgId: string) => Promise<void>
  // Vuelve a pedir /me
  reload: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* sin almacenamiento: se sigue igual */
  }
}
function storageRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nada */
  }
}

const orgKey = (userKey: string) => `presu_org_${userKey}`

// El servidor responde "403: {"detail":"..."}": nos quedamos con el texto
function textoDelServidor(e: unknown): { status: number | null; texto: string } {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/^(\d{3}):\s*([\s\S]*)$/)
  if (!m) return { status: null, texto: msg }
  let texto = m[2]
  try {
    const j = JSON.parse(m[2]) as { detail?: unknown; mensaje?: unknown }
    if (typeof j.detail === 'string') texto = j.detail
    else if (typeof j.mensaje === 'string') texto = j.mensaje
  } catch {
    /* no era JSON */
  }
  return { status: Number(m[1]), texto }
}

const SIN_EMPRESA = 'Tu usuario no pertenece a ninguna empresa. Pedile al administrador que te invite.'

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [orgs, setOrgs] = useState<OrgResumen[]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [role, setRole] = useState<Rol | null>(null)
  const [needsOrgSelect, setNeedsOrgSelect] = useState(false)
  const [error, setError] = useState('')
  // Para qué usuario ya se pidió /me (null = hay que pedirlo)
  const [meKey, setMeKey] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // Sin sesión de Supabase (modo demo) igual se pide /me
  const userId = user?.id ?? null
  const userKey = userId ?? 'anon'
  // ?org=<uuid> de la URL: manda en la primera carga
  const urlOrg = useRef(new URLSearchParams(window.location.search).get('org'))
  const forceLoad = useRef(false)
  const seq = useRef(0)
  const wantedOrg = useRef<string | null>(null)

  // ─── Sesión de Supabase ───────────────────────────────────────────────────
  useEffect(() => {
    const apply = (s: Session | null) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.access_token) storageSet('sb-auth-token', s.access_token)
      else storageRemove('sb-auth-token')
      setAuthLoading(false)
    }
    supabase.auth.getSession().then(({ data: { session } }) => apply(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => apply(session))
    return () => subscription.unsubscribe()
  }, [])

  const limpiar = useCallback(() => {
    setOrgs([])
    setOrgId(null)
    setRole(null)
    setNeedsOrgSelect(false)
    setOrgActual(null)
  }, [])

  const cerrarSesion = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      /* igual se limpia lo local */
    }
    storageRemove('sb-auth-token')
    limpiar()
  }, [limpiar])

  // ─── Empresas: GET /me ────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return
    if (AUTH_ENABLED && !userId) {
      limpiar()
      setMeKey(userKey)
      return
    }
    // En /nueva-clave se espera: no cerrar la sesión de recuperación a mitad de camino
    if (!forceLoad.current && window.location.pathname.startsWith('/nueva-clave')) {
      setMeKey(userKey)
      return
    }
    forceLoad.current = false
    const mine = ++seq.current


    async function pedirMe(candidata: string | null): Promise<Me> {
      if (candidata) setOrgActual(candidata)
      else setOrgActual(null)
      return meApi.get()
    }

    async function cargar() {
      if (userId) {
        // Convierte las invitaciones pendientes del mail en membresías
        await Promise.resolve(supabase.rpc('accept_my_invitations')).catch(() => {})
      }
      // Primero la empresa de ESTA pestaña (sessionStorage), después la última elegida por el usuario
      const candidata = wantedOrg.current || urlOrg.current || getOrgActual() || storageGet(orgKey(userKey))
      try {
        let me: Me
        try {
          me = await pedirMe(candidata)
        } catch (e) {
          // La empresa guardada ya no sirve (403 con empresa): se prueba sin ella
          if (candidata && textoDelServidor(e).status === 403) me = await pedirMe(null)
          else throw e
        }
        if (mine !== seq.current) return
        let activa = me.org_id
        let rol = me.role
        if (!activa && me.orgs.length === 1) {
          activa = me.orgs[0].id
          rol = me.orgs[0].role
        }
        setOrgs(me.orgs)
        setOrgId(activa)
        setRole(rol)
        setNeedsOrgSelect(!activa && me.orgs.length > 1)
        if (activa) {
          setOrgActual(activa)
          storageSet(orgKey(userKey), activa)
        } else {
          setOrgActual(null)
        }
        wantedOrg.current = null
        urlOrg.current = null
        setError('')
      } catch (e) {
        if (mine !== seq.current) return
        const { status, texto } = textoDelServidor(e)
        limpiar()
        if (status === 404 && !AUTH_ENABLED) {
          // Servidor viejo sin /me (el frontend se publica solo; Render se despliega a mano):
          // en modo demo se sigue como antes, con la empresa de DEMO_ORG_ID
          const demo: OrgResumen = { id: 'demo', name: 'TERRAC SA', slug: 'demo', role: 'admin' }
          setOrgs([demo])
          setOrgId(demo.id)
          setRole(demo.role)
          setOrgActual(null)
          setError('')
        } else if (status === 403) {
          setError(texto || SIN_EMPRESA)
          if (userId) await cerrarSesion()
        } else if (status === 401) {
          setError('Tu sesión venció. Entrá de nuevo.')
          if (userId) await cerrarSesion()
        } else {
          setError('No pudimos conectar con el servidor. Probá de nuevo en un rato.')
        }
      } finally {
        if (mine === seq.current) setMeKey(userKey)
      }
    }
    void cargar()
  }, [authLoading, userId, userKey, tick, limpiar, cerrarSesion])

  const reload = useCallback(async () => {
    forceLoad.current = true
    setMeKey(null)
    setTick((t) => t + 1)
  }, [])

  const signIn = async (email: string, password: string) => {
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signOut = async () => {
    seq.current++
    setError('')
    await cerrarSesion()
    setMeKey(null)
    setTick((t) => t + 1)
  }

  const switchOrg = async (nuevaId: string) => {
    storageSet(orgKey(userKey), nuevaId)
    setOrgActual(nuevaId)
    wantedOrg.current = nuevaId
    forceLoad.current = true
    setMeKey(null)
    setTick((t) => t + 1)
    navigate('/app/dashboard')
  }

  const clearError = useCallback(() => setError(''), [])

  const org = orgs.find((o) => o.id === orgId) ?? null
  const loading = authLoading || (!(AUTH_ENABLED && !userId) && meKey !== userKey)
  const puedeEditar = role === 'admin' || role === 'leader'
  const esAdmin = role === 'admin'

  return (
    <AuthContext.Provider
      value={{
        user, session, loading, orgs, org, role, needsOrgSelect, error,
        puedeEditar, esAdmin, signIn, signOut, switchOrg, reload, clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
