from __future__ import annotations

from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Budgets ──────────────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    name: str
    description: str | None = None


class BudgetResponse(BaseModel):
    id: str
    org_id: str
    name: str
    description: str | None
    source_file: str | None
    status: str
    created_at: str
    updated_at: str


# ── Budget items ─────────────────────────────────────────────────────────────

class BudgetItemCreate(BaseModel):
    parent_id: UUID | None = None
    code: str | None = None
    description: str
    unidad: str | None = None
    cantidad: float | None = None
    mat_unitario: float | None = None
    mo_unitario: float | None = None
    mat_total: float | None = None
    mo_total: float | None = None
    directo_total: float | None = None
    indirecto_total: float | None = None
    beneficio_total: float | None = None
    neto_total: float | None = None
    notas: str | None = None
    notas_calculo: str | None = None


class BudgetItemUpdate(BaseModel):
    parent_id: UUID | None = None
    code: str | None = None
    description: str | None = None
    unidad: str | None = None
    cantidad: float | None = None
    mat_unitario: float | None = None
    mo_unitario: float | None = None
    mat_total: float | None = None
    mo_total: float | None = None
    directo_total: float | None = None
    indirecto_total: float | None = None
    beneficio_total: float | None = None
    neto_total: float | None = None
    notas: str | None = None
    notas_calculo: str | None = None


# ── Analysis ─────────────────────────────────────────────────────────────────

class IndirectApplyRequest(BaseModel):
    config_id: UUID | None = None


class AnalysisResponse(BaseModel):
    budget_id: str
    mat_total: float
    mo_total: float
    directo_total: float
    indirecto_total: float
    beneficio_total: float
    neto_total: float
    items_count: int


# ── Catalogs ────────────────────────────────────────────────────────────────

class CatalogResponse(BaseModel):
    id: str
    org_id: str
    name: str
    source_file: str | None
    created_at: str


class CatalogEntryResponse(BaseModel):
    id: str
    catalog_id: str
    tipo: str | None
    codigo: str | None
    descripcion: str | None
    unidad: str | None
    precio_con_iva: float | None
    precio_sin_iva: float | None
    referencia: str | None


class ApplyCatalogResult(BaseModel):
    items_matched: int
    items_unmatched: int
    total_updated: float


# ── Budget update ──────────────────────────────────────────────────────────

class BudgetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    # Waste % for this budget. null = inherit (plantilla / organización)
    desperdicio_pct: float | None = Field(default=None, ge=0, le=100)


# ── Indirect config update ──────────────────────────────────────────────────

class IndirectConfigUpdate(BaseModel):
    estructura_pct: float | None = None
    jefatura_pct: float | None = None
    logistica_pct: float | None = None
    herramientas_pct: float | None = None
    beneficio_pct: float | None = None
    imprevistos_pct: float | None = None
    ingresos_brutos_pct: float | None = None
    imp_cheque_pct: float | None = None
    iva_pct: float | None = None
    # Default waste % for the whole organization
    desperdicio_pct: float | None = Field(default=None, ge=0, le=100)


# ── Budget copy ─────────────────────────────────────────────────────────────

class BudgetCopyRequest(BaseModel):
    name: str | None = None


# ── Versions ─────────────────────────────────────────────────────────────────

class VersionCreate(BaseModel):
    notes: str | None = None


# ── Full budget creation (step-by-step) ─────────────────────────────────────

class ItemInput(BaseModel):
    codigo: str
    descripcion: str
    unidad: str = ""
    cantidad: float = 0


class SeccionInput(BaseModel):
    codigo: str
    nombre: str
    items: list[ItemInput] = []


class IndirectConfigInput(BaseModel):
    estructura_pct: float = 0
    jefatura_pct: float = 0
    logistica_pct: float = 0
    herramientas_pct: float = 0


class CreateFullBudget(BaseModel):
    name: str
    description: str = ""
    superficie_m2: float | None = None
    duracion_meses: int | None = None
    secciones: list[SeccionInput] | None = None
    indirectos: IndirectConfigInput | None = None


class SectionCreate(BaseModel):
    codigo: str
    nombre: str


# ── CSV catalog upload ──────────────────────────────────────────────────────

CatalogTipo = Literal["material", "mano_obra", "equipo", "subcontrato"]


class CatalogEntryCreate(BaseModel):
    codigo: Optional[str] = None
    descripcion: Optional[str] = None
    unidad: Optional[str] = None
    precio_unitario: Optional[float] = 0
    tipo: Optional[str] = "material"


class CatalogEntryUpdate(BaseModel):
    codigo: Optional[str] = None
    descripcion: Optional[str] = None
    unidad: Optional[str] = None
    precio_unitario: Optional[float] = None
    tipo: Optional[str] = None


# ── Item resources CRUD ─────────────────────────────────────────────────────

class ResourceCreate(BaseModel):
    tipo: str  # material, mano_obra, equipo, subcontrato, mo_material
    codigo: Optional[str] = None
    descripcion: Optional[str] = None
    unidad: Optional[str] = None
    cantidad: Optional[float] = 0
    desperdicio_pct: Optional[float] = 0
    precio_unitario: Optional[float] = 0
    # Labor-specific
    trabajadores: Optional[float] = 0
    dias: Optional[float] = 0
    cargas_sociales_pct: Optional[float] = 25
    catalog_entry_id: Optional[str] = None
    # Recetas (Fase 2)
    lo_compra_cliente: Optional[bool] = None
    redondear: Optional[bool] = None
    unidad_compra: Optional[float] = Field(default=None, gt=0)


class ResourceUpdate(BaseModel):
    tipo: Optional[str] = None
    codigo: Optional[str] = None
    descripcion: Optional[str] = None
    unidad: Optional[str] = None
    cantidad: Optional[float] = None
    desperdicio_pct: Optional[float] = None
    precio_unitario: Optional[float] = None
    trabajadores: Optional[float] = None
    dias: Optional[float] = None
    cargas_sociales_pct: Optional[float] = None
    catalog_entry_id: Optional[str] = None
    lo_compra_cliente: Optional[bool] = None
    redondear: Optional[bool] = None
    unidad_compra: Optional[float] = Field(default=None, gt=0)


class BulkResourceCreate(BaseModel):
    resources: list[ResourceCreate]


# ── Item templates ───────────────────────────────────────────────────────────

class TemplateParam(BaseModel):
    clave: str
    valor: float
    unidad: Optional[str] = None
    descripcion: Optional[str] = None


class TemplateCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    unidad: Optional[str] = None
    categoria: Optional[str] = None
    recursos: list[dict] = []
    parametros: list[TemplateParam] = []
    # null = use the organization default
    desperdicio_pct: Optional[float] = Field(default=None, ge=0, le=100)


class TemplateUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    unidad: Optional[str] = None
    categoria: Optional[str] = None
    recursos: Optional[list[dict]] = None
    parametros: Optional[list[TemplateParam]] = None
    desperdicio_pct: Optional[float] = Field(default=None, ge=0, le=100)


class TemplatePreview(BaseModel):
    """Try a template (saved or not) with a quantity, without touching budgets."""
    cantidad: float = 1
    recursos: list[dict] = []
    parametros: list[TemplateParam] = []
    valores: dict[str, float] = {}  # parameter values to try
    desperdicio_pct: Optional[float] = None


class TemplateApply(BaseModel):
    parametros: dict[str, float] = {}  # budget values that replace the defaults


class ItemParamsUpdate(BaseModel):
    parametros: dict[str, float]
