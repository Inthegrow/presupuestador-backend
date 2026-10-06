import type {
  Budget,
  BudgetItem,
  ItemResource,
  ItemAudit,
  PriceCatalog,
  CatalogEntry,
  AnalysisResponse,
  IndirectConfig,
  BudgetVersion,
  TreeNode,
  AIAnalysisResult,
  AIItemToInsert,
  CascadeResult,
  PriceUpdateResult,
  TemplateParam,
  TemplatePreviewResponse,
  TemplateResource,
  Me,
} from '../types'

const BASE_URL = (import.meta.env.VITE_API_URL as string) || '/api'

function getToken(): string | null {
  return localStorage.getItem('sb-auth-token')
}

// Empresa activa de ESTA pestaña. Viaja en cada pedido como X-Org-Id.
// Vive en memoria y en sessionStorage (por pestaña): cambiar de empresa en otra pestaña
// no puede hacer que esta guarde datos en una empresa distinta de la que muestra (Codex, PR #27).
// La preferencia "última empresa elegida" por usuario sí va en localStorage, la maneja AuthContext.
export const ORG_ACTUAL_KEY = 'presu_org_actual'
let orgActual: string | null = null

export function setOrgActual(id: string | null) {
  orgActual = id
  try {
    if (id) sessionStorage.setItem(ORG_ACTUAL_KEY, id)
    else sessionStorage.removeItem(ORG_ACTUAL_KEY)
  } catch {
    /* sin almacenamiento: queda en memoria */
  }
}

export function getOrgActual(): string | null {
  if (orgActual) return orgActual
  try {
    orgActual = sessionStorage.getItem(ORG_ACTUAL_KEY)
  } catch {
    orgActual = null
  }
  return orgActual
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const orgId = getOrgActual()
  if (orgId) headers['X-Org-Id'] = orgId
  return headers
}

// ─── Aviso de servidor lento ───────────────────────────────────────────────────
// A request that takes more than 4 s fires 'api:lento'; when it ends, 'api:respondio'.
// The counter of slow requests in flight keeps the banner from flickering.
const LENTO_MS = 4000
let pedidosLentos = 0

export function hayPedidosLentos(): boolean {
  return pedidosLentos > 0
}

async function conAviso<T>(run: () => Promise<T>): Promise<T> {
  let lento = false
  const timer = setTimeout(() => {
    lento = true
    pedidosLentos++
    window.dispatchEvent(new CustomEvent('api:lento'))
  }, LENTO_MS)
  try {
    return await run()
  } finally {
    clearTimeout(timer)
    if (lento) {
      pedidosLentos = Math.max(0, pedidosLentos - 1)
      window.dispatchEvent(new CustomEvent('api:respondio'))
    }
  }
}

// Error de la API con el estado HTTP y, si el servidor mandó JSON, su `detail` ya interpretado.
// El mensaje sigue siendo `${status}: ${texto}`, como antes, para no romper a quien lo muestra tal cual.
export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, text: string) {
    super(`${status}: ${text}`)
    this.name = 'ApiError'
    this.status = status
    let detail: unknown = text
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) detail = (parsed as { detail: unknown }).detail
    } catch {
      /* no era JSON: detail queda como texto */
    }
    this.detail = detail
  }
}

function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return conAviso(async () => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new ApiError(res.status, text)
    }
    return res.json() as Promise<T>
  })
}

function postFile<T>(path: string, formData: FormData): Promise<T> {
  return conAviso(async () => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...authHeaders() },
      body: formData,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  })
}

function getBlob(path: string): Promise<Blob> {
  return conAviso(async () => {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { ...authHeaders() },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.blob()
  })
}

function get<T>(path: string) {
  return request<T>('GET', path)
}
function post<T>(path: string, body?: unknown) {
  return request<T>('POST', path, body)
}
function patch<T>(path: string, body?: unknown) {
  return request<T>('PATCH', path, body)
}
function del<T>(path: string) {
  return request<T>('DELETE', path)
}

// ─── Usuario y empresas ────────────────────────────────────────────────────────

export const meApi = {
  get: () => get<Me>('/me'),
}

// ─── Budget API ────────────────────────────────────────────────────────────────

