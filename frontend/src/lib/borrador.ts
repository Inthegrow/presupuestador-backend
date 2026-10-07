// Drafts kept in the browser (IndexedDB) so a reload or closing the screen does not lose the work:
// "Cargar obra" (guardarBorrador / leerBorrador / borrarBorrador) and the "Nuevo presupuesto" wizard
// (the generic *BorradorDe functions, with their own key). One draft per screen and owner (user + company):
// another login on the same browser never sees it.
// Every call is wrapped in try/catch: if the browser refuses (private mode), the screen works as before.
import type { ObraAsignaciones } from './api'
import { fmtDate } from './format'

const DB_NAME = 'presupuestador'
const STORE = 'borradores'
const PREFIJO = 'cargar-obra:'

// Who the draft belongs to: the logged-in user inside the active company
export function duenoBorrador(userId: string | null | undefined, orgId: string | null | undefined): string | null {
  return userId && orgId ? `${userId}|${orgId}` : null
}

function clave(dueno: string, prefijo = PREFIJO): string {
  return prefijo + dueno
}

export interface PendienteBorrador {
  codigo: string
  nombre: string
  unidad: string
}

export interface Borrador {
  archivo: Blob
  nombreArchivo: string
  nombre: string
  asignaciones: ObraAsignaciones
  pendientes: Record<string, PendienteBorrador>
  permitir: boolean
  // ISO date of the last save
  guardadoEn: string
}

// One connection, opened once and kept: a save started while the tab is closing (pagehide) has to reach
// the store in the same turn, without waiting for another open
let conexion: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  if (conexion) return conexion
  conexion = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      // another tab upgrading the database, or the browser closing it: open again next time
      db.onversionchange = () => {
        db.close()
        conexion = null
      }
      db.onclose = () => {
        conexion = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
  conexion.catch(() => {
    conexion = null
  })
  return conexion
}

async function conStore<T>(modo: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir()
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, modo)
    const req = op(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Writes go one after the other, so a late save can never undo a delete
let cola: Promise<unknown> = Promise.resolve()
function encolar(tarea: () => Promise<unknown>) {
  cola = cola.then(tarea, tarea).catch(() => undefined)
  return cola
}

export async function guardarBorrador(dueno: string, b: Borrador): Promise<void> {
  await encolar(async () => {
    try {
      await conStore('readwrite', (s) => s.put(b, clave(dueno)))
    } catch {
      /* no storage: the draft is simply not kept */
    }
  })
}

export async function borrarBorrador(dueno: string): Promise<void> {
  await encolar(async () => {
    try {
      await conStore('readwrite', (s) => s.delete(clave(dueno)))
    } catch {
      /* nothing to do */
    }
  })
}

export async function leerBorrador(dueno: string): Promise<Borrador | null> {
  try {
    await cola
    const b = await conStore<Borrador | undefined>('readonly', (s) => s.get(clave(dueno)))
    if (!b || !(b.archivo instanceof Blob) || typeof b.nombreArchivo !== 'string') return null
    return {
      archivo: b.archivo,
      nombreArchivo: b.nombreArchivo,
      nombre: typeof b.nombre === 'string' ? b.nombre : '',
      asignaciones: b.asignaciones && typeof b.asignaciones === 'object' ? b.asignaciones : {},
      pendientes: b.pendientes && typeof b.pendientes === 'object' ? b.pendientes : {},
      permitir: !!b.permitir,
      guardadoEn: typeof b.guardadoEn === 'string' ? b.guardadoEn : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ─── Drafts of other screens (same store, one key per screen) ────────────────────

export type PantallaBorrador = 'nuevo-presupuesto'

export async function guardarBorradorDe<T>(pantalla: PantallaBorrador, dueno: string, valor: T): Promise<void> {
  await encolar(async () => {
    try {
      await conStore('readwrite', (s) => s.put(valor, clave(dueno, `${pantalla}:`)))
    } catch {
      /* no storage: the draft is simply not kept */
    }
  })
}

export async function borrarBorradorDe(pantalla: PantallaBorrador, dueno: string): Promise<void> {
  await encolar(async () => {
    try {
      await conStore('readwrite', (s) => s.delete(clave(dueno, `${pantalla}:`)))
    } catch {
      /* nothing to do */
    }
  })
}

/** The saved draft, checked by `validar` (it returns null for anything that does not look like one). */
export async function leerBorradorDe<T>(
  pantalla: PantallaBorrador, dueno: string, validar: (crudo: unknown) => T | null,
): Promise<T | null> {
  try {
    await cola
    const crudo = await conStore<unknown>('readonly', (s) => s.get(clave(dueno, `${pantalla}:`)))
    return crudo == null ? null : validar(crudo)
  } catch {
    return null
  }
}

/** "hace 5 minutos", "ayer" or the date: when a draft was saved */
export function haceCuanto(iso: string, ahora = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const min = Math.floor((ahora.getTime() - d.getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const mismoDia = d.toDateString() === ahora.toDateString()
  if (mismoDia) {
    const h = Math.floor(min / 60)
    return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`
  }
  const ayer = new Date(ahora)
  ayer.setDate(ayer.getDate() - 1)
  if (d.toDateString() === ayer.toDateString()) return 'ayer'
  return fmtDate(iso.slice(0, 10))
}
