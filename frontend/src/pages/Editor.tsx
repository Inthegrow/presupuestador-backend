import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Edit3, ChevronRight, ChevronDown, ChevronUp, Plus, CheckCircle, AlertCircle, X, Loader2, LayoutGrid, MousePointerClick, Command, RefreshCw, Sparkles, GitCompare, Download, FilePlus2 } from 'lucide-react'
import { budgetApi, mensajeDeError } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { fmtCurrency, fmtNumber, fmtPesos } from '../lib/format'
import { escaleraDe, indirectosCompletos, pctsEscalera } from '../lib/cascada'
import type { Budget, TreeNode, BudgetItem, IndirectConfig } from '../types'
import TreeView from '../components/ui/TreeView'
import DataTable from '../components/ui/DataTable'
import CostSummaryBar from '../components/ui/CostSummaryBar'
import MarkupChainDisplay from '../components/ui/MarkupChainDisplay'
import ViewModeSelector from '../components/ui/ViewModeSelector'
import AddItemForm from '../components/ui/AddItemForm'
import AgregarTrabajo from '../components/ui/AgregarTrabajo'
import type { AgregarTrabajoResult } from '../lib/api'
import { estadoEnTabla } from '../lib/semaforo'
import { regroupItems } from '../lib/viewModes'
import type { ViewMode } from '../lib/viewModes'
import { usePantalla } from '../lib/pantalla'
import AccionesEncabezado from '../components/editor/AccionesEncabezado'
import type { Accion } from '../components/editor/AccionesEncabezado'
import EscaleraResumen from '../components/editor/EscaleraResumen'
import HojaInferior from '../components/editor/HojaInferior'
import TarjetasTrabajos from '../components/editor/TarjetasTrabajos'