export const budgetApi = {
  list: () => get<Budget[]>('/budgets'),
  create: (data: Partial<Budget>) => post<Budget>('/budgets', data),
  get: (id: string) => get<Budget>(`/budgets/${id}`),
  update: (id: string, data: Partial<Budget>) => patch<Budget>(`/budgets/${id}`, data),
  remove: (id: string) => del<void>(`/budgets/${id}`),

  // Sections
  createSection: (id: string, data: { codigo: string; nombre: string }) =>
    post<BudgetItem>(`/budgets/${id}/sections`, data),

  // Items
  getItems: (id: string) => get<BudgetItem[]>(`/budgets/${id}/items`),
  createItem: (id: string, data: Partial<BudgetItem>) =>
    post<BudgetItem>(`/budgets/${id}/items`, [data]),
  updateItem: (budgetId: string, itemId: string, data: Partial<BudgetItem>) =>
    patch<BudgetItem>(`/budgets/${budgetId}/items/${itemId}`, data),
  deleteItem: (budgetId: string, itemId: string) =>
    del<void>(`/budgets/${budgetId}/items/${itemId}`),

  // Resources
  getItemResources: (budgetId: string, itemId: string) =>
    get<ItemResource[]>(`/budgets/${budgetId}/items/${itemId}/resources`),

  createResource: (budgetId: string, itemId: string, data: Partial<ItemResource>) =>
    post<ItemResource>(`/budgets/${budgetId}/items/${itemId}/resources`, data),

  updateResource: (budgetId: string, itemId: string, resourceId: string, data: Partial<ItemResource>) =>
    patch<ItemResource>(`/budgets/${budgetId}/items/${itemId}/resources/${resourceId}`, data),

  deleteResource: (budgetId: string, itemId: string, resourceId: string) =>
    del<void>(`/budgets/${budgetId}/items/${itemId}/resources/${resourceId}`),

  // Materiales sin precio, calculado por el servidor sobre los recursos guardados
  preciosFaltantes: (budgetId: string, itemId: string) =>
    get<{ precios_faltantes: PrecioFaltante[] }>(`/budgets/${budgetId}/items/${itemId}/precios-faltantes`),

  // Full recalculation: formulas, inherited waste, purchase rounding, indirects
  cascadeRecalculate: (budgetId: string) =>
    post<CascadeResult>(`/budgets/${budgetId}/cascade-recalculate`),

  // Recipe parameters of one item (ej. espesor)
  updateItemParams: (budgetId: string, itemId: string, parametros: Record<string, number>) =>
    patch<{ parametros: Record<string, number>; resources_updated: number }>(
      `/budgets/${budgetId}/items/${itemId}/parametros`,
      { parametros },
    ),

  // Audits
  getItemAudits: (budgetId: string, itemId: string) =>
    get<ItemAudit[]>(`/budgets/${budgetId}/items/${itemId}/audits`),

  // Tree / Full
  getTree: (id: string) => get<TreeNode[]>(`/budgets/${id}/tree`),
  getFull: (id: string) => get<{ budget: Budget; tree: TreeNode[] }>(`/budgets/${id}/full`),

  // Recalculate / Copy
  recalculate: (id: string) => post<Budget>(`/budgets/${id}/recalculate`),
  copy: (id: string) => post<Budget>(`/budgets/${id}/copy`),

  // Excel import/export
  importExcel: (formData: FormData) => postFile<{ budget_id: string; budget_name: string; items_inserted: number; resources_inserted: number; catalog_entries: number; date_codes_corrected: number; catalog_id: string | null; catalog_reused: boolean; catalog_name: string | null; precios_actualizados: number; precios_nuevos: number }>('/budgets/import-excel', formData),
  exportExcel: (id: string) => getBlob(`/budgets/${id}/export/excel`),
  // vista 'cliente': PDF con el precio de venta por trabajo, sin costos internos
  exportPdf: (id: string, vista?: 'cliente') =>
    getBlob(`/budgets/${id}/export/pdf${vista ? `?vista=${vista}` : ''}`),

  // AI Plan analysis
  analyzePlan: (id: string, formData: FormData) =>
    postFile<AIAnalysisResult>(`/budgets/${id}/analyze-plan`, formData),
  addItemsFromAI: (id: string, items: AIItemToInsert[]) =>
    post<{ inserted: number; sections_created: number }>(`/budgets/${id}/items/from-ai`, { items }),

  // Indirects
  getIndirects: (id: string) => get<IndirectConfig>(`/budgets/${id}/indirects`),
  updateIndirects: (id: string, data: Partial<IndirectConfig>) =>
    patch<IndirectConfig>(`/budgets/${id}/indirects`, data),
  // Valores generales (con los que arranca cada obra nueva)
  getGeneralIndirects: () => get<IndirectConfig>('/indirects/general'),
  updateGeneralIndirects: (data: Partial<IndirectConfig>) =>
    patch<IndirectConfig>('/indirects/general', data),
  applyIndirects: (id: string) =>
    post<{ items_updated: number; total_neto: number }>(`/budgets/${id}/indirects`),

  // Analysis
  getAnalysis: (id: string) => get<AnalysisResponse>(`/budgets/${id}/analysis`),

  // Create full budget (wizard)
  createFull: (data: {
    name: string
    description?: string
    sections?: { nombre: string; items: { descripcion: string; unidad: string; cantidad: number }[] }[]
    indirects?: { estructura_pct: number; jefatura_pct: number; logistica_pct: number; herramientas_pct: number }
  }) => post<{ budget_id: string; sections_created: number; items_created: number }>('/budgets/create-full', data),

  // Versions
  getVersions: (id: string) => get<BudgetVersion[]>(`/budgets/${id}/versions`),
  createVersion: (id: string) => post<BudgetVersion>(`/budgets/${id}/versions`),
  // Toma el último precio de cada recurso, recalcula y guarda una versión nueva
  updatePrices: (id: string, fecha?: string) =>
    post<PriceUpdateResult>(`/budgets/${id}/actualizar-precios`, fecha ? { fecha } : {}),
  getVersion: (id: string, vid: string) => get<BudgetVersion>(`/budgets/${id}/versions/${vid}`),
}

