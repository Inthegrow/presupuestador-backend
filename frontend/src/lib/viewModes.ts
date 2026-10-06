import type { TreeNode, BudgetItem } from '../types'

export type ViewMode = 'rubro' | 'piso' | 'material' | 'tipo'

// ─── Helpers ────────────────────────────────────────────────────────────────

let virtualId = 0
function makeVirtualNode(description: string, children: TreeNode[]): TreeNode {
  virtualId++
  const mat_total = children.reduce((s, c) => s + c.mat_total, 0)
  const mo_total = children.reduce((s, c) => s + c.mo_total, 0)
  const directo_total = children.reduce((s, c) => s + c.directo_total, 0)
  const indirecto_total = children.reduce((s, c) => s + c.indirecto_total, 0)
  const beneficio_total = children.reduce((s, c) => s + c.beneficio_total, 0)
  const neto_total = children.reduce((s, c) => s + c.neto_total, 0)
  return {
    id: `__virtual_${virtualId}`,
    budget_id: children[0]?.budget_id ?? '',
    org_id: children[0]?.org_id ?? '',
    description,
    mat_unitario: 0,
    mo_unitario: 0,
    mat_total,
    mo_total,
    directo_total,
    indirecto_total,
    beneficio_total,
    neto_total,
    sort_order: 0,
    children,
  }
}

function itemToLeaf(item: BudgetItem): TreeNode {
  return { ...item, children: [] }
}

function classifyItems(
  items: BudgetItem[],
  rules: { label: string; keywords: RegExp }[],
): TreeNode[] {
  const buckets = new Map<string, BudgetItem[]>()
  for (const rule of rules) buckets.set(rule.label, [])
  buckets.set('Otros', [])

  for (const item of items) {
    const desc = (item.description ?? '').toLowerCase()
    const code = (item.code ?? '').toLowerCase()
    const text = `${desc} ${code}`
    let matched = false
    for (const rule of rules) {
      if (rule.keywords.test(text)) {
        buckets.get(rule.label)!.push(item)
        matched = true
        break
      }
    }
    if (!matched) buckets.get('Otros')!.push(item)
  }

  const nodes: TreeNode[] = []
  for (const rule of rules) {
    const group = buckets.get(rule.label)!
    if (group.length > 0) {
      nodes.push(makeVirtualNode(rule.label, group.map(itemToLeaf)))
    }
  }
  const otros = buckets.get('Otros')!
  if (otros.length > 0) {
    nodes.push(makeVirtualNode('Otros', otros.map(itemToLeaf)))
  }
  return nodes
}

