// The three ways to start a budget (PLAN_PALABRAS.md, 1.C). The same words in the "NUEVO" menu and in the
// empty dashboard, so each name always leads to the same screen.
import { ClipboardCheck, FilePlus2, Upload, type LucideIcon } from 'lucide-react'

export interface FormaDeEmpezar {
  clave: 'cargar-obra' | 'nuevo' | 'importar'
  titulo: string
  linea: string
  ruta: string
  Icono: LucideIcon
}

export const FORMAS_DE_EMPEZAR: FormaDeEmpezar[] = [
  {
    clave: 'cargar-obra',
    titulo: 'Cargar obra',
    linea: 'Subís el cómputo y la app le pone fórmulas y precios',
    ruta: '/app/cargar-obra',
    Icono: ClipboardCheck,
  },
  {
    clave: 'nuevo',
    titulo: 'Nuevo presupuesto',
    linea: 'Armás los trabajos uno por uno',
    ruta: '/app/new-project',
    Icono: FilePlus2,
  },
  {
    clave: 'importar',
    titulo: 'Importar Excel',
    linea: 'Copiás un presupuesto ya hecho, con sus precios',
    ruta: '/app/import',
    Icono: Upload,
  },
]