// ─── Template API ──────────────────────────────────────────────────────────────

export interface PrecioFaltante {
  codigo: string
  descripcion: string | null
  motivo: string
}

export interface TemplateApplyResult {
  resources_created: number
  item_updated: boolean
  precios_faltantes?: PrecioFaltante[]
}

// Detalle del 409 cuando la unidad de la fórmula no coincide con la del trabajo y no se mandó `factor`
export interface FaltaConversion {
  codigo: 'FALTA_CONVERSION'
  mensaje: string
  unidad_formula: string
  unidad_trabajo: string
  factor_propuesto: number | null
}

export function esFaltaConversion(err: unknown): err is ApiError & { detail: FaltaConversion } {
  if (!(err instanceof ApiError) || err.status !== 409) return false
  const d = err.detail as { codigo?: unknown } | null
  return !!d && typeof d === 'object' && d.codigo === 'FALTA_CONVERSION'
}

// Detalle del 409 cuando el trabajo ya tiene recursos y no se mandó `reemplazar: true`
export interface ConfirmarReemplazo {
  codigo: 'CONFIRMAR_REEMPLAZO'
  mensaje: string
  recursos: number
}

/** 500 de aplicar una fórmula: NO_SE_APLICO (quedó como estaba) o A_MEDIAS (falló también la restauración). */
export interface FalloAplicar {
  codigo: 'NO_SE_APLICO' | 'A_MEDIAS'
  mensaje: string
}

export function esFalloAplicar(err: unknown): err is ApiError & { detail: FalloAplicar } {
  if (!(err instanceof ApiError)) return false
  const d = err.detail as { codigo?: unknown } | null
  return !!d && typeof d === 'object' && (d.codigo === 'NO_SE_APLICO' || d.codigo === 'A_MEDIAS')
}

export function esConfirmarReemplazo(err: unknown): err is ApiError & { detail: ConfirmarReemplazo } {
  if (!(err instanceof ApiError) || err.status !== 409) return false
  const d = err.detail as { codigo?: unknown } | null
  return !!d && typeof d === 'object' && d.codigo === 'CONFIRMAR_REEMPLAZO'
}

// Fórmula que la app sugiere para el nombre de un trabajo (GET /templates/sugerir)
export interface TemplateSugerida {
  id: string
  codigo: string
  nombre: string
  unidad?: string | null
  categoria?: string | null
  porque?: string | null
}

export interface TemplatePropuesta extends TemplateSugerida {
  origen: 'memoria' | 'regla'
  factor: number | null
}

export interface TemplateParecida extends TemplateSugerida {
  puntaje?: number
}

export interface TemplateSugerencias {
  propuesta: TemplatePropuesta | null
  parecidas: TemplateParecida[]
}