/** A rubro or piso row (same markers the server uses: "Seccion", "Sección generada por IA"). */
function isSection(item: BudgetItem): boolean {
  const notas = (item.notas ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  return notas === 'seccion' || notas === 'seccion generada por ia'
}

// Only works (trabajos): never the rubro / piso rows
function getLeafItems(items: BudgetItem[]): BudgetItem[] {
  return items.filter((i) => !isSection(i))
}

// ─── Group by Rubro (default — returns existing tree as-is) ─────────────────

export function groupByRubro(tree: TreeNode[]): TreeNode[] {
  return tree
}

// ─── Group by Floor / Piso ──────────────────────────────────────────────────

const FLOOR_RULES: { label: string; keywords: RegExp }[] = [
  { label: 'Fundaciones / Subsuelo', keywords: /fundaci|sub\s*suelo|s[oó]tano|nivel\s*-/i },
  { label: 'Planta Baja', keywords: /planta\s*baja|\bp\.?\s?b\b|nivel\s*0\b/i },
  { label: 'Piso 1', keywords: /\bpiso\s*1\b|\b1[°º]?\s*piso|primer[o]?\s*piso|nivel\s*1\b/i },
  { label: 'Piso 2', keywords: /\bpiso\s*2\b|\b2[°º]?\s*piso|segundo\s*piso|nivel\s*2\b/i },
  { label: 'Piso 3', keywords: /\bpiso\s*3\b|\b3[°º]?\s*piso|tercer[o]?\s*piso|nivel\s*3\b/i },
  { label: 'Piso 4', keywords: /\bpiso\s*4\b|\b4[°º]?\s*piso|cuarto\s*piso|nivel\s*4\b/i },
  { label: 'Piso 5', keywords: /\bpiso\s*5\b|\b5[°º]?\s*piso|quinto\s*piso|nivel\s*5\b/i },
  { label: 'Piso 6', keywords: /\bpiso\s*6\b|\b6[°º]?\s*piso|sexto\s*piso|nivel\s*6\b/i },
  { label: 'Piso 7', keywords: /\bpiso\s*7\b|\b7[°º]?\s*piso|s[eé]ptimo\s*piso|nivel\s*7\b/i },
  { label: 'Piso 8', keywords: /\bpiso\s*8\b|\b8[°º]?\s*piso|octavo\s*piso|nivel\s*8\b/i },
  { label: 'Azotea / Terraza', keywords: /azotea|terraza|cubierta|techo|tanque|sala\s*de\s*m[aá]quinas/i },
]

const SIN_PISO = 'Toda la obra (sin piso)'

/**
 * Each work goes to the piso of its nearest rubro/piso row that names one ("4.2- PRIMER PISO",
 * "3.3- SOBRE PRIMER PISO"), as Sol's Excel is organized; only if none does, to what its own
 * name says; and if nothing names a piso, to "Toda la obra (sin piso)".
 */
export function groupByFloor(items: BudgetItem[]): TreeNode[] {
  virtualId = 0
  const byId = new Map(items.map((i) => [String(i.id), i]))
  const floorOf = (text: string): string | null => {
    for (const rule of FLOOR_RULES) if (rule.keywords.test(text)) return rule.label
    return null
  }
  const buckets = new Map<string, BudgetItem[]>()
  for (const item of getLeafItems(items)) {
    let label: string | null = null
    const seen = new Set<string>()
    let parent = item.parent_id ? byId.get(String(item.parent_id)) : undefined
    while (parent && !label && !seen.has(String(parent.id))) {
      seen.add(String(parent.id))
      label = floorOf(parent.description ?? '')
      parent = parent.parent_id ? byId.get(String(parent.parent_id)) : undefined
    }
    label = label ?? floorOf(item.description ?? '') ?? SIN_PISO
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(item)
  }
  const order = [...FLOOR_RULES.map((r) => r.label), SIN_PISO]
  return order
    .filter((label) => (buckets.get(label)?.length ?? 0) > 0)
    .map((label) => makeVirtualNode(label, buckets.get(label)!.map(itemToLeaf)))
}

// ─── Group by Material ──────────────────────────────────────────────────────

const MATERIAL_RULES: { label: string; keywords: RegExp }[] = [
  { label: 'Hormigón / Concreto', keywords: /hormig[oó]n|concreto|h[.-]?\s*\d+|h21|h25|h30|losa|viga|columna|encofrado|molde/i },
  { label: 'Acero / Hierro', keywords: /acero|hierro|armadura|estribo|barra|fe\b|adn\s*\d|malla.*electro/i },
  { label: 'Ladrillo / Mampostería', keywords: /ladrillo|mampost|bloque|muro|tabique|pared|cerámico.*hueco|revoque|jaharro|grueso.*fino/i },
  { label: 'Cerámica / Revestimiento', keywords: /cer[aá]mic|porcelanato|azulejo|revestim|piso.*cer|baldosa|guardas/i },
  { label: 'Pintura', keywords: /pintura|latex|l[aá]tex|esmalte|impermeab|membrana|hidro/i },
  { label: 'Madera', keywords: /madera|carpinter|puerta|marco|placard|mueble|melamina|fenol/i },
  { label: 'Aluminio / Vidrio', keywords: /aluminio|vidrio|ventana|abertura|dvh|cristal|cancel/i },
  { label: 'Instalación Eléctrica', keywords: /el[eé]ctric|cable|tablero|llave.*t[eé]rmic|toma|interruptor|iluminaci|luminaria|boca.*luz/i },
  { label: 'Instalación Sanitaria', keywords: /sanitar|ca[ñn]o|plomer|grifo|inodoro|lavatorio|ducha|desag[üu]e|cloacal|agua.*fr[ií]a|agua.*caliente|termotanque/i },
  { label: 'Instalación de Gas', keywords: /gas\b|calefon|caldera|calefacc/i },
]

export function groupByMaterial(items: BudgetItem[]): TreeNode[] {
  virtualId = 0
  const leaves = getLeafItems(items)
  return classifyItems(leaves, MATERIAL_RULES)
}

// ─── Group by Work Type / Proveedor ─────────────────────────────────────────

const WORK_TYPE_RULES: { label: string; keywords: RegExp }[] = [
  { label: 'Tareas Preliminares', keywords: /prelim|demolici|limpieza.*terreno|obrador|cerco.*obra|replanteo/i },
  { label: 'Movimiento de Suelo', keywords: /movimiento.*suelo|excavaci|relleno|compactaci|terraplen|zanja/i },
  { label: 'Estructura', keywords: /estructura|hormig[oó]n|encofrado|armadura|fundaci|zapata|platea|viga|columna|losa|estribo/i },
  { label: 'Albañilería', keywords: /alba[ñn]il|mampost|ladrillo|revoque|jaharro|contrapiso|carpeta|muro|tabique|dintel/i },
  { label: 'Instalación Eléctrica', keywords: /el[eé]ctric|cable|tablero|llave.*t[eé]rmic|toma|interruptor|iluminaci|boca.*luz/i },
  { label: 'Instalación Sanitaria', keywords: /sanitar|plomer|ca[ñn]er|desag[üu]e|cloacal|agua.*fr[ií]a|agua.*caliente|inodoro|lavatorio/i },
  { label: 'Instalación de Gas', keywords: /gas\b|calefon|caldera|calefacc/i },
  { label: 'Pisos y Revestimientos', keywords: /piso|revestim|cer[aá]mic|porcelanato|baldosa|z[oó]calo|solado/i },
  { label: 'Pintura', keywords: /pintura|latex|l[aá]tex|esmalte|enduido|fijador/i },
  { label: 'Carpintería', keywords: /carpinter|puerta|ventana|abertura|placard|marco|aluminio|dvh|cancel/i },
  { label: 'Impermeabilización', keywords: /impermeab|membrana|hidro|aislaci|barrera.*vapor/i },
  { label: 'Ascensores', keywords: /ascensor|elevador/i },
]

export function groupByWorkType(items: BudgetItem[]): TreeNode[] {
  virtualId = 0
  const leaves = getLeafItems(items)
  return classifyItems(leaves, WORK_TYPE_RULES)
}

// ─── Main dispatcher ────────────────────────────────────────────────────────

export function regroupItems(
  mode: ViewMode,
  originalTree: TreeNode[],
  allItems: BudgetItem[],
): TreeNode[] {
  switch (mode) {
    case 'rubro':
      return groupByRubro(originalTree)
    case 'piso':
      return groupByFloor(allItems)
    case 'material':
      return groupByMaterial(allItems)
    case 'tipo':
      return groupByWorkType(allItems)
    default:
      return originalTree
  }
}
