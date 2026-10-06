import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Edit3, ChevronRight, Plus, CheckCircle, AlertCircle, X, Loader2, LayoutGrid, MousePointerClick, Command, RefreshCw } from 'lucide-react'
import { budgetApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { fmtCurrency, fmtNumber } from '../lib/format'
import type { Budget, TreeNode, BudgetItem } from '../types'
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


const MARKUP_LINKS = [
  { label: 'Estr', pct: 15 },
  { label: 'Jef', pct: 8 },
  { label: 'Log', pct: 5 },
  { label: 'Herr', pct: 3 },
  { label: 'Benef', pct: 10 },
]

const FIELD_LABELS: Record<string, string> = {
  cantidad: 'Cantidad',
  mat_unitario: 'MAT Unit',
  mo_unitario: 'MO Unit',
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

let toastIdCounter = 0

export default function Editor() {
  const { puedeEditar } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [budget, setBudget] = useState<Budget | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
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
  const [indirectConfig, setIndirectConfig] = useState<{estructura_pct: number, jefatura_pct: number, logistica_pct: number, herramientas_pct: number} | null>(null)

  const [recalculating, setRecalculating] = useState(false)
  const [autoRecalculating, setAutoRecalculating] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)

  const STATUS_OPTIONS = [
    { value: 'draft', label: 'Borrador', badgeCls: 'bg-gray-100 text-gray-600 border-gray-200' },
    { value: 'review', label: 'En Revisión', badgeCls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
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
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== tid))
    }, 4000)
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
        { value: 'review', label: 'En Revisión' },
        { value: 'approved', label: 'Aprobado' },
        { value: 'sent', label: 'Enviado' },
      ].find((s) => s.value === newStatus)?.label ?? newStatus
      addToast(`Estado actualizado: ${label}`)
    } catch {
      addToast('Error al cambiar estado', 'error')
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
    budgetApi.getIndirects(id).then(config => {
      if (config) setIndirectConfig(config)
    }).catch(() => {})
  }, [id, refreshData, getItemsForNode, cargarFaltantes])

  async function handleRecalculate() {
    if (!id || recalculating) return
    setRecalculating(true)
    try {
      await budgetApi.recalculate(id)
      await budgetApi.applyIndirects(id)
      const data = await refreshData()
      // Refresca también la lista visible del rubro elegido (si no, la tabla queda con los números viejos)
      if (data && selectedNode) setItems(getItemsForNode(selectedNode, data.items))
      if (data) cargarFaltantes(data.items)
    } catch (err) {
      console.error('Error recalculating:', err)
    } finally {
      setRecalculating(false)
    }
  }

  // Handle inline cell edit — PATCH → auto-apply indirects → refresh
  const handleEditItem = useCallback(async (itemId: string, field: string, oldValue: number, newValue: number) => {
    if (!id) throw new Error('No budget ID')

    const fieldLabel = FIELD_LABELS[field] ?? field
    const formatVal = field === 'cantidad' ? (v: number) => fmtNumber(v, 2) : fmtCurrency

    // 1. PATCH the item
    const result = await budgetApi.updateItem(id, itemId, { [field]: newValue })
    const updatedItem = (result as unknown as { item: BudgetItem }).item
    if (!updatedItem) throw new Error('No updated item in response')

    // Optimistic update — show new directo_total immediately
    setAllItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...updatedItem } : item)),
    )
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...updatedItem } : item)),
    )

    addToast(`${fieldLabel} actualizado: ${formatVal(oldValue)} → ${formatVal(newValue)}`)

    // 2. Auto-apply indirects (non-blocking — runs in background)
    setAutoRecalculating(true)
    try {
      await budgetApi.applyIndirects(id)
      // 3. Refresh to show updated indirecto_total / neto_total
      const freshItems = await budgetApi.getItems(id)
      setAllItems(freshItems)
      setItems((prev) => {
        // Keep same items visible — just update values
        const freshById = new Map(freshItems.map((i) => [i.id, i]))
        return prev.map((item) => freshById.get(item.id) ?? item)
      })
    } catch {
      // Non-fatal — values will be correct on next manual recalc
    } finally {
      setAutoRecalculating(false)
    }
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
      addToast(`Seccion creada: ${sectionCodigo} - ${sectionNombre}`)
      setShowSectionForm(false)
      setSectionCodigo('')
      setSectionNombre('')
    } catch (err) {
      addToast(`Error al crear seccion: ${err instanceof Error ? err.message : 'desconocido'}`, 'error')
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
      addToast(`Seccion renombrada: ${newName}`)
    } catch (err) {
      addToast(`Error al editar seccion: ${err instanceof Error ? err.message : 'desconocido'}`, 'error')
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
      addToast(`Seccion eliminada: ${node.description}`)
    } catch (err) {
      addToast(`Error al eliminar seccion: ${err instanceof Error ? err.message : 'desconocido'}`, 'error')
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

  const mat = items.reduce((s, i) => s + i.mat_total, 0)
  const mo = items.reduce((s, i) => s + i.mo_total, 0)
  const directo = items.reduce((s, i) => s + i.directo_total, 0)
  const indirecto = items.reduce((s, i) => s + i.indirecto_total, 0)
  const neto = items.reduce((s, i) => s + i.neto_total, 0)

  const indirectoPct = indirectConfig
    ? Math.round(indirectConfig.estructura_pct + indirectConfig.jefatura_pct + indirectConfig.logistica_pct + indirectConfig.herramientas_pct)
    : null

  const markupLinks = indirectConfig ? [
    { label: 'Estructura', pct: Math.round(indirectConfig.estructura_pct) },
    { label: 'Jefatura', pct: Math.round(indirectConfig.jefatura_pct) },
    { label: 'Logística', pct: Math.round(indirectConfig.logistica_pct) },
    { label: 'Herramientas', pct: Math.round(indirectConfig.herramientas_pct) },
  ] : MARKUP_LINKS

  return (
    <div className="p-4 fade-in h-full flex flex-col">
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium animate-slide-in backdrop-blur-sm ${
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
            <span>{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="ml-1 opacity-50 hover:opacity-100 transition-opacity">
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

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs mb-1">
        <span
          className="text-gray-400 cursor-pointer hover:text-[#2D8D68] transition-colors"
          onClick={() => navigate('/app/dashboard')}
        >
          Presupuestos
        </span>
        <ChevronRight size={12} className="text-gray-300" />
        <span className="font-semibold text-gray-900">
          {budget?.name ?? 'Edificio Las Heras \u2014 Obra Gris'}
        </span>
        <span className="bg-[#E8F5EE] text-[#1B5E4B] text-[10px] font-medium px-1.5 py-0.5 rounded-full">v3</span>
      </div>

      {/* Section label */}
      <div className="flex items-center gap-2 text-[#2D8D68] text-[11px] font-bold tracking-wider mb-1">
        <Edit3 size={14} /> EDITOR DE OBRA
      </div>

      {/* Title bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-7 bg-gradient-to-b from-[#2D8D68] to-[#2D8D68]/40 rounded-full" />
          <h1 className="text-xl font-extrabold text-gray-900">
            {budget?.name?.toUpperCase() ?? 'PRESUPUESTO'}
          </h1>
          {/* Status badge / dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu((v) => !v)}
              disabled={statusChanging || !puedeEditar}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all hover:opacity-80 disabled:opacity-60 ${STATUS_OPTIONS.find((s) => s.value === (budget?.status ?? 'draft'))?.badgeCls ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}
            >
              {STATUS_OPTIONS.find((s) => s.value === (budget?.status ?? 'draft'))?.label ?? 'Borrador'}
              {puedeEditar && <span className="text-[10px] opacity-60">▾</span>}
            </button>
            {showStatusMenu && puedeEditar && (
              <>
              <div className="fixed inset-0 z-20" onClick={() => setShowStatusMenu(false)} />
              <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[140px]">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusChange(opt.value)}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 flex items-center gap-2 ${opt.value === (budget?.status ?? 'draft') ? 'opacity-50 cursor-default' : ''}`}
                  >
                    <span className={`px-2 py-0.5 rounded-full border text-xs ${opt.badgeCls}`}>{opt.label}</span>
                  </button>
                ))}
              </div>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {autoRecalculating && (
            <span className="flex items-center gap-1 text-[10px] text-[#2D8D68] font-medium px-2 py-1 bg-[#E8F5EE] rounded-full">
              <Loader2 size={10} className="animate-spin" />
              Recalculando...
            </span>
          )}
          {puedeEditar && (
            <button
              onClick={handleRecalculate}
              disabled={recalculating}
              className="bg-white border text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={recalculating ? 'animate-spin' : ''} />
              {recalculating ? 'Recalculando...' : 'Recálculo completo'}
            </button>
          )}
          <button
            onClick={() => navigate(`/app/budgets/${id ?? '1'}/ai`)}
            className="bg-white border border-gray-200 text-gray-700 px-3.5 py-1.5 rounded-xl text-xs font-medium hover:bg-gray-50 hover:shadow-sm transition-all duration-200"
          >
            IA + Plano
          </button>
          <button
            onClick={() => navigate(`/app/budgets/${id ?? '1'}/diferencias`)}
            className="bg-white border border-gray-200 text-gray-700 px-3.5 py-1.5 rounded-xl text-xs font-medium hover:bg-gray-50 hover:shadow-sm transition-all duration-200"
          >
            Diferencias con el Excel
          </button>
          <button
            onClick={() => navigate(`/app/budgets/${id ?? '1'}/export`)}
            className="bg-white border border-gray-200 text-gray-700 px-3.5 py-1.5 rounded-xl text-xs font-medium hover:bg-gray-50 hover:shadow-sm transition-all duration-200"
          >
            Exportar
          </button>
          {puedeEditar && (
            <button
              onClick={() => id && budgetApi.createVersion(id)}
              className="bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] hover:from-[#1B5E4B] hover:to-[#143D34] text-white font-semibold px-5 py-1.5 rounded-xl text-xs transition-all duration-200 shadow-sm hover:shadow-md"
            >
              Guardar version
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <div className="w-4 h-4 border-2 border-[#2D8D68] border-t-transparent rounded-full animate-spin" />
          Cargando...
        </div>
      )}

      {/* View Mode Selector - top level tabs */}
      <div className="mb-3">
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

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Tree Panel */}
        <div className="w-64 bg-white rounded-2xl shadow-sm border border-gray-100 flex-shrink-0 overflow-hidden flex flex-col">
          {/* Gradient header */}
          <div className="bg-gradient-to-r from-[#143D34] to-[#2D8D68] text-white px-4 py-3 flex justify-between items-center">
            <span className="font-semibold text-xs tracking-wide">Estructura de Obra</span>
            {puedeEditar && (
              <button
                onClick={openSectionForm}
                className="text-[#E0A33A] text-xs font-medium flex items-center gap-0.5 hover:text-yellow-200 transition-colors"
              >
                <Plus size={12} /> Seccion
              </button>
            )}
          </div>

          {/* Inline section creation form */}
          {showSectionForm && (
            <div className="px-2.5 py-2.5 border-b bg-gradient-to-b from-[#F8FBF9] to-white">
              <div className="flex gap-1.5 mb-1.5">
                <input
                  ref={sectionCodigoRef}
                  type="text"
                  placeholder="Cod"
                  value={sectionCodigo}
                  onChange={(e) => setSectionCodigo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSection()
                    if (e.key === 'Escape') setShowSectionForm(false)
                  }}
                  className="w-12 px-1.5 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
                />
                <input
                  type="text"
                  placeholder="Nombre de seccion"
                  value={sectionNombre}
                  onChange={(e) => setSectionNombre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSection()
                    if (e.key === 'Escape') setShowSectionForm(false)
                  }}
                  className="flex-1 px-1.5 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:border-[#2D8D68] focus:ring-2 focus:ring-[#2D8D68]/20"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleCreateSection}
                  disabled={sectionSaving || !sectionCodigo.trim() || !sectionNombre.trim()}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gradient-to-r from-[#2D8D68] to-[#1B5E4B] hover:from-[#1B5E4B] hover:to-[#143D34] disabled:from-gray-300 disabled:to-gray-300 text-white text-[11px] font-medium rounded-lg transition-all duration-200"
                >
                  {sectionSaving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Crear
                </button>
                <button
                  onClick={() => setShowSectionForm(false)}
                  className="px-2 py-1 bg-white border border-gray-200 text-gray-500 text-[11px] font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="px-2 pt-2.5 pb-2 flex-1 overflow-y-auto">
            <TreeView
              nodes={displayTree}
              selectedId={selectedNode?.id}
              onSelect={(node) => {
                setSelectedNode(node)
                setItems(getItemsForNode(node, allItems))
                setRubroElegido(rubroDe(node))
              }}
              onEditSection={puedeEditar ? handleEditSection : undefined}
              onDeleteSection={puedeEditar ? handleDeleteSection : undefined}
            />
          </div>
        </div>

        {/* Main Content Panel */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          {/* Section header */}
          <div className="bg-gradient-to-r from-gray-50 to-white border-b px-5 py-3 flex justify-between items-center">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">{selectedLabel}</h2>
              <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2D8D68] inline-block" />
                  {items.length} items
                </span>
                <span className="text-gray-300">|</span>
                <span>{fmtCurrency(directo)} costo directo</span>
              </p>
            </div>
          </div>

          <CostSummaryBar mat={mat} mo={mo} directo={directo} indirecto={indirecto} neto={neto} indirectoPct={indirectoPct ?? undefined} />
          <MarkupChainDisplay directo={directo} neto={neto} links={markupLinks} budgetId={id} />

          {puedeEditar && id && (
            <AgregarTrabajo
              budgetId={id}
              rubroElegido={rubroElegido ? {
                id: rubroElegido.id,
                nombre: `${rubroElegido.code ? rubroElegido.code + ' ' : ''}${rubroElegido.description ?? ''}`.trim(),
              } : null}
              onSoltarRubro={() => setRubroElegido(null)}
              onAgregado={handleTrabajoAgregado}
              onVerTrabajo={(itemId) => navigate(`/app/budgets/${id}/item/${itemId}`)}
              pie={
                <div className="mt-2">
                  <button
                    onClick={() => setShowAddForm((v) => !v)}
                    aria-expanded={showAddForm}
                    className="text-[11px] text-[#2D8D68] font-medium hover:underline flex items-center gap-1"
                  >
                    <ChevronRight size={12} className={`transition-transform ${showAddForm ? 'rotate-90' : ''}`} />
                    Agregar un trabajo sin fórmula (precio a mano)
                  </button>
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
              }
            />
          )}

          <div className="flex-1 overflow-y-auto">
          {items.length === 0 && !loading && puedeEditar && !allItems.some((i) => i.notas !== 'Seccion') ? (
            <div className="py-12 px-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
                <LayoutGrid size={28} className="text-gray-300" />
              </div>
              <h3 className="text-sm font-semibold text-gray-500 mb-1">
                Este presupuesto todavía no tiene trabajos
              </h3>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                Escribí el primero arriba, en «Agregá un trabajo»: por ejemplo «hueco 18» y la cantidad.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 px-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mb-4">
                <LayoutGrid size={28} className="text-gray-300" />
              </div>
              <h3 className="text-sm font-semibold text-gray-500 mb-1">
                Selecciona una seccion del arbol
              </h3>
              <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">
                Hace click en cualquier seccion del panel izquierdo para ver y editar sus items de presupuesto.
              </p>
              <div className="flex items-center justify-center gap-4 text-[10px] text-gray-400">
                <span className="flex items-center gap-1">
                  <MousePointerClick size={12} />
                  Click para seleccionar
                </span>
                <span className="flex items-center gap-1">
                  <Command size={12} />
                  Editar celdas inline
                </span>
              </div>
            </div>
          ) : (
            <DataTable
              items={items}
              semaforo={(item) => (item.notas === 'Seccion' ? null : estadoEnTabla(item, faltantes))}
              onEditItem={puedeEditar ? handleEditItem : undefined}
              onViewDetail={(itemId) => navigate(`/app/budgets/${id}/item/${itemId}`)}
              onDeleteItem={!puedeEditar ? undefined : async (itemId, desc) => {
                if (!id) return
                try {
                  await budgetApi.deleteItem(id, itemId)
                  const refreshedItems = await budgetApi.getItems(id)
                  setAllItems(refreshedItems)
                  if (selectedNode) setItems(getItemsForNode(selectedNode, refreshedItems))
                  cargarFaltantes(refreshedItems)
                  addToast(`Item eliminado: ${desc}`)
                } catch (err) {
                  addToast(`Error al eliminar: ${err instanceof Error ? err.message : 'desconocido'}`, 'error')
                }
              }}
            />
          )}

          </div>
          <div className="px-5 py-2.5 bg-gradient-to-r from-[#E8F5EE] to-[#E8F5EE]/50 text-[10px] text-[#1B5E4B] border-t flex items-center gap-1.5 flex-shrink-0">
            <span className="w-1 h-1 rounded-full bg-[#2D8D68] inline-block" />
            Click en celdas punteadas para editar. Totales se recalculan automaticamente por el coeficiente de pase.
          </div>
        </div>
      </div>
    </div>
  )
}