export const templateApi = {
  sugerir: (descripcion: string, unidad?: string | null) =>
    get<TemplateSugerencias>(
      `/templates/sugerir?descripcion=${encodeURIComponent(descripcion)}&unidad=${encodeURIComponent(unidad || '')}`,
    ),
  list: (categoria?: string) =>
    get<any[]>(`/templates${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ''}`),
  categories: () => get<string[]>('/templates/categories'),
  get: (id: string) => get<any>(`/templates/${id}`),
  create: (data: any) => post<any>('/templates', data),
  update: (id: string, data: any) => patch<any>(`/templates/${id}`, data),
  remove: (id: string) => del<{ ok: boolean }>(`/templates/${id}`),
  apply: (
    templateId: string,
    budgetId: string,
    itemId: string,
    opts?: { parametros?: Record<string, number>; factor?: number; reemplazar?: boolean },
  ) =>
    post<TemplateApplyResult>(
      `/templates/${templateId}/apply/${budgetId}/items/${itemId}`,
      opts && (opts.parametros || opts.factor !== undefined || opts.reemplazar !== undefined) ? opts : undefined,
    ),
  preview: (data: {
    cantidad: number
    recursos: TemplateResource[]
    parametros: TemplateParam[]
    valores?: Record<string, number>
    desperdicio_pct?: number | null
  }) => post<TemplatePreviewResponse>('/templates/preview', data),
}

// ─── Cargar obra (Excel de la obra + fórmulas del Maestro) ──────────────────────

export interface ObraPrecio {
  codigo: string
  descripcion?: string
  unidad?: string
  tipo: string
  problema: 'sin_precio' | 'duplicado' | 'no_esta'
  motivo: string
  recursos: number
  items: string[]
  entradas: ObraEntrada[]
  // Entradas de catálogos "solo consulta" con el mismo código (más nueva primero, máx. 5)
  referencias: ObraEntrada[]
  // Lo que trae el Excel de la obra para este código
  propuesta: ObraPropuesta | null
  // Dónde conviene crear el código si no está (solo con catálogo oficial)
  catalogo_destino: { id: string; name: string } | null
}

export interface ObraEntrada {
  id: string
  catalog_id: string
  catalogo?: string
  codigo: string
  descripcion?: string
  unidad?: string
  tipo?: string
  precio_sin_iva?: number | null
  fecha_precio?: string | null
}

export interface ObraPropuesta {
  codigo: string
  descripcion?: string
  unidad?: string
  tipo: string
  precio: number
  fecha: string | null
  proveedor: string | null
  // Aclaración, si hace falta ("figura como precio con IVA")
  nota: string | null
  origen: 'detalle' | 'lista'
  hoja: string
  trabajo: string | null
  otros: { precio: number; hoja: string }[]
}

export interface ObraReceta {
  codigo: string
  nombre: string
  unidad?: string
  partes: { codigo: string; nombre: string; unidad?: string; factor: number }[]
  origen: 'memoria' | 'regla' | 'manual'
  porque?: string
}

export interface ObraPregunta {
  tipo: 'cantidad_por_unidad'
  texto: string
  receta: string
  unidad_receta: string
  unidad_obra: string
  valor: number | null
  // Frase para mostrar la conversión como dato ya resuelto (null si falta el valor)
  dato: string | null
  // De dónde salió el valor (null si todavía no hay)
  origen_valor: 'nombre' | 'regla' | 'memoria' | 'mano' | null
}

export interface ObraTarea {
  clave: string
  descripcion: string
  unidad?: string
  veces: number
  cantidad_total: number
  total_excel: number
  codigos: string[]
  estado: 'verde' | 'amarillo' | 'rojo'
  // Why a red task is red (null when it is not red)
  motivo_rojo?: 'receta_inexistente' | 'pregunta' | 'sin_receta' | 'precio' | null
  receta: ObraReceta | null
  sugerencias: { codigo: string; nombre: string; unidad?: string; porque?: string }[]
  pregunta: ObraPregunta | null
  avisos: string[]
  precios_faltantes: string[]
}

export interface ObraRecetaCatalogo {
  codigo: string
  nombre: string
  unidad?: string
  categoria?: string
}

export interface ObraAnalisis {
  archivo: string
  titulo: string
  // true si el título del Excel no se parece al nombre del archivo
  titulo_dudoso: boolean
  fecha_precios: string
  catalogo_oficial: boolean
  // false when no item of the Excel has a cost (it came only with quantities)
  excel_con_precios: boolean
  resumen: {
    rubros: number
    pisos: number
    trabajos: number
    grupos: number
    verdes: number
    amarillos: number
    rojos: number
    total_excel: number
  }
  tareas: ObraTarea[]
  precios: ObraPrecio[]
  recetas: ObraRecetaCatalogo[]
  correcciones_excel: string[]
  listo: boolean
}

export interface ObraCarga {
  budget_id: string
  nombre: string
  items: number
  con_receta: number
  recursos: number
  precios_en_cero: number
  total_excel: number
  resumen?: { directo_total: number; neto_total: number }
  memoria_guardada?: number
  // Trabajos amarillos que entraron sin que Sol los confirmara
  sin_confirmar?: { total: number; con_receta: number; sin_receta: number; claves: string[] }
  // Segundos que tardó cada etapa del servidor
  tiempos?: { analisis_s: number; items_s: number; recursos_s: number; cascada_s: number; total_s: number }
}

