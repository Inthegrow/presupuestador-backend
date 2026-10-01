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
} from '../types'

const BASE_URL = (import.meta.env.VITE_API_URL as string) || '/api'

function getToken(): string | null {
  return localStorage.getItem('sb-auth-token')
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function postFile<T>(path: string, formData: FormData): Promise<T> {
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
}

async function getBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.blob()
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
  importExcel: (formData: FormData) => postFile<{ budget_id: string; budget_name: string; items_inserted: number; resources_inserted: number; catalog_entries: number; date_codes_corrected: number }>('/budgets/import-excel', formData),
  exportExcel: (id: string) => getBlob(`/budgets/${id}/export/excel`),
  exportPdf: (id: string) => getBlob(`/budgets/${id}/export/pdf`),

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

export const templateApi = {
  list: (categoria?: string) =>
    get<any[]>(`/templates${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ''}`),
  categories: () => get<string[]>('/templates/categories'),
  get: (id: string) => get<any>(`/templates/${id}`),
  create: (data: any) => post<any>('/templates', data),
  update: (id: string, data: any) => patch<any>(`/templates/${id}`, data),
  remove: (id: string) => del<{ ok: boolean }>(`/templates/${id}`),
  apply: (templateId: string, budgetId: string, itemId: string, parametros?: Record<string, number>) =>
    post<{ resources_created: number; item_updated: boolean }>(
      `/templates/${templateId}/apply/${budgetId}/items/${itemId}`,
      parametros ? { parametros } : undefined,
    ),
  preview: (data: {
    cantidad: number
    recursos: TemplateResource[]
    parametros: TemplateParam[]
    valores?: Record<string, number>
    desperdicio_pct?: number | null
  }) => post<TemplatePreviewResponse>('/templates/preview', data),
}

// ─── Cargar obra (Excel de la obra + recetas del Maestro) ──────────────────────

export interface ObraPrecio {
  codigo: string
  descripcion?: string
  unidad?: string
  tipo: string
  problema: 'sin_precio' | 'duplicado' | 'no_esta'
  motivo: string
  recursos: number
  items: string[]
  entradas: {
    id: string
    catalog_id: string
    catalogo?: string
    codigo: string
    descripcion?: string
    unidad?: string
    tipo?: string
    precio_sin_iva?: number | null
    fecha_precio?: string | null
  }[]
}

export interface ObraReceta {
  codigo: string
  nombre: string
  unidad?: string
  partes: { codigo: string; nombre: string; unidad?: string; factor: number }[]
  origen: 'memoria' | 'regla' | 'sugerida' | 'manual'
  porque?: string
}

export interface ObraPregunta {
  tipo: 'cantidad_por_unidad'
  texto: string
  receta: string
  unidad_receta: string
  unidad_obra: string
  valor: number | null
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
  fecha_precios: string
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
}

// Lo que Sol decidió por trabajo: { clave: { plantillas: [[codigo, factor], ...], confirmada? } } ([] = sin receta)
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
}

// ─── Catalog API ───────────────────────────────────────────────────────────────

export const catalogApi = {
  list: () => get<PriceCatalog[]>('/catalogs'),
  getEntries: (id: string) => get<CatalogEntry[]>(`/catalogs/${id}/entries`),
  search: (id: string, q: string) =>
    get<CatalogEntry[]>(`/catalogs/${id}/search?q=${encodeURIComponent(q)}`),
  apply: (budgetId: string, catalogId: string) =>
    post<{ items_matched: number; items_unmatched: number; total_updated: number }>(`/catalogs/apply/${budgetId}/${catalogId}`),
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
