# Plan: una sola puerta de entrada (limpieza de las tres generaciones)

> Fecha: 2026-10-05. Contrato para un solo PR, **solo pantalla** (`frontend/`), sin Manual Deploy. Origen: Carlos
> entró con su clave el 05/10 e hizo de Sol: "la app está hecha un Frankenstein". Tiene razón: hay tres
> generaciones apiladas (el asistente "Nuevo Presupuesto", "Importar Excel" y "Cargar obra"), tres nombres para
> las recetas (templates, plantillas, recetas), "Catálogos" sin explicar, y tres botones que no hacen nada.

## 1. Qué cambia, para Sol

| # | Hoy | Después |
|---|---|---|
| 16 | Tres formas de empezar: "+ Nuevo Presupuesto" (asistente manual viejo), "Cargar obra (con recetas)", "Importar Excel" (fotocopia del Excel). | Una sola: **Cargar obra**. Las otras dos salen del menú y del tablero. Las rutas siguen existiendo (`/app/new-project`, `/app/import`) por si hacen falta, pero no se ofrecen en ningún lado. |
| 17 | Luna, "VER 360" y campanita en la barra de arriba: no hacen nada. | Se borran. |
| 18 | El botón verde **NUEVO** de la barra lleva a "Importar Excel". El botón "Nuevo presupuesto" del tablero lleva al asistente viejo. | Los dos llevan a **Cargar obra** y dicen "Cargar obra". |
| 19 | "Templates" en el menú, "Nueva plantilla" en el botón, "Biblioteca de Templates" en el detalle del ítem, "recetas" en Cargar obra. | **Recetas** en todos lados. Botón: **Nueva receta**. Título de la pantalla: RECETAS. En el detalle del ítem: "Recetas". Los textos de ayuda, confirmaciones y vacíos de esa pantalla también. |
| 20 | "Catálogos" / "CATÁLOGOS DE PRECIOS" / "GESTIÓN DE PRECIOS", con un cuadro para subir CSV arriba de todo. | **Lista de precios** en el menú y en el título. Arriba, una frase: "Cada lista tiene el precio y la fecha de cada material. La app calcula con la lista **oficial**; las demás son solo para consultar." Los cuadros de subir CSV / Excel quedan plegados detrás de un enlace chico "Subir una lista nueva" (hoy el botón ya pliega; que arranque plegado y se vea secundario). |
| 21 | Ninguna pantalla dice para qué sirve. | Debajo del título de cada pantalla principal, una frase gris de una línea: **Mis presupuestos**: "Las obras cargadas. Entrá a una para ver el detalle o compararla con el Excel." **Cargar obra**: "Subí el cómputo de la obra (hoja 01_C&P): la app le pone las recetas y los precios." **Recetas**: "Qué materiales y cuánta mano de obra lleva una unidad de cada trabajo. Salen del Maestro y se pueden corregir acá." **Lista de precios**: la frase del punto 20. **Cadena de Markups**: "Los porcentajes que se suman al costo directo para llegar al precio final." |
| 22 | Menú "Cargar obra (con recetas)". | "Cargar obra". |
| 23 | El tablero dice "Mis presupuestos · 6 obras", "ÍTEMS TOTALES", "NETO TOTAL CARTERA", "PENDIENTE REVISIÓN" (siempre 0). | Se saca la tarjeta "Pendiente revisión". Las otras tres quedan: "Obras", "Trabajos cargados", "Total de la cartera". |

## 2. Pantalla (`frontend/src/`)

- `components/layout/TopBar.tsx`: borrar los botones Moon, "VER 360" y Bell (y sus imports). El botón NUEVO:
  `navigate('/app/cargar-obra')`, texto "CARGAR OBRA".
- `components/layout/Sidebar.tsx`: sección PRESUPUESTADOR PRO con "Mis Presupuestos" y "Cargar obra" (solo
  `puedeEditar` para la segunda, como hoy). Sección CONFIGURACION: "Cadena de Markups", "Lista de precios"
  (`/app/catalogs`), "Recetas" (`/app/templates`). Las rutas no cambian.
- `pages/Dashboard.tsx`: los botones que van a `/app/new-project` pasan a `/app/cargar-obra` con texto "Cargar
  obra". Tarjeta "Pendiente revisión" fuera. Frase del punto 21 debajo del título.
- `pages/Templates.tsx`: título RECETAS, botón "Nueva receta", "Eliminar receta", textos de ayuda, vacíos y
  confirmaciones con "receta". Frase del punto 21.
- `pages/ItemDetail.tsx`: "Biblioteca de Templates" → "Recetas".
- `pages/Catalogs.tsx`: "GESTIÓN DE PRECIOS" → "PRECIOS", título "LISTA DE PRECIOS", contador "N listas". Frase
  del punto 20. Los paneles de subida arrancan plegados detrás de "Subir una lista nueva" (estilo enlace).
- `pages/CargarObra.tsx`, `pages/MarkupChain.tsx`: la frase de una línea del punto 21 debajo del título (si ya
  hay un subtítulo, se reemplaza).
- `App.tsx`: sin cambios (las rutas viejas siguen).
- No tocar `app/` ni tests de Python. Sin dependencias nuevas. `cd frontend && npm run build` pasa; tsc sigue con
  sus 13 errores viejos, ninguno nuevo.
- `scripts/e2e_ginkgo.cjs`: ajustar los textos que cambian (menú "Cargar obra", "Lista de precios") y sumar una
  verificación de que la barra no tiene "VER 360" y de que el menú no tiene "Importar Excel" ni "Nuevo
  Presupuesto".

## 3. Fuera de este PR
- Borrar de verdad el asistente viejo y la importación-fotocopia (código y rutas): cuando Sol haya cargado dos
  obras reales sin pedirlos.
- Excel sin precios (4c): el PR siguiente.
