// Draft of the "Cargar obra" screen, kept in the browser (IndexedDB) so a reload does not lose it.
// One draft per owner (user + company): another login on the same browser never sees it.
// Every call is wrapped in try/catch: if the browser refuses (private mode), the screen works as before.
import type { ObraAsignaciones } from './api'

const DB_NAME = 'presupuestador'
const STORE = 'borradores'
const PREFIJO = 'cargar-obra:'

// Who the draft belongs to: the logged-in user inside the active company
export function duenoBorrador(userId: string | null | undefined, orgId: string | null | undefined): string | null {
  return userId && orgId ? `${userId}|${orgId}` : null
}

function clave(dueno: string): string {
  return PREFIJO + dueno
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

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
}

async function conStore<T>(modo: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, modo)
      const req = op(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
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
