import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  GripVertical,
  Image,
  FileJson,
  Sparkles,
  ClipboardList,
  Link,
  AlertTriangle,
  Check,
  RotateCcw,
  History,
} from 'lucide-react'
import { ApiError, budgetApi, catalogApi } from '../lib/api'
import type { CreateFullPayload } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { AIItemToInsert, PriceCatalog } from '../types'
import FileUpload from '../components/ui/FileUpload'
import GenericTaskSelector, { seleccionInicial, trabajosElegidos } from '../components/ui/GenericTaskSelector'
import type { SelectionState } from '../components/ui/GenericTaskSelector'
import { CLAVES_INDIRECTOS, cascadaIndirectos, indirectosCompletos } from '../lib/cascada'
import type { ClaveIndirecto, IndirectosPct } from '../lib/cascada'
import { fmtDate, todayIso } from '../lib/format'
import { borrarBorradorDe, duenoBorrador, guardarBorradorDe, haceCuanto, leerBorradorDe } from '../lib/borrador'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ProjectData {
  name: string
  description: string
}

interface SectionItem {
  id: string
  descripcion: string
  unidad: string
  cantidad: string
}

interface Section {
  id: string
  nombre: string
  items: SectionItem[]
}

type StructureOption = 'template' | 'plan' | 'manual' | 'json'

// Lo que Sol escribe en cada % (texto, para poder borrar y volver a escribir)
type IndirectosTexto = Record<ClaveIndirecto, string>

interface AIReviewItem {
  _key: string
  seccion_nombre: string
  seccion_codigo: string
  codigo: string
  descripcion: string
  unidad: string
  cantidad: number
  notas: string
  notas_calculo: string
  recursos?: AIItemToInsert['recursos']
  template_match?: {
    id: string
    nombre: string
    score: number
    recursos: unknown[]
  }
  accepted: boolean
}

// Presupuesto ya creado mientras Sol revisa lo que encontró la IA en el plano
interface Pendiente {
  budgetId: string
  sectionsCount: number
  itemsCount: number
}

type Secciones = CreateFullPayload['secciones']

interface Resultado {
  budgetId: string
  sectionsCount: number
  itemsCount: number
  // Algo que no salió (ej. la IA no pudo leer el plano) aunque el presupuesto quedó creado
  aviso?: string
}

// Work in progress kept in this browser (lib/borrador.ts), so closing the wizard halfway loses nothing
interface BorradorNuevo {
  paso: number
  project: ProjectData
  structureOption: StructureOption
  seleccion: SelectionState
  sections: Section[]
  jsonSections: Section[]
  json: Blob | null
  jsonNombre: string
  plan: Blob | null
  planNombre: string
  indirectos: IndirectosTexto | null
  // ISO date of the last save
  guardadoEn: string
}

const OPCIONES_ESTRUCTURA: StructureOption[] = ['template', 'plan', 'manual', 'json']

function esRubros(x: unknown): x is Section[] {
  return Array.isArray(x) && x.every((r) => r && typeof r === 'object' && typeof r.nombre === 'string' && Array.isArray(r.items))
}

function leerBorradorNuevo(crudo: unknown): BorradorNuevo | null {
  if (!crudo || typeof crudo !== 'object') return null
  const b = crudo as Partial<BorradorNuevo>
  if (!b.project || typeof b.project.name !== 'string' || typeof b.project.description !== 'string') return null
  if (!b.seleccion || typeof b.seleccion !== 'object' || !esRubros(b.sections) || !esRubros(b.jsonSections)) return null
  return {
    paso: typeof b.paso === 'number' ? b.paso : PASO_DATOS,
    project: { name: b.project.name, description: b.project.description },
    structureOption: OPCIONES_ESTRUCTURA.includes(b.structureOption as StructureOption) ? b.structureOption as StructureOption : 'template',
    seleccion: b.seleccion,
    sections: b.sections,
    jsonSections: b.jsonSections,
    json: b.json instanceof Blob ? b.json : null,
    jsonNombre: typeof b.jsonNombre === 'string' ? b.jsonNombre : '',
    plan: b.plan instanceof Blob ? b.plan : null,
    planNombre: typeof b.planNombre === 'string' ? b.planNombre : '',
    indirectos: b.indirectos && typeof b.indirectos === 'object' ? b.indirectos : null,
    guardadoEn: typeof b.guardadoEn === 'string' ? b.guardadoEn : new Date().toISOString(),
  }
}

// Only an admin can delete a budget: an editor cannot undo one already created
function esSinPermiso(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403
}

// The steps, as pills like "Cargar obra" (1 Subir · 2 Revisar · 3 Cargar)
const STEPS = ['Datos', 'Trabajos', 'Indirectos', 'Listo']
const PASO_DATOS = 0
const PASO_ESTRUCTURA = 1
const PASO_INDIRECTOS = 2
const PASO_RESULTADO = 3

const NOMBRE_INDIRECTO: Record<ClaveIndirecto, string> = {
  imprevistos_pct: 'Imprevistos',
  estructura_pct: 'Estructura',
  jefatura_pct: 'Jefatura',
  logistica_pct: 'Logística',
  herramientas_pct: 'Herramientas',
  beneficio_pct: 'Beneficio',
  ingresos_brutos_pct: 'Ingresos Brutos',
  imp_cheque_pct: 'Impuesto al cheque',
  iva_pct: 'IVA',
}

