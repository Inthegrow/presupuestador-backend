export interface Budget {
  id: string
  org_id: string
  name: string
  description?: string
  source_file?: string
  status: string
  created_at: string
  updated_at: string
  desperdicio_pct?: number | null // null = hereda (plantilla / organización)
  indirectos?: Record<string, number> // % propios de la obra ({} = usa los generales)
  precios_al?: string | null // fecha de los precios (YYYY-MM-DD)
}

export interface BudgetItem {
  id: string
  budget_id: string
  org_id: string
  parent_id?: string
  code?: string
  description?: string
  unidad?: string
  cantidad?: number
  mat_unitario: number
  mo_unitario: number
  eq_unitario?: number
  mat_ind_unitario?: number
  sub_unitario?: number
  mat_total: number
  mo_total: number
  eq_total?: number
  mat_ind_total?: number
  sub_total?: number
  directo_total: number
  indirecto_total: number
  beneficio_total: number
  impuestos_total?: number
  neto_total: number
  iva_total?: number
  total_final?: number
  notas?: string
  notas_calculo?: string
  sort_order: number
  children?: BudgetItem[]
  // Fórmulas (Fase 2)
  template_id?: string | null
  parametros?: Record<string, number>
}

export interface ItemResource {
  id: string
  item_id: string
  org_id: string
  tipo: 'material' | 'mano_obra' | 'equipo' | 'subcontrato' | 'mo_material'
  codigo: string | null
  descripcion: string | null
  unidad: string | null
  cantidad: number
  desperdicio_pct: number
  cantidad_efectiva: number
  precio_unitario: number
  subtotal: number
  // Labor-specific
  trabajadores: number
  dias: number
  cargas_sociales_pct: number
  // Catalog link
  catalog_entry_id: string | null
  // Fórmulas (Fase 2)
  formula?: string | null
  rendimiento?: string | null
  desperdicio_origen?: 'recurso' | 'presupuesto' | 'plantilla' | 'organizacion' | null
  lo_compra_cliente?: boolean
  redondear?: boolean
  unidad_compra?: number
  cantidad_redondeo?: number
}

export interface PriceCatalog {
  id: string
  org_id: string
  name: string
  source_file?: string
  created_at: string
  oficial: boolean
}

export interface CatalogEntry {
  id: string
  catalog_id: string
  tipo: string
  codigo?: string
  descripcion?: string
  unidad?: string
  precio_con_iva?: number
  precio_sin_iva?: number
  fecha_precio?: string | null
  proveedor?: string | null
}

export interface AnalysisResponse {
  mat_total: number
  mo_total: number
  directo_total: number
  indirecto_total: number
  beneficio_total: number
  impuestos_total?: number
  neto_total: number
  iva_total?: number
  total_final?: number
  items_count: number
}

export interface CostSummary {
  mat_total: number
  mo_total: number
  directo_total: number
  indirecto_total: number
  beneficio_total: number
  impuestos_total?: number
  neto_total: number
  iva_total?: number
  total_final?: number
}

export interface IndirectConfig {
  id: string
  org_id: string
  estructura_pct: number
  jefatura_pct: number
  logistica_pct: number
  herramientas_pct: number
  beneficio_pct?: number
  imprevistos_pct?: number
  ingresos_brutos_pct?: number
  imp_cheque_pct?: number
  iva_pct?: number
  desperdicio_pct?: number | null // desperdicio general de la organización
  general?: Partial<IndirectConfig> // valores generales, para comparar
  propios?: boolean // true = la obra tiene sus propios %
}

export interface BudgetVersion {
  id: string
  budget_id: string
  version: number
  data: unknown
  created_at: string
  precios_al?: string | null
  notas?: string | null
}

export interface PriceUpdateResult extends CascadeResult {
  precios_al: string
  precios_al_anterior: string | null
  precios_actualizados: number
  version_anterior: { version_id: string; version: number }
  version_nueva: { version_id: string; version: number }
  sin_precio: { codigo: string | null; descripcion: string | null; motivo: 'sin_precio' | 'duplicado' }[]
}