const FIELD_LABELS: Record<string, string> = {
  cantidad: 'Cantidad',
  mat_unitario: 'Materiales por unidad',
  mo_unitario: 'Mano de obra por unidad',
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

let toastIdCounter = 0

// Con poca pantalla (notebook baja o celular) la escalera arranca cerrada; si Sol la abre, la app se acuerda
const ESCALERA_KEY = 'presupuestador.escaleraAbierta'

function leerEscaleraAbierta(): boolean {
  try {
    return localStorage.getItem(ESCALERA_KEY) === '1'
  } catch {
    return false
  }
}

const NOMBRE_VISTA: Record<ViewMode, string> = { rubro: 'Rubro', piso: 'Piso', material: 'Material', tipo: 'Gremio' }

export default function Editor() {
  const { puedeEditar } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { celular, chica, baja } = usePantalla()
  // Notebook baja (800 px de alto o menos, 1024 o más de ancho): lo de arriba de la tabla va compacto
  const compacta = baja && !chica
  const [escaleraAbierta, setEscaleraAbierta] = useState<boolean>(leerEscaleraAbierta)
  const abrirEscalera = (abierta: boolean) => {
    setEscaleraAbierta(abierta)
    try { localStorage.setItem(ESCALERA_KEY, abierta ? '1' : '0') } catch { /* sin almacenamiento: vale solo por ahora */ }
  }
  // Celular: el árbol se abre en una hoja desde abajo
  const [hojaArbol, setHojaArbol] = useState(false)
  const filaTituloRef = useRef<HTMLDivElement>(null)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const estadoRef = useRef<HTMLDivElement>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [, setTree] = useState<TreeNode[]>([])
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [allItems, setAllItems] = useState<BudgetItem[]>([])
  const [items, setItems] = useState<BudgetItem[]>([])
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('rubro')
  const [originalTree, setOriginalTree] = useState<TreeNode[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  // Rubro que Sol eligió a mano en el árbol: los trabajos nuevos van ahí (la selección automática no cuenta)
  const [rubroElegido, setRubroElegido] = useState<TreeNode | null>(null)
  // Precios que faltan en cada trabajo, y de qué trabajos se preguntó (null: la consulta falló o no volvió)
  const [faltantes, setFaltantes] = useState<{ porItem: Record<string, number>; recursosPorItem: Record<string, number>; ids: Set<string> } | null>(null)
  const faltantesReq = useRef(0)
  // Los % de la obra (para mostrarlos al lado de cada renglón). null = cargando o no se pudieron leer
  const [indirectConfig, setIndirectConfig] = useState<IndirectConfig | null>(null)
  const [indirectFallo, setIndirectFallo] = useState(false)

  const [recalculating, setRecalculating] = useState(false)
  // Error del último "Recálculo completo" (queda a la vista hasta cerrarlo o volver a probar)
  const [recalcError, setRecalcError] = useState<string[] | null>(null)
  const [savingVersion, setSavingVersion] = useState(false)
  // Last saved version: undefined = not known yet (or could not be read), null = none saved
  const [ultimaVersion, setUltimaVersion] = useState<number | null | undefined>(undefined)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)

  const STATUS_OPTIONS = [
    { value: 'draft', label: 'Borrador', badgeCls: 'bg-gray-100 text-gray-600 border-gray-200' },
    { value: 'review', label: 'En revisión', badgeCls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    { value: 'approved', label: 'Aprobado', badgeCls: 'bg-green-100 text-green-700 border-green-200' },
    { value: 'sent', label: 'Enviado', badgeCls: 'bg-blue-100 text-blue-700 border-blue-200' },
  ]

  // Section CRUD state
  const [showSectionForm, setShowSectionForm] = useState(false)
  const [sectionCodigo, setSectionCodigo] = useState('')
  const [sectionNombre, setSectionNombre] = useState('')
  const [sectionSaving, setSectionSaving] = useState(false)
  const sectionCodigoRef = useRef<HTMLInputElement>(null)

  // Regroup items when view mode changes
  const displayTree = useMemo(
    () => regroupItems(viewMode, originalTree, allItems),
    [viewMode, originalTree, allItems],
  )

  /** Return items that belong to a given tree node. */
  const getItemsForNode = useCallback((node: TreeNode, all: BudgetItem[]): BudgetItem[] => {
    // Virtual nodes from regrouping (piso/material/gremio views)
    // children are TreeNode wrappers via itemToLeaf — look up real BudgetItems by ID
    if (node.id.startsWith('__virtual_')) {
      if (node.children && node.children.length > 0) {
        const childIds = new Set(node.children.map((c) => c.id))
        return all.filter((i) => childIds.has(i.id))
      }
      return []
    }

    const code = node.code ?? ''
    const isLeafItem = code.includes('.')

    // Leaf item (e.g. "1.1", "3.2"): ALWAYS show itself only
    if (isLeafItem) {
      return all.filter((i) => i.id === node.id)
    }

    // Section header (e.g. "1", "2"): show all items in this section
    const sectionMatch = code.match(/^(\d+)/)
    if (sectionMatch) {
      const prefix = sectionMatch[1] + '.'
      const byCode = all.filter((i) => i.code?.startsWith(prefix) && i.id !== node.id)
      if (byCode.length > 0) return byCode
    }

    // Fallback: items with this node as parent
    const byParent = all.filter((i) => i.parent_id === node.id)
    if (byParent.length > 0) return byParent

    // Nothing found: show self
    return all.filter((i) => i.id === node.id)
  }, [])

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const tid = ++toastIdCounter
    setToasts((prev) => [...prev, { id: tid, message, type }])
    // Los errores quedan más tiempo: hay que poder leerlos
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== tid))
    }, type === 'error' ? 9000 : 4000)
  }, [])

  const removeToast = useCallback((tid: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== tid))
  }, [])

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!id) return
    setStatusChanging(true)
    setShowStatusMenu(false)
    try {
      const updated = await budgetApi.update(id, { status: newStatus })
      setBudget((prev) => prev ? { ...prev, status: updated.status } : prev)
      const label = [
        { value: 'draft', label: 'Borrador' },
        { value: 'review', label: 'En revisión' },
        { value: 'approved', label: 'Aprobado' },
        { value: 'sent', label: 'Enviado' },
      ].find((s) => s.value === newStatus)?.label ?? newStatus
      addToast(`Estado actualizado: ${label}`)
    } catch {
      addToast('No se pudo cambiar el estado. Probá de nuevo.', 'error')
    }
    setStatusChanging(false)
  }, [id, addToast])

  /** Refresh tree and items from the API */
  const refreshData = useCallback(async () => {
    if (!id) return
    const [{ budget: b, tree: t }, fetchedItems] = await Promise.all([
      budgetApi.getFull(id),
      budgetApi.getItems(id),
    ])
    setBudget(b)
    setTree(t)
    setOriginalTree(t)
    setAllItems(fetchedItems)
    return { tree: t, items: fetchedItems }
  }, [id])

  /** Pide los faltantes de todo el presupuesto (para el punto de color). Respuestas viejas se ignoran;
   *  si falla, la tabla queda sin puntos: nunca verde sin saber. */
  const cargarFaltantes = useCallback(async (conItems: BudgetItem[]) => {
    if (!id) return
    const req = ++faltantesReq.current
    const ids = new Set(conItems.map((i) => i.id))
    try {
      const r = await budgetApi.preciosFaltantesPorItem(id)
      const porItem = r && typeof r.por_item === 'object' && r.por_item !== null ? r.por_item : null
      const recursosPorItem = r && typeof r.recursos_por_item === 'object' && r.recursos_por_item !== null
        ? r.recursos_por_item : null
      if (req === faltantesReq.current) {
        setFaltantes(porItem && recursosPorItem ? { porItem, recursosPorItem, ids } : null)
      }
    } catch {
      if (req === faltantesReq.current) setFaltantes(null)
    }
  }, [id])

  /** La sección (rubro) de un nodo del árbol, o null si no está en un rubro de verdad */
  const rubroDe = useCallback((node: TreeNode): TreeNode | null => {
    if (node.id.startsWith('__virtual_')) return null
    if (node.notas === 'Seccion') return node
    if (node.parent_id) return originalTree.find((n) => n.id === node.parent_id && n.notas === 'Seccion') ?? null
    return null
  }, [originalTree])

  useEffect(() => {
    if (!id) return
    refreshData()
      .then((data) => {
        if (!data) return
        cargarFaltantes(data.items)
        const firstNode = data.tree[0] ?? null
        if (firstNode) {
          setSelectedNode(firstNode)
          setItems(getItemsForNode(firstNode, data.items))
        }
      })
      .catch(() => {/* keep empty state */})
      .finally(() => setLoading(false))
    setUltimaVersion(undefined)
    budgetApi.getVersions(id)
      .then((vs) => {
        const nums = (Array.isArray(vs) ? vs : []).map((v) => v.version ?? 0)
        setUltimaVersion(nums.length > 0 ? Math.max(...nums) : null)
      })
      .catch(() => setUltimaVersion(undefined))
    setIndirectFallo(false)
    budgetApi.getIndirects(id).then(config => {
      if (config) setIndirectConfig(config)
      else setIndirectFallo(true)
    }).catch(() => setIndirectFallo(true))
  }, [id, refreshData, getItemsForNode, cargarFaltantes])

  // Recálculo completo: la misma cuenta que "Recalcular" de Coeficiente de pase (fórmulas, desperdicio, redondeo e
  // indirectos). Si falla, o si alguna fórmula no se pudo calcular, queda escrito en rojo arriba de la tabla.
  async function handleRecalculate() {
    if (!id || recalculating) return
    setRecalculating(true)
    setRecalcError(null)
    try {
      const r = await budgetApi.cascadeRecalculate(id)
      const data = await refreshData()
      // Refresca también la lista visible del rubro elegido (si no, la tabla queda con los números viejos)
      if (data && selectedNode) setItems(getItemsForNode(selectedNode, data.items))
      if (data) cargarFaltantes(data.items)
      const errores = Array.isArray(r?.errores) ? r.errores : []
      if (errores.length > 0) setRecalcError(errores)
      else addToast('Listo: precios recalculados')
    } catch (err) {
      setRecalcError([mensajeDeError(err, 'No se pudo recalcular. Probá de nuevo.')])
    } finally {
      setRecalculating(false)
    }
  }

  async function handleSaveVersion() {
    if (!id || savingVersion) return
    setSavingVersion(true)
    try {
      const v = await budgetApi.createVersion(id)
      addToast(v?.version ? `Versión v${v.version} guardada` : 'Versión guardada')
      if (v?.version) setUltimaVersion(v.version)
    } catch (err) {
      addToast(`No se guardó la versión: ${mensajeDeError(err)}`, 'error')
    } finally {
      setSavingVersion(false)
    }
  }

  // Edición en la tabla: el servidor guarda y hace la cuenta completa de ese trabajo (indirectos, beneficio,
  // impuestos, IVA) y devuelve el trabajo ya calculado. Si falla, se dice y la celda queda en rojo.
  const handleEditItem = useCallback(async (itemId: string, field: string, oldValue: number, newValue: number) => {
    if (!id) throw new Error('Falta el presupuesto')

    const fieldLabel = FIELD_LABELS[field] ?? field
    const formatVal = field === 'cantidad' ? (v: number) => fmtNumber(v, 2) : fmtCurrency

    let updatedItem: BudgetItem | undefined
    try {
      const result = await budgetApi.updateItem(id, itemId, { [field]: newValue })
      updatedItem = (result as unknown as { item?: BudgetItem })?.item
      if (!updatedItem) throw new Error('El servidor no devolvió el trabajo actualizado')
    } catch (err) {
      addToast(`No se guardó el cambio en ${fieldLabel.toLowerCase()}: ${mensajeDeError(err)}`, 'error')
      throw err
    }

    const nuevo = updatedItem
    setAllItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...nuevo } : item)))
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...nuevo } : item)))

    addToast(`${fieldLabel}: ${formatVal(oldValue)} → ${formatVal(newValue)}`)
  }, [id, addToast])

  /** Suggest next section code */
  const suggestNextSectionCode = useCallback((): string => {
    let maxCode = 0
    for (const node of originalTree) {
      const m = (node.code ?? '').match(/^(\d+)/)
      if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10))
    }
    return String(maxCode + 1)
  }, [originalTree])

  /** Create a new section */
  const handleCreateSection = useCallback(async () => {
    if (!id || !sectionCodigo.trim() || !sectionNombre.trim()) return
    setSectionSaving(true)
    try {
      await budgetApi.createSection(id, {
        codigo: sectionCodigo.trim(),
        nombre: sectionNombre.trim(),
      })
      const data = await refreshData()
      if (data) {
        // Select the newly created section (last in tree)
        const newNode = data.tree[data.tree.length - 1]
        if (newNode) {
          setSelectedNode(newNode)
          setItems(getItemsForNode(newNode, data.items))
        }
      }
      addToast(`Rubro creado: ${sectionCodigo} - ${sectionNombre}`)
      setShowSectionForm(false)
      setSectionCodigo('')
      setSectionNombre('')
    } catch (err) {
      addToast(`No se pudo crear el rubro: ${mensajeDeError(err)}`, 'error')
    } finally {
      setSectionSaving(false)
    }
  }, [id, sectionCodigo, sectionNombre, refreshData, getItemsForNode, addToast])

  /** Edit a section name */
  const handleEditSection = useCallback(async (node: TreeNode, newName: string) => {
    if (!id) return
    try {
      await budgetApi.updateItem(id, node.id, { description: newName })
      const data = await refreshData()
      if (data) {
        // Re-select the same node if it was selected
        if (selectedNode?.id === node.id) {
          const updatedNode = data.tree.find((n) => n.id === node.id)
          if (updatedNode) {
            setSelectedNode(updatedNode)
            setItems(getItemsForNode(updatedNode, data.items))
          }
        }
      }
      addToast(`Rubro renombrado: ${newName}`)
    } catch (err) {
      addToast(`No se pudo renombrar el rubro: ${mensajeDeError(err)}`, 'error')
    }
  }, [id, selectedNode, refreshData, getItemsForNode, addToast])

  /** Delete an empty section */
  const handleDeleteSection = useCallback(async (node: TreeNode) => {
    if (!id) return
    try {
      await budgetApi.deleteItem(id, node.id)
      const data = await refreshData()
      if (data) {
        // If deleted node was selected, select first available
        if (rubroElegido?.id === node.id) setRubroElegido(null)
        if (selectedNode?.id === node.id) {
          const firstNode = data.tree[0] ?? null
          setSelectedNode(firstNode)
          setItems(firstNode ? getItemsForNode(firstNode, data.items) : [])
        }
      }
      addToast(`Rubro borrado: ${node.description}`)
    } catch (err) {
      addToast(`No se pudo borrar el rubro: ${mensajeDeError(err)}`, 'error')
    }
  }, [id, selectedNode, rubroElegido, refreshData, getItemsForNode, addToast])

  /** Suggest next item code based on existing items in section */
  const suggestNextCode = useCallback((): string => {
    if (!selectedNode) return ''
    const sectionCode = selectedNode.code ?? ''
    const sectionMatch = sectionCode.match(/^(\d+)\s*[-.]?/)
    if (!sectionMatch) return ''
    const prefix = sectionMatch[1] + '.'
    let maxSub = 0
    for (const item of items) {
      const m = (item.code ?? '').match(new RegExp(`^${sectionMatch[1]}\\.(\\d+)`))
      if (m) maxSub = Math.max(maxSub, parseInt(m[1], 10))
    }
    return `${prefix}${maxSub + 1}`
  }, [selectedNode, items])

  /** Find the section parent for the currently selected node */
  const findSectionParent = useCallback((): TreeNode | null => {
    if (!selectedNode) return null
    const code = selectedNode.code ?? ''
    // If already a section (no dot in code), use it
    if (!code.includes('.')) return selectedNode
    // Extract section number and find the section node
    const sectionNum = code.split('.')[0]
    const section = originalTree.find((n) => {
      const c = n.code ?? ''
      const m = c.match(/^(\d+)/)
      return m && m[1] === sectionNum && !c.includes('.')
    })
    return section ?? selectedNode
  }, [selectedNode, originalTree])

  /** Handle adding a new item */
  const handleAddItem = useCallback(async (data: {
    code: string
    description: string
    unidad: string
    cantidad: number
    mat_unitario: number
    mo_unitario: number
  }) => {
    if (!id) throw new Error('Falta el presupuesto')

    // Siempre dentro de la sección (rubro), no del trabajo elegido; sin nada elegido, queda suelto
    const sectionNode = selectedNode ? findSectionParent() : null
    const parentId = sectionNode?.id ?? selectedNode?.id

    const newItem = await budgetApi.createItem(id, {
      code: data.code,
      description: data.description,
      unidad: data.unidad,
      cantidad: data.cantidad,
      mat_unitario: data.mat_unitario,
      mo_unitario: data.mo_unitario,
      ...(parentId ? { parent_id: parentId } : {}),
    })

    const fresh = await refreshData()
    if (fresh) {
      if (selectedNode) {
        setItems(getItemsForNode(selectedNode, fresh.items))
      } else {
        // Sin nada elegido: mostrar el trabajo recién creado
        const creado = fresh.items.find((i) => i.code === data.code && i.description === data.description)
        if (creado) setItems([creado])
      }
      cargarFaltantes(fresh.items)
    }
    setShowAddForm(false)
    addToast(`Trabajo agregado: ${(Array.isArray(newItem) ? newItem[0]?.code : newItem?.code) ?? data.code} ${data.description}`)
  }, [id, selectedNode, addToast, getItemsForNode, findSectionParent, refreshData, cargarFaltantes])

  /** Después de agregar un trabajo con fórmula: refresca árbol, tabla y puntos, y muestra el rubro donde quedó */
  const handleTrabajoAgregado = useCallback(async (res: AgregarTrabajoResult) => {
    const data = await refreshData()
    if (!data) return
    cargarFaltantes(data.items)
    const arbol = regroupItems(viewMode, data.tree, data.items)
    const buscar = (nodos: TreeNode[], nid?: string): TreeNode | null => {
      if (!nid) return null
      for (const n of nodos) {
        if (n.id === nid) return n
        const h = buscar((n.children ?? []) as TreeNode[], nid)
        if (h) return h
      }
      return null
    }
    // Con un rubro elegido, se queda en ese; si no, se muestra el rubro de la fórmula
    const destinoId = rubroElegido?.id ?? (viewMode === 'rubro' ? res?.rubro?.id : selectedNode?.id)
    const nodo = buscar(arbol, destinoId) ?? (selectedNode ? buscar(arbol, selectedNode.id) : null)
    if (nodo) {
      setSelectedNode(nodo)
      setItems(getItemsForNode(nodo, data.items))
      if (rubroElegido) setRubroElegido(nodo)
    } else {
      const nuevo = data.items.find((i) => i.id === res?.item?.id)
      if (nuevo) setItems([nuevo])
    }
  }, [refreshData, cargarFaltantes, viewMode, rubroElegido, selectedNode, getItemsForNode])

  // Open section form with suggested code
  const openSectionForm = useCallback(() => {
    setSectionCodigo(suggestNextSectionCode())
    setSectionNombre('')
    setShowSectionForm(true)
    setTimeout(() => sectionCodigoRef.current?.focus(), 50)
  }, [suggestNextSectionCode])

  const selectedLabel = selectedNode
    ? `${selectedNode.code ? selectedNode.code + ' ' : ''}${selectedNode.description ?? ''}`
    : '\u2014'

  // Totales: la suma de lo que guardó el servidor en cada trabajo (los rubros no suman)
  const trabajos = useMemo(() => allItems.filter((i) => i.notas !== 'Seccion'), [allItems])
  // "Diferencias con el Excel" only for a budget that came from an Excel with totals: the same rule the server
  // uses for /obras/{id}/diferencias (works with excel_neto saved, and at least one Excel amount that is not 0)
  const tieneTotalesExcel = useMemo(
    () => trabajos.some((i) => i.excel_neto != null && (Number(i.excel_neto) !== 0 || Number(i.excel_directo ?? 0) !== 0)),
    [trabajos],
  )
  const ivaPct = indirectConfig ? indirectosCompletos(indirectConfig).iva_pct : null
  const escalera = useMemo(() => escaleraDe(trabajos, ivaPct), [trabajos, ivaPct])
  const pcts = pctsEscalera(indirectConfig)
  // Lo elegido en el árbol
  const trabajosElegidos = items.filter((i) => i.notas !== 'Seccion')
  const directo = trabajosElegidos.reduce((s, i) => s + (i.directo_total ?? 0), 0)
  const netoElegido = trabajosElegidos.reduce((s, i) => s + (i.neto_total ?? 0), 0)


  const estadoActual = STATUS_OPTIONS.find((s) => s.value === (budget?.status ?? 'draft'))

  // Elegir en el árbol (en el celular, además cierra la hoja)
  const elegirNodo = (node: TreeNode) => {
    setSelectedNode(node)
    setItems(getItemsForNode(node, allItems))
    setRubroElegido(rubroDe(node))
    setHojaArbol(false)
  }

  const borrarTrabajo = async (itemId: string, desc: string) => {
    if (!id) return
    try {
      await budgetApi.deleteItem(id, itemId)
      const refreshedItems = await budgetApi.getItems(id)
      setAllItems(refreshedItems)
      if (selectedNode) setItems(getItemsForNode(selectedNode, refreshedItems))
      cargarFaltantes(refreshedItems)
      addToast(`Trabajo borrado: ${desc}`)
    } catch (err) {
      addToast(`No se pudo borrar el trabajo: ${mensajeDeError(err)}`, 'error')
    }
  }

  // Los botones del encabezado: los que no entran van a "Más" (en el celular, todos)
  const acciones: Accion[] = [
    ...(puedeEditar ? [{
      key: 'recalculo',
      label: recalculating ? 'Recalculando...' : 'Recálculo completo',
      icon: RefreshCw,
      girando: recalculating,
      onClick: handleRecalculate,
      disabled: recalculating,
      title: 'Vuelve a calcular todos los trabajos: fórmulas, precios y Coeficiente de pase',
      prioridad: 3,
    }] : []),
    { key: 'planos', label: 'Planos con IA', icon: Sparkles, onClick: () => navigate(`/app/budgets/${id ?? '1'}/ai`), prioridad: 1 },
    ...(tieneTotalesExcel ? [{
      key: 'diferencias',
      label: 'Diferencias con el Excel',
      icon: GitCompare,
      onClick: () => navigate(`/app/budgets/${id ?? '1'}/diferencias`),
      prioridad: 2,
    }] : []),
    { key: 'exportar', label: 'Exportar', icon: Download, onClick: () => navigate(`/app/budgets/${id ?? '1'}/export`), prioridad: 4 },
  ]
  const minIzquierda = () => {
    const natural = tituloRef.current?.scrollWidth ?? 0
    const estado = estadoRef.current?.getBoundingClientRect().width ?? 0
    // raya + nombre (hasta 200 px; si no entra, se corta con …) + estado + separaciones
    return 4 + 12 + Math.min(natural, 200) + 12 + estado + 12
  }

  const botonGuardar = puedeEditar ? (
    <button
      onClick={handleSaveVersion}
      disabled={savingVersion}
      className={`disabled:opacity-60 bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] hover:from-[#1B5E4B] hover:to-[#143D34] text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow-md whitespace-nowrap ${
        celular ? 'h-10 px-3.5 text-[14px]' : 'h-9 px-5 text-xs'}`}
    >
      {savingVersion ? 'Guardando…' : 'Guardar versión'}
    </button>
  ) : undefined

  const chipVersion = ultimaVersion !== undefined && (
    <span
      data-testid="version-editor"
      title={ultimaVersion === null ? 'Todavía no se guardó ninguna versión' : 'Última versión guardada'}
      className={`bg-[#E8F5EE] text-[#1B5E4B] font-medium rounded-full whitespace-nowrap ${celular ? 'text-[11px] px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5'}`}
    >
      {ultimaVersion === null ? 'Sin versiones' : `v${ultimaVersion}`}
    </span>
  )

  const menuEstado = (
    <div className="relative flex-shrink-0" ref={estadoRef}>
      <button
        onClick={() => setShowStatusMenu((v) => !v)}
        disabled={statusChanging || !puedeEditar}
        aria-haspopup="menu"
        aria-expanded={showStatusMenu}
        className={`flex items-center gap-1.5 rounded-full border font-medium transition-all hover:opacity-80 disabled:opacity-60 whitespace-nowrap ${
          celular ? 'h-10 px-3.5 text-[13px]' : 'px-2.5 py-1 text-xs'} ${estadoActual?.badgeCls ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}
      >
        {estadoActual?.label ?? 'Borrador'}
        {puedeEditar && <span className="text-[10px] opacity-60">▾</span>}
      </button>
      {showStatusMenu && puedeEditar && (
        <>
        <div className="fixed inset-0 z-20" onClick={() => setShowStatusMenu(false)} />
        <div role="menu" className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[160px]">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="menuitem"
              onClick={() => handleStatusChange(opt.value)}
              className={`w-full text-left px-3 py-1.5 max-md:min-h-11 text-xs font-medium hover:bg-gray-50 flex items-center gap-2 ${opt.value === (budget?.status ?? 'draft') ? 'opacity-50 cursor-default' : ''}`}
            >
              <span className={`px-2 py-0.5 rounded-full border text-xs max-md:text-[13px] ${opt.badgeCls}`}>{opt.label}</span>
            </button>
          ))}
        </div>
        </>
      )}
    </div>
  )

  const ocultarEscalera = (
    <button
      type="button"
      onClick={() => abrirEscalera(false)}
      aria-expanded
      aria-label="Ocultar la escalera"
      className="flex-shrink-0 whitespace-nowrap flex items-center gap-1 text-xs max-md:text-[13px] font-semibold text-[#2D8D68] hover:bg-[#E8F5EE] rounded-xl px-2.5 h-8 max-md:h-10 -my-1"
    >
      Ocultar<span className="max-md:hidden"> la escalera</span> <ChevronUp size={14} />
    </button>
  )

  const escaleraCompleta = (apilada: boolean, conOcultar: boolean) => (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 px-3 pt-2.5 pb-1.5 ${celular ? 'mb-3' : 'mb-3 [@media(max-height:800px)]:mb-2'}`}>
      <CostSummaryBar
        escalera={escalera}
        pcts={pcts}
        apilada={apilada}
        accion={conOcultar ? ocultarEscalera : undefined}
        titulo={<>Todo el presupuesto · {trabajos.length} {trabajos.length === 1 ? 'trabajo' : 'trabajos'}</>}
      />
      <MarkupChainDisplay config={indirectConfig} budgetId={id} fallo={indirectFallo} />
    </div>
  )

  const escaleraBloque = loading ? null
    : celular
      ? escaleraAbierta
        ? escaleraCompleta(true, true)
        : (
          <div className="mb-3">
            <EscaleraResumen escalera={escalera} pcts={pcts} trabajos={trabajos.length} variante="tarjeta" onVer={() => abrirEscalera(true)} />
          </div>
        )
      : compacta && !escaleraAbierta
        ? (
          <div className="mb-2">
            <EscaleraResumen escalera={escalera} pcts={pcts} trabajos={trabajos.length} variante="renglon" onVer={() => abrirEscalera(true)} />
          </div>
        )
        : escaleraCompleta(false, compacta)

  // Formulario para crear un rubro (en el panel del árbol o en la hoja del celular)
  const formRubro = showSectionForm && (
    <div className="px-2.5 py-2.5 max-lg:px-4 max-lg:py-3 border-b bg-gradient-to-b from-[#F8FBF9] to-white">
      <div className="flex gap-1.5 mb-1.5 max-lg:gap-2 max-lg:mb-2">
        <input
          ref={sectionCodigoRef}
          type="text"
          placeholder="N.º"
          aria-label="Número del rubro"
          value={sectionCodigo}
          onChange={(e) => setSectionCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreateSection()
            if (e.key === 'Escape') setShowSectionForm(false)
          }}
          className="w-12 max-lg:w-16 max-lg:h-11 px-1.5 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
        />
        <input
          type="text"
          placeholder="Nombre del rubro"
          aria-label="Nombre del rubro"
          value={sectionNombre}
          onChange={(e) => setSectionNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreateSection()
            if (e.key === 'Escape') setShowSectionForm(false)
          }}
          className="flex-1 min-w-0 max-lg:h-11 px-1.5 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
        />
      </div>
      <div className="flex gap-1.5 max-lg:gap-2">
        <button
          onClick={handleCreateSection}
          disabled={sectionSaving || !sectionCodigo.trim() || !sectionNombre.trim()}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 max-lg:h-11 max-lg:text-sm bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] hover:from-[#1B5E4B] hover:to-[#143D34] disabled:from-gray-300 disabled:to-gray-300 text-white text-[11px] font-medium rounded-lg transition-all duration-200"
        >
          {sectionSaving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Crear
        </button>
        <button
          onClick={() => setShowSectionForm(false)}
          className="px-2 py-1 max-lg:h-11 max-lg:px-4 max-lg:text-sm bg-white border border-gray-200 text-gray-500 text-[11px] font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  )

  const arbol = (
    <TreeView
      nodes={displayTree}
      selectedId={selectedNode?.id}
      onSelect={elegirNodo}
      onEditSection={puedeEditar ? handleEditSection : undefined}
      onDeleteSection={puedeEditar ? handleDeleteSection : undefined}
      grande={chica}
    />
  )

  const sinFormula = (
    <div className={showAddForm || !compacta ? 'mt-2' : ''}>
      {!compacta && (
        <button
          onClick={() => setShowAddForm((v) => !v)}
          aria-expanded={showAddForm}
          className="text-[11px] max-md:text-[13px] max-md:min-h-10 text-[#2D8D68] font-medium hover:underline flex items-center gap-1"
        >
          <ChevronRight size={12} className={`transition-transform ${showAddForm ? 'rotate-90' : ''}`} />
          Agregar un trabajo sin fórmula (precio a mano)
        </button>
      )}
      {showAddForm && (
        <div className="-mx-4">
          <AddItemForm
            suggestedCode={suggestNextCode()}
            onSubmit={handleAddItem}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}
    </div>
  )

  const agregarTrabajo = puedeEditar && id ? (
    <AgregarTrabajo
      budgetId={id}
      variante={celular ? 'celular' : compacta ? 'compacta' : 'normal'}
      rubroElegido={rubroElegido ? {
        id: rubroElegido.id,
        nombre: `${rubroElegido.code ? rubroElegido.code + ' ' : ''}${rubroElegido.description ?? ''}`.trim(),
      } : null}
      onSoltarRubro={() => setRubroElegido(null)}
      onAgregado={handleTrabajoAgregado}
      onVerTrabajo={(itemId) => navigate(`/app/budgets/${id}/item/${itemId}`)}
      enRenglon={compacta ? (
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          aria-expanded={showAddForm}
          aria-label="Agregar un trabajo sin fórmula (precio a mano)"
          title="Agregar un trabajo sin fórmula (precio a mano)"
          className={`flex-shrink-0 flex items-center gap-1 h-[38px] px-2.5 rounded-xl text-xs font-medium border transition-colors ${
            showAddForm ? 'border-[#2D8D68]/40 bg-white text-[#1B5E4B]' : 'border-transparent text-[#2D8D68] hover:bg-white'}`}
        >
          <FilePlus2 size={14} /> <span className="hidden 2xl:inline">Sin fórmula</span>
        </button>
      ) : undefined}
      pie={sinFormula}
    />
  ) : null

  const sinTrabajosEnLaObra = items.length === 0 && !loading && puedeEditar && !allItems.some((i) => i.notas !== 'Seccion')

  const vacioObra = (
    <div className="py-12 px-8 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
        <LayoutGrid size={28} className="text-gray-300" />
      </div>
      <h3 className="text-sm font-semibold text-gray-500 mb-1">
        Este presupuesto todavía no tiene trabajos
      </h3>
      <p className="text-xs max-md:text-[13px] text-gray-400 max-w-xs mx-auto">
        Escribí el primero arriba, en «Agregá un trabajo»: por ejemplo «hueco 18» y la cantidad.
      </p>
    </div>
  )

  const resumenElegido = (
    <p className={`text-gray-400 mt-0.5 flex items-center gap-x-1.5 flex-wrap ${celular ? 'text-[12px]' : 'text-[10px]'}`}>
      <span className="inline-flex items-center gap-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2D8D68] inline-block" />
        {trabajosElegidos.length} {trabajosElegidos.length === 1 ? 'trabajo' : 'trabajos'}
      </span>
      <span className="text-gray-300">|</span>
      <span>Costo directo {fmtPesos(directo)}</span>
      <span className="text-gray-300">|</span>
      <span className="font-semibold text-[#1B5E4B]" data-testid="precio-sin-iva-elegido">Precio sin IVA {fmtPesos(netoElegido)}</span>
    </p>
  )

  return (
    <div className={celular ? 'px-4 pt-3 pb-10 fade-in' : 'p-4 fade-in h-full flex flex-col'}>
      {/* Toast notifications (en el celular, abajo y a lo ancho) */}
      <div className="fixed z-50 flex flex-col gap-2 max-md:left-4 max-md:right-4 max-md:bottom-4 md:top-4 md:right-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-xs max-md:text-[13px] font-medium animate-slide-in backdrop-blur-sm ${
              toast.type === 'success'
                ? 'bg-[#E8F5EE]/95 text-[#1B5E4B] border border-[#2D8D68]/20'
                : 'bg-red-50/95 text-red-700 border border-red-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle size={14} className="text-[#2D8D68] flex-shrink-0" />
            ) : (
              <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
            )}
            <span className="flex-1 min-w-0">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} aria-label="Cerrar" className="ml-1 opacity-50 hover:opacity-100 transition-opacity max-md:w-8 max-md:h-8 max-md:flex max-md:items-center max-md:justify-center">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in { animation: slideIn 0.3s ease-out; }
        @keyframes treeEnter {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 500px; }
        }
        .tree-children-enter {
          animation: treeEnter 0.2s ease-out;
          overflow: hidden;
        }
        .editable-cell {
          border-bottom: 1px dashed #CBD5E1;
          transition: all 0.15s ease;
        }
        .editable-cell:hover {
          border-bottom-color: #2D8D68;
          background: #FEFCE8;
          border-radius: 2px;
          padding: 1px 2px;
        }
      `}</style>

      {celular ? (
        <div className="mb-3">
          {/* Encabezado del celular: nombre, estado, Más y Guardar versión */}
          <div className="flex items-start gap-2">
            {budget || !loading ? (
              <h1 className="flex-1 min-w-0 pt-1 text-[22px] leading-tight font-extrabold text-gray-900 line-clamp-2 [overflow-wrap:anywhere]">
                {budget?.name?.toUpperCase() ?? 'PRESUPUESTO'}
              </h1>
            ) : (
              <span className="flex-1 block max-w-56 h-7 mt-1 rounded bg-gray-200 animate-pulse" aria-label="Cargando el presupuesto" role="status" data-testid="nombre-cargando" />
            )}
            <AccionesEncabezado
              acciones={acciones}
              todasEnMas
              fila={filaTituloRef}
              minIzquierda={minIzquierda}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-2 min-w-0">
            {menuEstado}
            <span className="min-w-0 truncate">{chipVersion}</span>
            {botonGuardar && <div className="ml-auto flex-shrink-0">{botonGuardar}</div>}
          </div>
        </div>
      ) : (
        <>
          {/* Breadcrumb */}
          <div className="flex items-center flex-wrap gap-1.5 text-xs mb-1">
            <button
              type="button"
              className="text-gray-400 hover:text-[#2D8D68] transition-colors"
              onClick={() => navigate('/app/dashboard')}
            >
              Mis presupuestos
            </button>
            <ChevronRight size={12} className="text-gray-300" />
            {budget ? (
              <span className="font-semibold text-gray-900">{budget.name}</span>
            ) : loading ? (
              <span className="inline-block w-44 h-3 rounded bg-gray-200 animate-pulse" data-testid="nombre-cargando" aria-hidden="true" />
            ) : (
              <span className="font-semibold text-gray-900">Presupuesto</span>
            )}
            {chipVersion}
          </div>

          {/* Section label (con poca altura no se muestra: el breadcrumb ya dice dónde estás) */}
          <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1 [@media(max-height:800px)]:hidden">
            <Edit3 size={14} /> EDITOR DE OBRA
          </div>

          {/* Title bar: un solo renglón; lo que no entra va a "Más" */}
          <div ref={filaTituloRef} className="flex items-center gap-3 mb-3 [@media(max-height:800px)]:mb-2 min-w-0 relative">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-1 h-7 bg-gradient-to-b from-[#2D8D68] to-[#2D8D68]/40 rounded-full flex-shrink-0" />
              {budget || !loading ? (
                <h1 ref={tituloRef} className="text-xl font-extrabold text-gray-900 truncate min-w-0" title={budget?.name ?? undefined}>
                  {budget?.name?.toUpperCase() ?? 'PRESUPUESTO'}
                </h1>
              ) : (
                <span className="inline-block w-64 h-6 rounded bg-gray-200 animate-pulse" aria-label="Cargando el presupuesto" role="status" />
              )}
              {menuEstado}
            </div>
            <AccionesEncabezado
              acciones={acciones}
              principal={botonGuardar}
              todasEnMas={false}
              fila={filaTituloRef}
              minIzquierda={minIzquierda}
              medirOtraVez={`${budget?.name ?? ''}|${budget?.status ?? ''}|${loading}`}
            />
          </div>
        </>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      )}

      {recalcError && (
        <div role="alert" data-testid="error-recalculo" className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs max-md:text-[13px] max-md:flex-wrap">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5 text-red-500" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">El recálculo no terminó bien</p>
            <ul className="mt-1 space-y-0.5">
              {recalcError.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
              {recalcError.length > 6 && <li>y {recalcError.length - 6} más.</li>}
            </ul>
          </div>
          <button onClick={handleRecalculate} disabled={recalculating} className="font-semibold underline hover:text-red-900 disabled:opacity-50 max-md:min-h-10">
            Probar de nuevo
          </button>
          <button onClick={() => setRecalcError(null)} aria-label="Cerrar" className="opacity-60 hover:opacity-100 max-md:w-10 max-md:h-10 max-md:flex max-md:items-center max-md:justify-center">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Del costo directo al precio: todo el presupuesto, con lo guardado en cada trabajo */}
      {escaleraBloque}

      {/* View Mode Selector - top level tabs */}
      <div className={celular ? 'mb-3 -mx-4 px-4' : 'mb-3 [@media(max-height:800px)]:mb-2'}>
        <ViewModeSelector
          mode={viewMode}
          onChange={(m) => {
            setSelectedNode(null)
            setRubroElegido(null)
            setItems([])
            setViewMode(m)
          }}
        />
      </div>

      {celular ? (
        <>
          {/* El árbol, en una hoja desde abajo */}
          <button
            type="button"
            onClick={() => setHojaArbol(true)}
            aria-haspopup="dialog"
            data-testid="elegir-rubro"
            className="w-full min-h-[52px] flex items-center gap-2 bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-2 text-left active:bg-gray-50"
          >
            <span className="text-[13px] text-gray-500 flex-shrink-0">{NOMBRE_VISTA[viewMode]}:</span>
            <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-gray-900">
              {selectedNode ? selectedLabel : 'elegí uno'}
            </span>
            <ChevronDown size={18} className="text-[#2D8D68] flex-shrink-0" />
          </button>
          {selectedNode && <div className="px-1 mt-1.5">{resumenElegido}</div>}

          {agregarTrabajo && <div className="mt-3">{agregarTrabajo}</div>}

          <div className="mt-3">
            {sinTrabajosEnLaObra ? (
              <div className="bg-white rounded-2xl border border-gray-100">{vacioObra}</div>
            ) : items.length === 0 ? (
              !loading && (
                <div className="bg-white rounded-2xl border border-gray-100 py-10 px-6 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 mb-3">
                    <LayoutGrid size={24} className="text-gray-300" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-gray-600 mb-1">Elegí qué trabajos ver</h3>
                  <p className="text-[13px] text-gray-400 mb-4">Por {NOMBRE_VISTA[viewMode].toLowerCase()}: tocá el botón y elegí uno.</p>
                  <button
                    type="button"
                    onClick={() => setHojaArbol(true)}
                    className="h-11 px-5 rounded-xl bg-[#2D8D68] text-white text-[14px] font-semibold"
                  >
                    Elegir {NOMBRE_VISTA[viewMode].toLowerCase()}
                  </button>
                </div>
              )
            ) : (
              <TarjetasTrabajos
                items={items}
                semaforo={(item) => (item.notas === 'Seccion' ? null : estadoEnTabla(item, faltantes))}
                onEditItem={puedeEditar ? handleEditItem : undefined}
                onViewDetail={(itemId) => navigate(`/app/budgets/${id}/item/${itemId}`)}
                onDeleteItem={puedeEditar ? borrarTrabajo : undefined}
              />
            )}
          </div>
          {items.length > 0 && (
            <p className="mt-3 px-1 text-[12px] text-[#1B5E4B]/80 leading-snug">
              Tocá un trabajo para ver su detalle. Al cambiar la cantidad se recalcula el precio con el Coeficiente de pase.
            </p>
          )}

        </>
      ) : (
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Tree Panel (con menos de 1024 px de ancho, el árbol va en una hoja) */}
        {!chica && (
        <div className="w-64 bg-white rounded-2xl shadow-sm border border-gray-100 flex-shrink-0 overflow-hidden flex flex-col">
          {/* Gradient header */}
          <div className="bg-gradient-to-r from-[#143D34] to-[#2D8D68] text-white px-4 py-3 [@media(max-height:800px)]:py-2.5 flex justify-between items-center">
            <span className="font-semibold text-xs tracking-wide">Estructura de obra</span>
            {puedeEditar && (
              <button
                onClick={openSectionForm}
                className="text-[#E0A33A] text-xs font-medium flex items-center gap-0.5 hover:text-yellow-200 transition-colors"
              >
                <Plus size={12} /> Rubro
              </button>
            )}
          </div>

          {/* Inline section creation form */}
          {formRubro}

          <div className="px-2 pt-2.5 pb-2 flex-1 overflow-y-auto">
            {arbol}
          </div>
        </div>
        )}

        {/* Main Content Panel */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          {/* Section header */}
          <div className="bg-gradient-to-r from-gray-50 to-white border-b px-5 py-3 [@media(max-height:800px)]:py-2 flex justify-between items-center flex-shrink-0">
            <div className="min-w-0">
              {chica ? (
                <button
                  type="button"
                  onClick={() => setHojaArbol(true)}
                  aria-haspopup="dialog"
                  data-testid="elegir-rubro"
                  className="max-w-full flex items-center gap-1.5 min-h-10 -my-1 px-3 -mx-3 rounded-xl text-left hover:bg-gray-100"
                >
                  <span className="text-xs text-gray-500 flex-shrink-0">{NOMBRE_VISTA[viewMode]}:</span>
                  <span className="font-bold text-gray-900 text-sm truncate">{selectedNode ? selectedLabel : 'elegí uno'}</span>
                  <ChevronDown size={16} className="text-[#2D8D68] flex-shrink-0" />
                </button>
              ) : (
                <h2 className="font-bold text-gray-900 text-sm truncate">{selectedLabel}</h2>
              )}
              {resumenElegido}
            </div>
          </div>

          {agregarTrabajo}

          <div className="flex-1 min-h-0 overflow-y-auto">
          {sinTrabajosEnLaObra ? vacioObra : items.length === 0 ? (
            <div className="py-16 px-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
                <LayoutGrid size={28} className="text-gray-300" />
              </div>
              <h3 className="text-sm font-semibold text-gray-500 mb-1">
                Elegí un rubro en el árbol
              </h3>
              <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">
                {chica
                  ? <>Tocá «{NOMBRE_VISTA[viewMode]}», arriba, para elegir qué trabajos ver y editar.</>
                  : 'Tocá cualquier rubro del panel de la izquierda para ver y editar sus trabajos.'}
              </p>
              <div className="flex items-center justify-center gap-4 text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  <MousePointerClick size={12} />
                  Tocá para elegir
                </span>
                <span className="flex items-center gap-1">
                  <Command size={12} />
                  Tocá una celda para editarla
                </span>
              </div>
            </div>
          ) : (
            <DataTable
              items={items}
              semaforo={(item) => (item.notas === 'Seccion' ? null : estadoEnTabla(item, faltantes))}
              onEditItem={puedeEditar ? handleEditItem : undefined}
              onViewDetail={(itemId) => navigate(`/app/budgets/${id}/item/${itemId}`)}
              onDeleteItem={!puedeEditar ? undefined : borrarTrabajo}
            />
          )}

          </div>
          <div className="px-5 py-2.5 [@media(max-height:800px)]:py-2 bg-gradient-to-r from-[#E8F5EE] to-[#E8F5EE]/50 text-[10px] text-[#1B5E4B] border-t flex items-center gap-1.5 flex-shrink-0">
            <span className="w-1 h-1 rounded-full bg-[#2D8D68] inline-block" />
            Tocá las celdas punteadas para editar. Cada cambio recalcula el precio del trabajo con el Coeficiente de pase.
          </div>
        </div>
      </div>
      )}

      {hojaArbol && (
        <HojaInferior
          titulo="Estructura de obra"
          onCerrar={() => { setHojaArbol(false); setShowSectionForm(false) }}
          testId="hoja-arbol"
          accion={puedeEditar && viewMode === 'rubro' ? (
            <button
              type="button"
              onClick={openSectionForm}
              className="h-10 px-3 rounded-xl text-[14px] font-semibold text-[#2D8D68] flex items-center gap-1 active:bg-[#E8F5EE]"
            >
              <Plus size={16} /> Rubro
            </button>
          ) : undefined}
        >
          {formRubro}
          <div className="px-2 py-2">{arbol}</div>
        </HojaInferior>
      )}
    </div>
  )
}
