// ─── Generic Construction Tasks Template ────────────────────────────────────
// Tareas típicas de obra residencial/comercial en Argentina.
// Cada item tiene unidad estándar y cantidad sugerida (null = definir en obra).

export interface GenericTaskItem {
  descripcion: string
  unidad: 'm2' | 'm3' | 'ml' | 'gl' | 'kg' | 'un' | 'mes'
  cantidad_sugerida: number | null
}

export interface GenericTaskCategory {
  code: string
  nombre: string
  items: GenericTaskItem[]
}

export const GENERIC_TASK_TEMPLATE: GenericTaskCategory[] = [
  {
    code: '0',
    nombre: 'Tareas Preliminares',
    items: [
      { descripcion: 'Obrador e instalaciones provisorias', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Limpieza y preparación del terreno', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Cerco perimetral de obra', unidad: 'ml', cantidad_sugerida: null },
      { descripcion: 'Movimiento de suelos (excavación, relleno, compactación)', unidad: 'm3', cantidad_sugerida: null },
      { descripcion: 'Seguridad e higiene', unidad: 'mes', cantidad_sugerida: null },
      { descripcion: 'Limpieza periódica de obra', unidad: 'mes', cantidad_sugerida: null },
      { descripcion: 'Proyecto y dirección técnica', unidad: 'gl', cantidad_sugerida: 1 },
    ],
  },
  {
    code: '1',
    nombre: 'Estructura',
    items: [
      { descripcion: 'Fundaciones (bases, zapatas, plateas)', unidad: 'm3', cantidad_sugerida: null },
      { descripcion: 'Columnas de hormigón armado', unidad: 'm3', cantidad_sugerida: null },
      { descripcion: 'Vigas de hormigón armado', unidad: 'm3', cantidad_sugerida: null },
      { descripcion: 'Losas (macizas, viguetas, steel deck)', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Escaleras de hormigón', unidad: 'un', cantidad_sugerida: null },
      { descripcion: 'Tanque de agua', unidad: 'un', cantidad_sugerida: 1 },
    ],
  },
  {
    code: '2',
    nombre: 'Albañilería',
    items: [
      { descripcion: 'Mampostería de ladrillos (exterior)', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Mampostería de ladrillos (interior/divisorias)', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Revoques gruesos', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Revoques finos', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Contrapiso', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Carpeta de nivelación', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Aislaciones hidráulicas', unidad: 'm2', cantidad_sugerida: null },
    ],
  },
  {
    code: '3',
    nombre: 'Instalaciones',
    items: [
      { descripcion: 'Instalación sanitaria (agua fría y caliente)', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Instalación cloacal y pluvial', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Instalación eléctrica', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Instalación de gas', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Instalación de aire acondicionado (provisión de cañerías)', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Instalación contra incendio', unidad: 'gl', cantidad_sugerida: 1 },
    ],
  },
  {
    code: '4',
    nombre: 'Terminaciones',
    items: [
      { descripcion: 'Pisos (cerámicos, porcelanatos)', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Revestimientos de paredes', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Pintura interior', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Pintura exterior', unidad: 'm2', cantidad_sugerida: null },
      { descripcion: 'Carpintería de aluminio (ventanas)', unidad: 'un', cantidad_sugerida: null },
      { descripcion: 'Carpintería de madera (puertas)', unidad: 'un', cantidad_sugerida: null },
      { descripcion: 'Mesadas', unidad: 'ml', cantidad_sugerida: null },
      { descripcion: 'Muebles de cocina y baños', unidad: 'gl', cantidad_sugerida: 1 },
      { descripcion: 'Vidrios', unidad: 'm2', cantidad_sugerida: null },
    ],
  },
  {
    code: '5',
    nombre: 'Instalaciones Especiales',
    items: [
      { descripcion: 'Ascensor', unidad: 'un', cantidad_sugerida: null },
      { descripcion: 'Grupo electrógeno', unidad: 'un', cantidad_sugerida: null },
      { descripcion: 'Bombas', unidad: 'un', cantidad_sugerida: null },
      { descripcion: 'Portero eléctrico / videoportero', unidad: 'un', cantidad_sugerida: 1 },
      { descripcion: 'Sistema de seguridad (CCTV)', unidad: 'gl', cantidad_sugerida: 1 },
    ],
  },
]