export interface ItemAudit {
  id: string
  item_id: string
  budget_id: string
  org_id: string
  user_id: string
  field: string
  old_value: string | null
  new_value: string | null
  source: string
  created_at: string
}

export type TreeNode = BudgetItem & { children: TreeNode[] }

// ─── AI Plan Analysis ─────────────────────────────────────────────────────────

export interface AIProyecto {
  descripcion: string
  superficie_total_m2: number
  ambientes_detectados: string[]
}

export interface AITemplateMatch {
  id: string
  nombre: string
  score: number
  recursos: any[]
}

export interface AIItem {
  codigo: string
  descripcion: string
  unidad: string
  cantidad: number
  confianza: 'alta' | 'media' | 'baja'
  notas: string
  notas_calculo: string
  recursos?: {
    materiales?: any[]
    mano_obra?: any[]
    equipos?: any[]
    mo_materiales?: any[]
    subcontratos?: any[]
  }
  template_match?: AITemplateMatch
}

export interface AISeccion {
  codigo: string
  nombre: string
  items: AIItem[]
}

export interface AIAnalysisResult {
  budget_id: string
  proyecto: AIProyecto
  secciones: AISeccion[]
  total_items: number
  catalog_loaded?: boolean
  templates_available?: number
}

export interface AIItemToInsert {
  seccion_nombre: string
  seccion_codigo: string
  codigo: string
  descripcion: string
  unidad: string
  cantidad: number
  notas: string
  notas_calculo: string
  recursos?: {
    materiales?: any[]
    mano_obra?: any[]
    equipos?: any[]
    mo_materiales?: any[]
    subcontratos?: any[]
  }
}

// ─── Item templates (fórmulas) ─────────────────────────────────────────────────

export interface TemplateParam {
  clave: string
  valor: number | string // string while editing
  unidad?: string
  descripcion?: string
}

/** Resource inside a template. Number fields may be strings while editing. */
export interface TemplateResource {
  tipo: 'material' | 'mano_obra' | 'equipo' | 'subcontrato' | 'mo_material'
  codigo?: string
  descripcion?: string
  unidad?: string
  formula?: string // Q = cantidad del ítem
  desperdicio_pct?: number | string | null // vacío = hereda
  lo_compra_cliente?: boolean
  redondear?: boolean
  unidad_compra?: number | string
  // Mano de obra: días = Q / rendimiento
  trabajadores?: number | string
  rendimiento?: number | string
  cargas_sociales_pct?: number | string
  // Formato anterior
  cantidad_por_unidad?: number
  trabajadores_por_unidad?: number
  dias_por_unidad?: number
}

export interface Template {
  id: string
  org_id: string
  nombre: string
  descripcion?: string
  unidad?: string
  categoria?: string
  desperdicio_pct?: number | null
  parametros?: TemplateParam[] | string
  recursos: TemplateResource[] | string
}

export interface TemplatePreviewRow {
  tipo: string
  codigo?: string
  descripcion?: string
  unidad?: string
  cantidad: number
  trabajadores: number
  dias: number
  desperdicio_pct: number
  desperdicio_origen?: string | null
  cantidad_efectiva: number
  lo_compra_cliente: boolean
  redondear: boolean
  unidad_compra: number
}

export interface TemplatePreviewResponse {
  ok: boolean
  errores: string[]
  recursos: TemplatePreviewRow[]
  parametros?: Record<string, number>
  desperdicio_organizacion?: number | null
}

export interface RoundingLine {
  codigo?: string
  descripcion?: string
  unidad?: string
  unidad_compra: number
  cantidad_necesaria: number
  cantidad_compra: number
  envases: number
  extra: number
  costo_extra: number
  items: number
}

export interface CascadeResult {
  items_total: number
  items_updated: number
  resources_updated: number
  redondeos: RoundingLine[]
  errores: string[]
}

// ─── Usuario, empresas y roles (GET /me) ───────────────────────────────────────

export type Rol = 'admin' | 'leader' | 'member'

export interface OrgResumen {
  id: string
  name: string
  slug: string
  role: Rol
}

export interface Me {
  user_id: string
  email: string
  // Null cuando tiene varias empresas y todavía no eligió una
  org_id: string | null
  role: Rol | null
  orgs: OrgResumen[]
}