const GRUPOS_INDIRECTOS: { titulo: string; nota: string; claves: ClaveIndirecto[] }[] = [
  {
    titulo: 'Indirectos',
    nota: 'sobre el costo directo',
    claves: ['imprevistos_pct', 'estructura_pct', 'jefatura_pct', 'logistica_pct', 'herramientas_pct'],
  },
  { titulo: 'Beneficio', nota: 'sobre directo + indirectos', claves: ['beneficio_pct'] },
  { titulo: 'Impuestos', nota: 'sobre el subtotal con beneficio', claves: ['ingresos_brutos_pct', 'imp_cheque_pct'] },
  { titulo: 'IVA', nota: 'sobre el precio sin IVA', claves: ['iva_pct'] },
]

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function numero(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function aTexto(pct: IndirectosPct): IndirectosTexto {
  const out = {} as IndirectosTexto
  for (const k of CLAVES_INDIRECTOS) out[k] = String(pct[k])
  return out
}

function trabajos(n: number): string {
  return `${n} ${n === 1 ? 'trabajo' : 'trabajos'}`
}

function pesos(n: number): string {
  return `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Lo que dijo el servidor, en palabras (sin el "422: {json}")
function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail
    if (typeof d === 'string' && d.trim()) return d
    if (Array.isArray(d)) {
      return d
        .map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x)))
        .join('. ')
    }
    if (d && typeof d === 'object' && 'mensaje' in d) return String((d as { mensaje: unknown }).mensaje)
    return e.message
  }
  if (e instanceof TypeError) return 'No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.'
  return e instanceof Error ? e.message : String(e)
}

function normNombre(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Rubros con sus trabajos, juntando las fuentes (trabajos típicos, JSON y los armados a mano).
 * Dos rubros con el mismo nombre quedan en uno. Devuelve un error si algo no se puede crear.
 */
// Valida el contenido real de un JSON de estructura (los tipos de TypeScript no lo hacen) y lo pasa a rubros.
// Nombre y descripción tienen que ser texto; unidad, texto o nada; cantidad, número o nada.
function leerRubrosJson(data: unknown): { rubros: Section[] } | { error: string } {
  // textos-ok: the keys the file must have ("items", "descripcion") are written as they go in the file
  const formato = 'Formato esperado: [{"nombre": "Rubro", "items": [{"descripcion": "...", "unidad": "m2", "cantidad": 10}]}].'
  if (!Array.isArray(data)) return { error: `El archivo .json tiene que ser una lista de rubros. ${formato}` }
  const vacio = (v: unknown) => v === undefined || v === null
  const rubros: Section[] = []
  for (let i = 0; i < data.length; i++) {
    const r = data[i] as Record<string, unknown> | null
    const donde = `Rubro ${i + 1}`
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: `${donde}: tiene que ser {"nombre": ..., "items": [...]}. ${formato}` } // textos-ok
    if (!vacio(r.nombre) && typeof r.nombre !== 'string') return { error: `${donde}: el nombre tiene que ser texto.` }
    if (!vacio(r.items) && !Array.isArray(r.items)) return { error: `${donde}: "items" tiene que ser una lista de trabajos.` } // textos-ok
    const items: SectionItem[] = []
    const lista = (r.items ?? []) as unknown[]
    for (let k = 0; k < lista.length; k++) {
      const it = lista[k] as Record<string, unknown> | null
      const dondeT = `${donde}, trabajo ${k + 1}`
      if (!it || typeof it !== 'object' || Array.isArray(it)) return { error: `${dondeT}: tiene que ser {"descripcion": ..., "unidad": ..., "cantidad": ...}.` } // textos-ok
      if (!vacio(it.descripcion) && typeof it.descripcion !== 'string') return { error: `${dondeT}: la descripción tiene que ser texto.` }
      if (!vacio(it.unidad) && typeof it.unidad !== 'string') return { error: `${dondeT}: la unidad tiene que ser texto.` }
      if (!vacio(it.cantidad) && (typeof it.cantidad !== 'number' || !Number.isFinite(it.cantidad))) {
        return { error: `${dondeT}: la cantidad tiene que ser un número.` }
      }
      items.push({
        id: uid(),
        descripcion: (it.descripcion as string | undefined) ?? '',
        unidad: (it.unidad as string | undefined) ?? '',
        cantidad: vacio(it.cantidad) ? '' : String(it.cantidad),
      })
    }
    rubros.push({ id: uid(), nombre: (r.nombre as string | undefined) ?? '', items })
  }
  return { rubros }
}

function armarRubros(
  seleccion: SelectionState,
  jsonSections: Section[],
  manuales: Section[],
): { secciones: Secciones; error: string | null } {
  const rubros: { nombre: string; items: { descripcion: string; unidad: string; cantidad: number }[] }[] = []
  function rubro(nombre: string) {
    const clave = normNombre(nombre)
    let r = rubros.find((x) => normNombre(x.nombre) === clave)
    if (!r) {
      r = { nombre: nombre.trim(), items: [] }
      rubros.push(r)
    }
    return r
  }

  for (const t of trabajosElegidos(seleccion)) {
    rubro(t.categoryName).items.push({ descripcion: t.descripcion, unidad: t.unidad, cantidad: t.cantidad })
  }

  const conItems = (s: Section) => s.items.filter((it) => it.descripcion.trim())
  for (const [origen, lista] of [['Importar un archivo (.json)', jsonSections], ['A mano', manuales]] as const) {
    for (let i = 0; i < lista.length; i++) {
      const s = lista[i]
      const items = conItems(s)
      if (!s.nombre.trim()) {
        if (items.length > 0) {
          return {
            secciones: [],
            error: `En "${origen}", el rubro ${i + 1} tiene trabajos pero no tiene nombre. Escribile un nombre o borralo.`,
          }
        }
        continue
      }
      const r = rubro(s.nombre)
      for (const it of items) {
        r.items.push({
          descripcion: it.descripcion.trim(),
          unidad: it.unidad || 'gl',
          cantidad: numero(it.cantidad) || 1,
        })
      }
    }
  }

  const secciones: Secciones = rubros.map((r, i) => ({
    codigo: String(i + 1),
    nombre: r.nombre,
    items: r.items.map((it, j) => ({ codigo: `${i + 1}.${j + 1}`, ...it })),
  }))
  return { secciones, error: null }
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function NewProject() {
  const navigate = useNavigate()
  const { puedeEditar, user, org } = useAuth()
  // The draft belongs to this user in this company, like the one of "Cargar obra"
  const dueno = duenoBorrador(user?.id ?? (AUTH_ENABLED ? null : 'demo'), org?.id)
  // Draft left by a previous visit (null = none)
  const [borrador, setBorrador] = useState<BorradorNuevo | null>(null)
  const [step, setStep] = useState(PASO_DATOS)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // Datos
  const [project, setProject] = useState<ProjectData>({ name: '', description: '' })
  const [listas, setListas] = useState<PriceCatalog[] | null>(null)
  const [listasError, setListasError] = useState('')

  // Estructura (todo vive acá: ir y volver entre pasos no pierde nada)
  const [structureOption, setStructureOption] = useState<StructureOption>('template')
  const [seleccion, setSeleccion] = useState<SelectionState>(() => seleccionInicial())
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [aiReviewItems, setAiReviewItems] = useState<AIReviewItem[]>([])
  const [showAiReview, setShowAiReview] = useState(false)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [sections, setSections] = useState<Section[]>([{ id: uid(), nombre: '', items: [] }])
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [jsonSections, setJsonSections] = useState<Section[]>([])

  // Indirectos: arrancan con los de la empresa
  const [generales, setGenerales] = useState<IndirectosPct | null>(null)
  const [indirectos, setIndirectos] = useState<IndirectosTexto | null>(null)
  const [indirectosError, setIndirectosError] = useState('')

  // Resultado
  const [result, setResult] = useState<Resultado | null>(null)

  useEffect(() => {
    catalogApi
      .list()
      .then((l) => setListas(l))
      .catch((e) => setListasError(errorText(e)))
    cargarGenerales()
  }, [])

  function cargarGenerales() {
    setIndirectosError('')
    budgetApi
      .getGeneralIndirects()
      .then((data) => {
        const g = indirectosCompletos(data)
        setGenerales(g)
        setIndirectos((prev) => prev ?? aTexto(g))
      })
      .catch((e) => setIndirectosError(errorText(e)))
  }

  const armado = useMemo(() => armarRubros(seleccion, jsonSections, sections), [seleccion, jsonSections, sections])
  const trabajosTipicos = useMemo(() => trabajosElegidos(seleccion).length, [seleccion])

  // ─── Draft ─────────────────────────────────────────────────────────────────

  // Something worth keeping: a name, a description or any work chosen
  const hayAlgo = !!(
    project.name.trim() || project.description.trim() || trabajosTipicos > 0 || planFile || jsonSections.length > 0 ||
    sections.some((r) => r.nombre.trim() || r.items.length > 0)
  )

  useEffect(() => {
    setBorrador(null)
    if (dueno) leerBorradorDe('nuevo-presupuesto', dueno, leerBorradorNuevo).then(setBorrador)
  }, [dueno])

  // Keep the work in progress (debounced 500 ms) until the budget exists. The last change not yet
  // saved stays in a ref and is written right away when Sol leaves the wizard (or the page), so
  // nothing typed just before going away is lost
  const pendienteBorrador = useRef<{ dueno: string; datos: BorradorNuevo } | null>(null)

  useEffect(() => {
    if (!dueno || !hayAlgo || result || pendiente || step >= PASO_RESULTADO) {
      pendienteBorrador.current = null
      return
    }
    pendienteBorrador.current = {
      dueno,
      datos: {
        paso: step,
        project,
        structureOption,
        seleccion,
        sections,
        jsonSections,
        json: jsonFile,
        jsonNombre: jsonFile?.name ?? '',
        plan: planFile,
        planNombre: planFile?.name ?? '',
        indirectos,
        guardadoEn: new Date().toISOString(),
      },
    }
    const t = setTimeout(guardarPendiente, 500)
    return () => clearTimeout(t)
  }, [dueno, hayAlgo, result, pendiente, step, project, structureOption, seleccion, sections, jsonSections, jsonFile, planFile, indirectos])

  function guardarPendiente() {
    const p = pendienteBorrador.current
    pendienteBorrador.current = null
    if (p) void guardarBorradorDe<BorradorNuevo>('nuevo-presupuesto', p.dueno, p.datos)
  }

  // Leaving the wizard (another screen) or the page (closing the tab, reloading): save what's pending
  useEffect(() => {
    window.addEventListener('pagehide', guardarPendiente)
    return () => {
      window.removeEventListener('pagehide', guardarPendiente)
      guardarPendiente()
    }
  }, [])

  // Once the budget is created there is nothing left half-done
  useEffect(() => {
    if (dueno && (result || pendiente)) {
      pendienteBorrador.current = null
      setBorrador(null)
      void borrarBorradorDe('nuevo-presupuesto', dueno)
    }
  }, [dueno, result, pendiente])

  function seguirBorrador() {
    if (!borrador) return
    const b = borrador
    setBorrador(null)
    setProject(b.project)
    setStructureOption(b.structureOption)
    setSeleccion(b.seleccion)
    setSections(b.sections.length > 0 ? b.sections : [{ id: uid(), nombre: '', items: [] }])
    setJsonSections(b.jsonSections)
    setJsonFile(b.json ? new File([b.json], b.jsonNombre || 'rubros.json', { type: 'application/json' }) : null)
    setPlanFile(b.plan ? new File([b.plan], b.planNombre || 'plano', { type: b.plan.type }) : null)
    if (b.indirectos) setIndirectos(b.indirectos)
    irA(Math.min(Math.max(b.paso, PASO_DATOS), PASO_INDIRECTOS))
  }

  function descartarBorrador() {
    pendienteBorrador.current = null
    setBorrador(null)
    if (dueno) void borrarBorradorDe('nuevo-presupuesto', dueno)
  }

  // ─── Step navigation ───────────────────────────────────────────────────────

  function irA(paso: number) {
    setStep(paso)
    setError('')
  }

  /** Los % listos para mandar, o un error si alguno no sirve. Sin los de la empresa: undefined (el servidor usa los suyos). */
  function indirectosParaGuardar(): { valores?: IndirectosPct; error?: string } {
    if (!indirectos) return {}
    const valores = {} as IndirectosPct
    for (const k of CLAVES_INDIRECTOS) {
      const n = numero(indirectos[k])
      if (n === null) return { error: `Falta el porcentaje de ${NOMBRE_INDIRECTO[k]}.` }
      if (n < 0 || n > 100) return { error: `${NOMBRE_INDIRECTO[k]} tiene que estar entre 0 y 100 %.` }
      valores[k] = n
    }
    return { valores }
  }

  async function next() {
    if (step === PASO_DATOS) {
      if (!project.name.trim()) {
        setError('Falta el nombre del presupuesto.')
        return
      }
      irA(PASO_ESTRUCTURA)
      return
    }
    if (step === PASO_ESTRUCTURA) {
      if (armado.error) {
        setError(armado.error)
        return
      }
      irA(PASO_INDIRECTOS)
      return
    }
    if (step === PASO_INDIRECTOS) {
      if (planFile) await handleAnalyzeAndReview()
      else await handleCreate()
    }
  }

  function prev() {
    irA(Math.max(step - 1, PASO_DATOS))
  }

  // ─── JSON structure import ────────────────────────────────────────────────

  function handleJsonFile(f: File) {
    // Un archivo rechazado no reemplaza lo que ya estaba importado ni cuenta como importación
    const reader = new FileReader()
    reader.onload = (e) => {
      let data: unknown
      try {
        data = JSON.parse(e.target?.result as string)
      } catch {
        setError('El archivo .json no tiene un formato válido.')
        return
      }
      const leido = leerRubrosJson(data)
      if ('error' in leido) {
        setError(leido.error)
        return
      }
      setJsonFile(f)
      setJsonSections(leido.rubros)
      setError('')
    }
    reader.readAsText(f)
  }

  function clearJson() {
    setJsonFile(null)
    setJsonSections([])
  }

  // ─── Section management ───────────────────────────────────────────────────

  function addSection() {
    setSections((prev) => [...prev, { id: uid(), nombre: '', items: [] }])
  }

  function removeSection(sectionId: string) {
    setSections((prev) => prev.filter((s) => s.id !== sectionId))
  }

  function updateSectionName(sectionId: string, name: string) {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, nombre: name } : s))
    )
  }

  function addItem(sectionId: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, items: [...s.items, { id: uid(), descripcion: '', unidad: 'gl', cantidad: '1' }] }
          : s
      )
    )
  }

  function removeItem(sectionId: string, itemId: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.filter((it) => it.id !== itemId) }
          : s
      )
    )
  }

  function updateItem(sectionId: string, itemId: string, field: keyof SectionItem, value: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
            ...s,
            items: s.items.map((it) =>
              it.id === itemId ? { ...it, [field]: value } : it
            ),
          }
          : s
      )
    )
  }

  function moveSectionUp(idx: number) {
    if (idx <= 0) return
    setSections((prev) => {
      const arr = [...prev]
      ;[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      return arr
    })
  }

  function moveSectionDown(idx: number) {
    setSections((prev) => {
      if (idx >= prev.length - 1) return prev
      const arr = [...prev]
      ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      return arr
    })
  }

  // ─── Crear (todo en un pedido: rubros con sus trabajos y los % de esta obra) ─

  function payload(): CreateFullPayload | null {
    if (armado.error) {
      setError(armado.error)
      return null
    }
    const ind = indirectosParaGuardar()
    if (ind.error) {
      setError(ind.error)
      return null
    }
    return {
      name: project.name.trim(),
      description: project.description.trim(),
      secciones: armado.secciones,
      indirectos: ind.valores,
    }
  }

  async function handleCreate() {
    const data = payload()
    if (!data) return
    setCreating(true)
    setError('')
    try {
      const res = await budgetApi.createFull(data)
      setResult({ budgetId: res.budget.id, sectionsCount: res.sections_created, itemsCount: res.items_created })
      setStep(PASO_RESULTADO)
    } catch (e) {
      setError(`No se pudo crear el presupuesto: ${errorText(e)}`)
    } finally {
      setCreating(false)
    }
  }

  // ─── Plano (IA): crear, analizar y mostrar lo que encontró para revisar ────

  async function handleAnalyzeAndReview() {
    if (!planFile) return
    const data = payload()
    if (!data) return
    setCreating(true)
    setError('')
    let creado: Pendiente | null = null
    try {
      // analyze-plan needs an existing budget: create it with everything else first
      const res = await budgetApi.createFull(data)
      creado = { budgetId: res.budget.id, sectionsCount: res.sections_created, itemsCount: res.items_created }
    } catch (e) {
      setError(`No se pudo crear el presupuesto: ${errorText(e)}`)
      setCreating(false)
      return
    }
    try {
      const formData = new FormData()
      formData.append('file', planFile)
      const aiRes = await budgetApi.analyzePlan(creado.budgetId, formData)

      // The plan's rubros go after the ones already created: number them from there
      const reviewItems: AIReviewItem[] = []
      let keyIdx = 0
      aiRes.secciones.forEach((sec, si) => {
        const codigoRubro = String(creado!.sectionsCount + si + 1)
        sec.items.forEach((item, ii) => {
          reviewItems.push({
            _key: `rev-${keyIdx++}`,
            seccion_nombre: sec.nombre,
            seccion_codigo: codigoRubro,
            codigo: `${codigoRubro}.${ii + 1}`,
            descripcion: item.descripcion,
            unidad: item.unidad,
            cantidad: item.cantidad,
            notas: item.notas,
            notas_calculo: item.notas_calculo ?? '',
            recursos: item.recursos,
            template_match: item.template_match,
            accepted: true,
          })
        })
      })
      if (reviewItems.length === 0) {
        throw new Error('La IA no encontró trabajos en el plano. Probá con otra imagen, o quitá el plano para crear el presupuesto sin él.')
      }
      setAiReviewItems(reviewItems)
      setPendiente(creado)
      setShowAiReview(true)
    } catch (e) {
      // Nothing half-made: undo the budget created for the analysis
      const motivo = errorText(e)
      const borrado = await budgetApi.remove(creado.budgetId).then(() => true, () => false)
      if (borrado) {
        setError(`No se pudo analizar el plano: ${motivo}`)
      } else {
        // Could not undo it (only an admin deletes budgets): say what was created, do not create another one
        setResult({
          ...creado,
          aviso: `La IA no pudo analizar el plano (${motivo.replace(/\.+$/, '')}). El presupuesto se creó con los demás trabajos, sin los del plano. Podés volver a analizar el plano desde "Planos con IA" del presupuesto.`,
        })
        setStep(PASO_RESULTADO)
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleConfirmReview() {
    if (!pendiente) return
    setCreating(true)
    setError('')
    try {
      const accepted = aiReviewItems.filter((i) => i.accepted)
      let insertados = 0
      let rubrosIA = 0
      if (accepted.length > 0) {
        const res = await budgetApi.addItemsFromAI(
          pendiente.budgetId,
          accepted.map((i) => ({
            seccion_nombre: i.seccion_nombre,
            seccion_codigo: i.seccion_codigo,
            codigo: i.codigo,
            descripcion: i.descripcion,
            unidad: i.unidad,
            cantidad: i.cantidad,
            notas: i.notas,
            notas_calculo: i.notas_calculo,
            recursos: i.recursos,
          })),
        )
        insertados = res.inserted
        rubrosIA = res.sections_created
      }
      setResult({
        budgetId: pendiente.budgetId,
        sectionsCount: pendiente.sectionsCount + rubrosIA,
        itemsCount: pendiente.itemsCount + insertados,
      })
      setShowAiReview(false)
      setPendiente(null)
      setStep(PASO_RESULTADO)
    } catch (e) {
      setError(`No se pudieron agregar los trabajos del plano: ${errorText(e)}`)
    } finally {
      setCreating(false)
    }
  }

  async function handleCancelReview() {
    if (!pendiente) {
      setShowAiReview(false)
      return
    }
    setCreating(true)
    setError('')
    try {
      await budgetApi.remove(pendiente.budgetId)
      setPendiente(null)
      setShowAiReview(false)
    } catch (e) {
      setError(
        esSinPermiso(e)
          ? `El presupuesto ya quedó creado con ${trabajos(pendiente.itemsCount)} y solo un administrador puede borrarlo, así que no se puede cancelar. Destildá los trabajos del plano que no quieras sumar y confirmá.`
          : `No se pudo cancelar: ${errorText(e)}`,
      )
    } finally {
      setCreating(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!puedeEditar) {
    return (
      <div className="p-6 fade-in">
        <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
          <Plus size={14} /> NUEVO PRESUPUESTO
        </div>
        <div className="max-w-xl bg-white border rounded-xl shadow-sm px-6 py-5 text-sm text-gray-700">
          Tu usuario solo puede mirar.
        </div>
      </div>
    )
  }

  const cargandoIndirectos = step === PASO_INDIRECTOS && !indirectos && !indirectosError
  let textoBoton = 'Siguiente'
  if (step === PASO_INDIRECTOS) {
    if (creating) textoBoton = planFile ? 'Analizando el plano con IA...' : 'Creando...'
    else textoBoton = planFile ? 'Analizar plano y crear' : 'Crear presupuesto'
  }

  return (
    <div className="p-6 fade-in">
      {/* Page header */}
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Plus size={14} /> NUEVO PRESUPUESTO
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-8 bg-[#2D8D68] rounded-full" />
        <h1 className="text-2xl font-extrabold text-gray-900">CREAR PRESUPUESTO</h1>
      </div>

      {/* Steps, as pills (like Cargar obra) */}
      <div className="max-w-4xl mx-auto mb-6">
        <ol className="flex flex-wrap gap-2 text-xs font-bold" data-testid="pasos" aria-label="Pasos">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${i === step ? 'bg-[#2D8D68] text-white' : i < step ? 'bg-[#E8F5EE] text-[#143D34]' : 'bg-gray-100 text-gray-500'}`}
            >
              {i < step ? <Check size={12} aria-hidden="true" /> : <span>{i + 1}</span>}
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* A draft left halfway: offer to go on with it */}
      {borrador && !hayAlgo && step === PASO_DATOS && (
        <div className="max-w-4xl mx-auto mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" data-testid="borrador-nuevo">
          <History size={18} className="text-amber-700 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[220px]">
            <div className="text-sm font-bold text-amber-800">Tenés un presupuesto a medias</div>
            <div className="text-xs text-amber-800">
              {borrador.project.name.trim() ? <span className="font-semibold">{borrador.project.name.trim()}</span> : 'Sin nombre'}
              {haceCuanto(borrador.guardadoEn) && <>, {haceCuanto(borrador.guardadoEn)}</>}
            </div>
          </div>
          <button
            onClick={seguirBorrador}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-4 py-1.5 rounded-lg text-sm"
          >
            Seguir
          </button>
          <button
            onClick={descartarBorrador}
            className="bg-white border border-amber-300 text-amber-800 font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-amber-100"
          >
            Descartar
          </button>
        </div>
      )}

      {/* AI Review Panel overlay */}
      {showAiReview && (
        <AIReviewPanel
          items={aiReviewItems}
          setItems={setAiReviewItems}
          onConfirm={handleConfirmReview}
          onCancel={handleCancelReview}
          confirming={creating}
          error={error}
        />
      )}

      {/* Step content */}
      <div className="max-w-4xl mx-auto">
        {step === PASO_DATOS && (
          <StepDatos project={project} setProject={setProject} listas={listas} listasError={listasError} />
        )}
        {step === PASO_ESTRUCTURA && (
          <StepEstructura
            structureOption={structureOption}
            setStructureOption={setStructureOption}
            planFile={planFile}
            setPlanFile={setPlanFile}
            sections={sections}
            addSection={addSection}
            removeSection={removeSection}
            updateSectionName={updateSectionName}
            addItem={addItem}
            removeItem={removeItem}
            updateItem={updateItem}
            moveSectionUp={moveSectionUp}
            moveSectionDown={moveSectionDown}
            jsonFile={jsonFile}
            jsonSections={jsonSections}
            onJsonFile={handleJsonFile}
            onClearJson={clearJson}
            seleccion={seleccion}
            onSeleccion={setSeleccion}
            trabajosTipicos={trabajosTipicos}
            secciones={armado.secciones}
          />
        )}
        {step === PASO_INDIRECTOS && (
          <StepIndirectos
            indirectos={indirectos}
            setIndirectos={setIndirectos}
            generales={generales}
            error={indirectosError}
            onReintentar={cargarGenerales}
          />
        )}
        {step === PASO_RESULTADO && result && (
          <StepResultado result={result} navigate={navigate} />
        )}

        {/* Error: above the button, with what the server said */}
        {error && !showAiReview && step < PASO_RESULTADO && (
          <div role="alert" className="mt-6 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Navigation buttons */}
        {step < PASO_RESULTADO && (
          <div className={`flex items-center justify-between ${error ? 'mt-4' : 'mt-8'}`}>
            <button
              onClick={prev}
              disabled={step === PASO_DATOS || creating}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <button
              onClick={next}
              disabled={creating || cargandoIndirectos}
              className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              {creating && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {textoBoton}
              {!creating && step < PASO_INDIRECTOS && <ChevronRight size={16} />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Paso 1: Datos ──────────────────────────────────────────────────────────

function juntar(partes: string[]): string {
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

// "Maestro TERRAC - Materiales" + "Maestro TERRAC - Mano de obra" → Maestro TERRAC (Materiales y Mano de obra)
function gruposListas(l: PriceCatalog[]): { nombre: string; partes: string[] }[] {
  const grupos: { nombre: string; partes: string[] }[] = []
  for (const c of l) {
    const i = c.name.lastIndexOf(' - ')
    const nombre = i > 0 ? c.name.slice(0, i) : c.name
    const g = grupos.find((x) => x.nombre === nombre)
    const parte = i > 0 ? c.name.slice(i + 3) : ''
    if (g) g.partes.push(parte)
    else grupos.push({ nombre, partes: [parte] })
  }
  return grupos
}

function nombresListas(l: PriceCatalog[]) {
  const grupos = gruposListas(l)
  return grupos.map((g, i) => {
    const partes = g.partes.filter(Boolean)
    return (
      <span key={g.nombre}>
        {i > 0 && (i === grupos.length - 1 ? ' y ' : ', ')}
        {g.partes.length === 1 && partes.length === 1 ? (
          <strong>{g.nombre} - {partes[0]}</strong>
        ) : (
          <>
            <strong>{g.nombre}</strong>
            {partes.length > 0 && <> ({juntar(partes)})</>}
          </>
        )}
      </span>
    )
  })
}

function LineaPrecios({ listas, error }: { listas: PriceCatalog[] | null; error: string }) {
  const hoy = fmtDate(todayIso())
  const enlace = (
    <a href="/app/catalogs" target="_blank" rel="noreferrer" className="text-[#2D8D68] underline underline-offset-2 hover:text-[#1B5E4B]">
      Lista de precios
    </a>
  )
  let texto: React.ReactNode
  if (error) {
    texto = <>Precios: no se pudo leer la {enlace} ({error}).</>
  } else if (listas === null) {
    texto = <>Precios: buscando la lista oficial...</>
  } else {
    const oficiales = listas.filter((c) => c.oficial)
    if (oficiales.length > 0 && gruposListas(oficiales).length === 1) {
      texto = <>Precios: se usa la lista oficial {nombresListas(oficiales)}, con precios al {hoy}.</>
    } else if (oficiales.length > 1) {
      texto = <>Precios: se usan las listas oficiales {nombresListas(oficiales)}, con precios al {hoy}.</>
    } else if (listas.length > 0) {
      texto = (
        <>
          Precios: todavía no hay lista oficial, así que se usa el precio más nuevo de todas las listas al {hoy}.
          Podés marcar una como oficial en {enlace}.
        </>
      )
    } else {
      texto = (
        <>
          Precios: todavía no hay listas de precios, así que los materiales van a quedar sin precio hasta que subas una en {enlace}.
        </>
      )
    }
  }
  return (
    <p data-testid="linea-precios" className="text-xs text-gray-500 mt-6 pt-4 border-t border-gray-100">
      {texto}
    </p>
  )
}

function StepDatos({
  project,
  setProject,
  listas,
  listasError,
}: {
  project: ProjectData
  setProject: React.Dispatch<React.SetStateAction<ProjectData>>
  listas: PriceCatalog[] | null
  listasError: string
}) {
  function update(field: keyof ProjectData, value: string) {
    setProject((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="bg-white rounded-xl border p-6 fade-in">
      <h2 className="text-lg font-bold text-gray-900 mb-1">Datos del presupuesto</h2>
      <p className="text-sm text-gray-500 mb-6">Información básica de la obra.</p>

      <div className="space-y-5">
        <div>
          <label htmlFor="np-nombre" className="block text-sm font-medium text-gray-700 mb-1">
            Nombre del presupuesto <span className="text-red-400">*</span>
          </label>
          <input
            id="np-nombre"
            type="text"
            value={project.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Ej: Casa Lugones, Edificio Norte..."
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68] transition-all"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="np-descripcion" className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
          <textarea
            id="np-descripcion"
            value={project.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="Descripción breve de la obra..."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68] transition-all resize-none"
          />
        </div>
      </div>

      <LineaPrecios listas={listas} error={listasError} />
    </div>
  )
}

// ─── Paso 2: Estructura de obra ─────────────────────────────────────────────

function StepEstructura({
  structureOption,
  setStructureOption,
  planFile,
  setPlanFile,
  sections,
  addSection,
  removeSection,
  updateSectionName,
  addItem,
  removeItem,
  updateItem,
  moveSectionUp,
  moveSectionDown,
  jsonFile,
  jsonSections,
  onJsonFile,
  onClearJson,
  seleccion,
  onSeleccion,
  trabajosTipicos,
  secciones,
}: {
  structureOption: StructureOption
  setStructureOption: (v: StructureOption) => void
  planFile: File | null
  setPlanFile: (f: File | null) => void
  sections: Section[]
  addSection: () => void
  removeSection: (id: string) => void
  updateSectionName: (id: string, name: string) => void
  addItem: (id: string) => void
  removeItem: (sectionId: string, itemId: string) => void
  updateItem: (sectionId: string, itemId: string, field: keyof SectionItem, value: string) => void
  moveSectionUp: (idx: number) => void
  moveSectionDown: (idx: number) => void
  jsonFile: File | null
  jsonSections: Section[]
  onJsonFile: (f: File) => void
  onClearJson: () => void
  seleccion: SelectionState
  onSeleccion: (next: SelectionState) => void
  trabajosTipicos: number
  secciones: Secciones
}) {
  const totalTrabajos = secciones.reduce((s, r) => s + r.items.length, 0)
  return (
    <div className="fade-in space-y-4">
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Rubros y trabajos</h2>
        <p className="text-sm text-gray-500 mb-6">
          Definí los rubros y trabajos del presupuesto. Podés combinar varias fuentes.
        </p>

        <div className="grid grid-cols-4 gap-3 mb-6">
          <OptionCard
            active={structureOption === 'template'}
            onClick={() => setStructureOption('template')}
            icon={<ClipboardList size={20} />}
            title="Trabajos típicos"
            description="Elegir de una lista de obra"
          />
          <OptionCard
            active={structureOption === 'plan'}
            onClick={() => setStructureOption('plan')}
            icon={<Image size={20} />}
            title="Subir un plano"
            description="Lo lee la inteligencia artificial"
          />
          <OptionCard
            active={structureOption === 'manual'}
            onClick={() => setStructureOption('manual')}
            icon={<Building2 size={20} />}
            title="A mano"
            description="Escribís rubros y trabajos"
          />
          <OptionCard
            active={structureOption === 'json'}
            onClick={() => setStructureOption('json')}
            icon={<FileJson size={20} />}
            title="Importar un archivo (.json)"
            description="Rubros y trabajos de un archivo"
          />
        </div>

        {/* What is going to be created, from every source */}
        <div data-testid="resumen-estructura" className="mb-4 bg-[#E8F5EE] rounded-lg px-4 py-2.5 border border-green-200 text-sm text-[#143D34]">
          {totalTrabajos > 0 || secciones.length > 0 ? (
            <>
              Se van a crear <strong>{secciones.length} {secciones.length === 1 ? 'rubro' : 'rubros'}</strong> con{' '}
              <strong>{totalTrabajos} {totalTrabajos === 1 ? 'trabajo' : 'trabajos'}</strong>
              {trabajosTipicos > 0 && structureOption !== 'template' && (
                <span className="text-gray-500"> ({trabajosTipicos} de trabajos típicos)</span>
              )}
              {planFile && <span>, más los que encuentre la IA en el plano <strong>{planFile.name}</strong></span>}.
            </>
          ) : planFile ? (
            <>Se van a crear los rubros y trabajos que encuentre la IA en el plano <strong>{planFile.name}</strong>.</>
          ) : (
            <>Todavía no elegiste trabajos: si seguís, el presupuesto se crea vacío.</>
          )}
        </div>

        {/* Trabajos típicos */}
        {structureOption === 'template' && (
          <div className="fade-in">
            <GenericTaskSelector selection={seleccion} onChange={onSeleccion} />
          </div>
        )}

        {/* Plan upload */}
        {structureOption === 'plan' && (
          <div className="fade-in">
            <FileUpload
              accept=".jpg,.jpeg,.png,.pdf"
              label="Subí el plano de obra"
              hint="JPG, PNG o PDF"
              onFile={(f) => setPlanFile(f)}
              value={planFile}
              onClear={() => setPlanFile(null)}
              icon={<Image size={48} className="text-gray-300" />}
            />
            {planFile && (
              <div className="mt-4 bg-[#FEF9EE] rounded-lg p-4 border border-[#E0A33A]/30 flex items-start gap-3">
                <Sparkles size={20} className="text-[#E0A33A] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-800">La IA va a analizar este plano al crear el presupuesto</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Antes de sumarlos, te muestra los trabajos que encontró para que los revises. Puede tardar unos segundos.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual structure */}
        {structureOption === 'manual' && (
          <div className="fade-in space-y-4">
            {sections.map((sec, si) => (
              <div
                key={sec.id}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                {/* Section header */}
                <div className="bg-gray-50 px-4 py-3 flex items-center gap-3">
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveSectionUp(si)}
                      disabled={si === 0}
                      title="Subir rubro"
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-20 transition-colors"
                    >
                      <GripVertical size={14} />
                    </button>
                    <button
                      onClick={() => moveSectionDown(si)}
                      disabled={si === sections.length - 1}
                      title="Bajar rubro"
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-20 transition-colors"
                    >
                      <GripVertical size={14} />
                    </button>
                  </div>
                  <span className="text-xs font-bold text-[#2D8D68] w-6">{si + 1}.</span>
                  <input
                    type="text"
                    value={sec.nombre}
                    onChange={(e) => updateSectionName(sec.id, e.target.value)}
                    placeholder="Nombre del rubro (ej: Tareas preliminares)"
                    className="flex-1 bg-transparent border-b border-gray-300 text-sm font-medium text-gray-800 focus:outline-none focus:border-[#2D8D68] px-1 py-0.5 transition-colors"
                  />
                  <button
                    onClick={() => removeSection(sec.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Borrar rubro"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Items */}
                <div className="p-4 space-y-2">
                  {sec.items.map((it, ii) => (
                    <div key={it.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-8 text-right">
                        {si + 1}.{ii + 1}
                      </span>
                      <input
                        type="text"
                        value={it.descripcion}
                        onChange={(e) => updateItem(sec.id, it.id, 'descripcion', e.target.value)}
                        placeholder="Descripción del trabajo"
                        className="flex-1 border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68] transition-all"
                      />
                      <select
                        value={it.unidad}
                        onChange={(e) => updateItem(sec.id, it.id, 'unidad', e.target.value)}
                        className="w-20 border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30"
                      >
                        <option value="gl">gl</option>
                        <option value="m2">m2</option>
                        <option value="m3">m3</option>
                        <option value="ml">ml</option>
                        <option value="kg">kg</option>
                        <option value="un">un</option>
                        <option value="hs">hs</option>
                        <option value="mes">mes</option>
                      </select>
                      <input
                        type="number"
                        value={it.cantidad}
                        onChange={(e) => updateItem(sec.id, it.id, 'cantidad', e.target.value)}
                        placeholder="Cant."
                        className="w-20 border border-gray-200 rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68] transition-all"
                      />
                      <button
                        onClick={() => removeItem(sec.id, it.id)}
                        title="Borrar trabajo"
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addItem(sec.id)}
                    className="flex items-center gap-1 text-xs text-[#2D8D68] font-medium hover:text-[#1B5E4B] mt-2 transition-colors"
                  >
                    <Plus size={12} /> Agregar trabajo
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={addSection}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg py-3 text-sm font-medium text-gray-500 hover:border-[#2D8D68] hover:text-[#2D8D68] transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Agregar rubro
            </button>
          </div>
        )}

        {/* JSON import */}
        {structureOption === 'json' && (
          <div className="fade-in">
            <FileUpload
              accept=".json"
              label="Subí un archivo .json"
              // textos-ok: the keys of the file, as they go in it
              hint='Formato: [{"nombre": "Rubro", "items": [{"descripcion": "...", "unidad": "m2", "cantidad": 10}]}]'
              onFile={onJsonFile}
              value={jsonFile}
              onClear={onClearJson}
              icon={<FileJson size={48} className="text-gray-300" />}
            />
            {jsonFile && jsonSections.length > 0 && (
              <div className="mt-4 bg-[#E8F5EE] rounded-lg p-4 border border-green-200">
                <div className="text-sm font-medium text-[#143D34] mb-2">
                  Del archivo: {jsonSections.length} {jsonSections.length === 1 ? 'rubro' : 'rubros'},{' '}
                  {trabajos(jsonSections.reduce((s, sec) => s + sec.items.length, 0))}
                </div>
                <div className="space-y-1">
                  {jsonSections.map((sec, i) => (
                    <div key={sec.id} className="text-xs text-gray-600">
                      <span className="font-medium">{i + 1}. {sec.nombre}</span>
                      <span className="text-gray-400 ml-2">({trabajos(sec.items.length)})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Paso 3: Indirectos ─────────────────────────────────────────────────────

function StepIndirectos({
  indirectos,
  setIndirectos,
  generales,
  error,
  onReintentar,
}: {
  indirectos: IndirectosTexto | null
  setIndirectos: React.Dispatch<React.SetStateAction<IndirectosTexto | null>>
  generales: IndirectosPct | null
  error: string
  onReintentar: () => void
}) {
  if (!indirectos) {
    return (
      <div className="bg-white rounded-xl border p-6 fade-in">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Costos indirectos</h2>
        {error ? (
          <div className="mt-4 text-sm text-gray-700 space-y-3">
            <p className="text-red-700">No se pudieron leer los indirectos de la empresa: {error}</p>
            <p>
              Si creás el presupuesto igual, arranca con los de la empresa y los podés cambiar después en Coeficiente de pase.
            </p>
            <button
              onClick={onReintentar}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#2D8D68] hover:text-[#1B5E4B]"
            >
              <RotateCcw size={13} /> Volver a intentar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-400 mt-4">
            <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
            Cargando los de la empresa...
          </div>
        )}
      </div>
    )
  }

  const valores = {} as IndirectosPct
  for (const k of CLAVES_INDIRECTOS) valores[k] = numero(indirectos[k]) ?? 0
  const cascada = cascadaIndirectos(100, valores)
  const distintos = generales ? CLAVES_INDIRECTOS.filter((k) => numero(indirectos[k]) !== generales[k]) : []

  function update(k: ClaveIndirecto, v: string) {
    setIndirectos((prev) => (prev ? { ...prev, [k]: v } : prev))
  }

  const fila = (label: string, valor: number, fuerte = false) => (
    <div className={`flex items-center justify-between ${fuerte ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{pesos(valor)}</span>
    </div>
  )

  return (
    <div className="fade-in space-y-4">
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Costos indirectos</h2>
        <p className="text-sm text-gray-500 mb-6">
          Arrancan con los de la empresa (Coeficiente de pase). Lo que cambies acá vale solo para este presupuesto.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
          <div>
            {GRUPOS_INDIRECTOS.map((g) => (
              <div key={g.titulo} className="mb-4">
                <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-gray-100">
                  <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{g.titulo}</span>
                  <span className="text-[11px] text-gray-400">({g.nota})</span>
                </div>
                <div className="space-y-2">
                  {g.claves.map((k) => {
                    const general = generales?.[k]
                    const cambiado = general !== undefined && numero(indirectos[k]) !== general
                    return (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <label htmlFor={`ind-${k}`} className="text-sm text-gray-700">
                          {NOMBRE_INDIRECTO[k]}
                          {cambiado && (
                            <span className="ml-2 text-[11px] text-amber-600">(empresa: {general.toLocaleString('es-AR')} %)</span>
                          )}
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            id={`ind-${k}`}
                            type="number"
                            min={0}
                            max={100}
                            step="0.1"
                            value={indirectos[k]}
                            onChange={(e) => update(k, e.target.value)}
                            className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right font-semibold text-[#2D8D68] tabular-nums focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30"
                          />
                          <span className="text-sm text-gray-500">%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {generales && distintos.length > 0 && (
              <button
                onClick={() => setIndirectos(aTexto(generales))}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <RotateCcw size={12} /> Volver a los de la empresa
              </button>
            )}
          </div>

          {/* The same cascade the app uses, over $100 */}
          <div className="bg-gray-50 rounded-lg border border-gray-100 p-4 self-start text-xs space-y-1.5">
            <div className="text-[11px] font-bold text-gray-500 tracking-wider mb-2">CADA $100 DE COSTO DIRECTO</div>
            {fila('Costo directo', cascada.directo)}
            {fila('+ Indirectos', cascada.indirecto)}
            {fila('+ Beneficio', cascada.beneficio)}
            {fila('+ Impuestos', cascada.impuestos)}
            <div className="border-t border-dashed border-gray-200 my-1" />
            {fila('= Precio sin IVA', cascada.neto, true)}
            {fila('+ IVA', cascada.iva)}
            <div className="border-t border-gray-200 my-1" />
            {fila('= Precio final', cascada.total_final, true)}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between gap-4">
          <span className="text-sm text-gray-600">Precio final por cada $100 de costo directo</span>
          <span data-testid="precio-final-100" className="text-lg font-bold text-[#2D8D68] tabular-nums">
            {pesos(cascada.total_final)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Paso 4: Resultado ──────────────────────────────────────────────────────

function StepResultado({
  result,
  navigate,
}: {
  result: Resultado
  navigate: (path: string) => void
}) {
  return (
    <div className="fade-in">
      <div className="bg-white rounded-xl border p-8 text-center">
        <div className="w-20 h-20 bg-[#E8F5EE] rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={40} className="text-[#2D8D68]" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-2">Presupuesto creado</h2>
        <p className="text-sm text-gray-500 mb-6">
          Quedó creado y está listo para editar.
        </p>

        {result.aviso && (
          <div role="status" className="mb-6 mx-auto max-w-xl text-left bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{result.aviso}</span>
          </div>
        )}

        <div className="flex justify-center gap-4 mb-8">
          <div className="bg-[#E8F5EE] rounded-lg px-6 py-4 text-center">
            <div data-testid="rubros-creados" className="text-2xl font-bold text-[#2D8D68]">{result.sectionsCount}</div>
            <div className="text-[10px] text-gray-500 font-medium">RUBROS</div>
          </div>
          <div className="bg-[#E8F5EE] rounded-lg px-6 py-4 text-center">
            <div data-testid="trabajos-creados" className="text-2xl font-bold text-[#2D8D68]">{result.itemsCount}</div>
            <div className="text-[10px] text-gray-500 font-medium">TRABAJOS</div>
          </div>
        </div>

        <div className="flex justify-center gap-3">
          <button
            onClick={() => navigate(`/app/budgets/${result.budgetId}/editor`)}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
          >
            Abrir el presupuesto
          </button>
          <button
            onClick={() => navigate('/app/dashboard')}
            className="bg-white border text-gray-600 px-6 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Volver a Mis presupuestos
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AI Review Panel ────────────────────────────────────────────────────────

function AIReviewPanel({
  items,
  setItems,
  onConfirm,
  onCancel,
  confirming,
  error,
}: {
  items: AIReviewItem[]
  setItems: React.Dispatch<React.SetStateAction<AIReviewItem[]>>
  onConfirm: () => void
  onCancel: () => void
  confirming: boolean
  error: string
}) {
  const accepted = items.filter((i) => i.accepted)
  const withTemplate = items.filter((i) => i.template_match)

  function toggle(key: string) {
    setItems((prev) => prev.map((i) => (i._key === key ? { ...i, accepted: !i.accepted } : i)))
  }

  function updateCantidad(key: string, val: string) {
    const n = parseFloat(val)
    if (!isNaN(n) && n >= 0) {
      setItems((prev) => prev.map((i) => (i._key === key ? { ...i, cantidad: n } : i)))
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#2D8D68] text-white rounded-t-2xl px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={18} />
            <span className="font-bold text-base">REVISIÓN DE LOS TRABAJOS QUE ENCONTRÓ LA IA</span>
          </div>
          <p className="text-xs text-white/80">
            La IA encontró {trabajos(items.length)}.{' '}
            {withTemplate.length > 0 && (
              <span className="text-green-200 font-medium">
                {withTemplate.length} coinciden con tus fórmulas.{' '}
              </span>
            )}
            Revisalos y ajustalos antes de sumarlos al presupuesto.
          </p>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2.5 border-b bg-gray-50 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setItems((prev) => prev.map((i) => ({ ...i, accepted: true })))}
              className="text-[10px] font-medium text-[#2D8D68] hover:text-[#1B5E4B] transition-colors"
            >
              Tildar todos
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => setItems((prev) => prev.map((i) => ({ ...i, accepted: false })))}
              className="text-[10px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Destildar todos
            </button>
          </div>
          <span className="text-[10px] text-gray-400">
            {accepted.length} de {items.length} tildados
          </span>
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {items.map((item) => (
            <div
              key={item._key}
              className={`px-6 py-3 flex items-start gap-3 transition-colors ${
                item.accepted ? 'bg-white' : 'bg-gray-50 opacity-60'
              }`}
            >
              {/* Checkbox */}
              <button
                onClick={() => toggle(item._key)}
                role="checkbox"
                aria-checked={item.accepted}
                aria-label={item.descripcion}
                className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  item.accepted
                    ? 'bg-[#2D8D68] border-[#2D8D68] text-white'
                    : 'border-gray-300 hover:border-[#2D8D68]'
                }`}
              >
                {item.accepted && <Check size={12} />}
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-400 font-mono">{item.codigo}</span>
                  <span className="text-xs font-medium text-gray-800 flex-1 min-w-0 truncate">
                    {item.descripcion}
                  </span>
                  <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                    {item.unidad}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-gray-400">Cant.:</span>
                    <input
                      type="number"
                      value={item.cantidad}
                      onChange={(e) => updateCantidad(item._key, e.target.value)}
                      step="0.1"
                      min="0"
                      className="w-16 text-xs text-right border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#2D8D68]/30 focus:border-[#2D8D68]"
                    />
                  </div>
                </div>

                {/* Template match badge or warning */}
                <div className="mt-1">
                  {item.template_match ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                      <Link size={9} />
                      Fórmula: {item.template_match.nombre}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      <AlertTriangle size={9} />
                      Sin fórmula: se usa la composición que estimó la IA
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Error: above the buttons */}
        {error && (
          <div role="alert" className="bg-red-50 border-t border-red-200 text-red-700 text-xs px-6 py-2.5 flex-shrink-0">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-2xl flex items-center justify-between flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
          >
            Cancelar (no se crea nada)
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="bg-[#2D8D68] hover:bg-[#1B5E4B] disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {confirming && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {confirming
              ? 'Creando...'
              : accepted.length === 0
                ? 'Crear sin los trabajos del plano'
                : `Confirmar y crear (${trabajos(accepted.length)})`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared: OptionCard ─────────────────────────────────────────────────────

function OptionCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`p-4 rounded-lg border-2 text-left transition-all ${
        active
          ? 'border-[#2D8D68] bg-[#E8F5EE]'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div
        className={`mb-2 ${active ? 'text-[#2D8D68]' : 'text-gray-400'}`}
      >
        {icon}
      </div>
      <div className={`text-sm font-semibold ${active ? 'text-[#143D34]' : 'text-gray-700'}`}>
        {title}
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{description}</div>
    </button>
  )
}