export interface ObraDiferenciaItem {
  id: string
  code: string | null
  piso: string | null
  cantidad: number
  app_neto: number
  excel_neto: number
  diferencia: number
  app_directo: number
  excel_directo: number
  diferencia_directo: number
}

export interface ObraDiferenciaTrabajo {
  clave: string
  descripcion: string
  unidad: string | null
  veces: number
  cantidad_total: number
  receta: { codigo: string; nombre: string } | null
  sin_receta: boolean
  app_neto: number
  excel_neto: number
  diferencia: number
  diferencia_pct: number | null
  app_directo: number
  excel_directo: number
  app_unitario: number | null
  excel_unitario: number | null
  diferencia_directo: number
  diferencia_directo_pct: number | null
  margen_app_pct: number | null
  margen_excel_pct: number | null
  app_unitario_directo: number | null
  excel_unitario_directo: number | null
  items: ObraDiferenciaItem[]
}

export interface ObraDiferencias {
  budget_id: string
  nombre: string
  precios_al: string | null
  source_file: string | null
  total: {
    app_neto: number
    excel_neto: number
    diferencia: number
    diferencia_pct: number | null
    app_directo: number
    excel_directo: number
    diferencia_directo: number
    diferencia_directo_pct: number | null
    margen_app_pct: number | null
    margen_excel_pct: number | null
  }
  resumen: {
    trabajos: number
    mas_caros: number
    mas_baratos: number
    parecidos: number
    sin_receta: number
    directo: { mas_caros: number; mas_baratos: number; parecidos: number }
  }
  trabajos: ObraDiferenciaTrabajo[]
}

// Lo que Sol decidió por trabajo: { clave: { plantillas: [[codigo, factor], ...], confirmada? } } ([] = sin fórmula)
export type ObraAsignaciones = Record<string, { plantillas: [string, number][]; confirmada?: boolean }>

function obraForm(file: File, asignaciones: ObraAsignaciones, extra: Record<string, string> = {}) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('asignaciones', JSON.stringify(asignaciones))
  for (const [k, v] of Object.entries(extra)) formData.append(k, v)
  return formData
}

export const obraApi = {
  analizar: (file: File, asignaciones: ObraAsignaciones) =>
    postFile<ObraAnalisis>('/obras/analizar', obraForm(file, asignaciones)),
  cargar: (file: File, asignaciones: ObraAsignaciones, nombre: string, permitirSinPrecio: boolean) =>
    postFile<ObraCarga>(
      '/obras/cargar',
      obraForm(file, asignaciones, { nombre, permitir_sin_precio: String(permitirSinPrecio) }),
    ),
  diferencias: (budgetId: string) => get<ObraDiferencias>(`/obras/${budgetId}/diferencias`),
}

// ─── Catalog API ───────────────────────────────────────────────────────────────

export const catalogApi = {
  list: () => get<PriceCatalog[]>('/catalogs'),
  getEntries: (id: string) => get<CatalogEntry[]>(`/catalogs/${id}/entries`),
  search: (id: string, q: string) =>
    get<CatalogEntry[]>(`/catalogs/${id}/search?q=${encodeURIComponent(q)}`),
  apply: (budgetId: string, catalogId: string) =>
    post<{ items_matched: number; items_unmatched: number; total_updated: number }>(`/catalogs/apply/${budgetId}/${catalogId}`),
  setOficial: (id: string, oficial: boolean) => patch<PriceCatalog>(`/catalogs/${id}`, { oficial }),
  deleteCatalog: (id: string) => del<any>(`/catalogs/${id}`),
  createEntry: (catalogId: string, data: any) =>
    post<any>(`/catalogs/${catalogId}/entries`, data),
  updateEntry: (catalogId: string, entryId: string, data: any) =>
    patch<any>(`/catalogs/${catalogId}/entries/${entryId}`, data),
  deleteEntry: (catalogId: string, entryId: string) =>
    del<any>(`/catalogs/${catalogId}/entries/${entryId}`),
  uploadCsv: (name: string, tipo: string, file: File) => {
    const formData = new FormData()
    formData.append('name', name)
    formData.append('tipo', tipo)
    formData.append('file', file)
    return postFile<any>('/catalogs/upload', formData)
  },
  uploadExcel: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return postFile<{ catalogs_created: number; entries: Record<string, number>; warnings: string[]; source_file: string }>('/catalogs/upload-excel', formData)
  },
}
