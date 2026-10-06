# Plan: las mismas palabras en toda la app, con tildes (entrega 7)

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambian textos que manda el servidor).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL), fricciones
> B-18 a B-25: "la app parece hecha por tres personas distintas". Lo que ya arreglaron los PR #37 a #43 no se repite
> (Coeficiente de pase, Exportar, "Guardar versión" con aviso, la escalera de totales, la palabra "fórmula").

## 1. Qué cambia, para Sol

### A. Las mismas palabras en todos lados

| Hoy | Después |
|---|---|
| "items", "ítems", "partidas" | **trabajos** |
| "Sección", "secciones", "+ Seccion", "Total seccion" | **rubro**, "+ Rubro", "Total del rubro" (un rubro adentro de otro, como en Ginkgo: **piso**) |
| "Neto", "Neto Total" donde es el precio | **Precio sin IVA** (como ya dice la escalera) |
| "MAT Unit.", "MO Unit.", "EQ Unit", "Mat.Ind Unit", "Sub Unit", "Qty efectiva", "Jornales Efect.", "Cargas %" | "Materiales por unidad", "Mano de obra por unidad", "Equipos por unidad", "Materiales indirectos por unidad", "Subcontratos por unidad", "Cantidad con desperdicio", "Jornales", "Cargas sociales" |
| "Mano de Obra - Equipos" (los equipos no son mano de obra) | "Equipos" |
| "Dashboard", "Volver al Dashboard", "Click", "inline", "CSV", "JSON", "IA" sueltos, "BoQ" | "Mis presupuestos", "Volver a Mis presupuestos", "Tocá", sin "inline"; "Subir un archivo (.csv)", "Importar un archivo (.json)", "con inteligencia artificial" la primera vez que aparece en cada pantalla |
| Nombres de parámetro con guion bajo a la vista ("altura_m") | "Altura (m)" (se muestra la descripción del parámetro o la clave legible; la clave interna no cambia) |

### B. Tildes y signos en todos los textos visibles

Todos los textos de la pantalla y los mensajes que manda el servidor, con tildes, eñes y signos de apertura ("¿", "¡").
Ejemplos que hoy están mal: "Analisis", "CONFIGURACION", "Memoria de Calculo", "Codigo", "Descripcion", "Informacion
basica", "Duracion", "Logistica", "Podes", "Subi", "Revisa", "Selecciona una seccion del arbol", "Edicion manual",
"Importacion Excel", "Guardar version", "esta listo", "REVISION", "automaticamente", "formato valido", las tareas
genéricas del asistente ("Albanileria", "Mamposteria", "hormigon", "nivelacion", "preparacion"). Voseo rioplatense en
todos lados ("Subí", "Elegí", "Tocá"), sin mezclar con "Sube"/"Seleccione".

Las categorías de las fórmulas vienen del Maestro ("Yeseria y durleria", "Albañileria"): **no se tocan los datos**;
la pantalla las muestra con tildes con una tabla de reemplazos de palabras conocidas (yesería, durlería, albañilería,
herrería, carpintería, zinguería, pinturería…) y la búsqueda sigue funcionando sin tildes. En "Fórmulas", al editar,
la categoría se guarda como la escriba Sol.

### C. Lo que confunde en el camino a mano

| Hoy | Después |
|---|---|
| El botón verde **"NUEVO"** de arriba lleva a "Importar Excel"; "Nuevo presupuesto" del tablero lleva al asistente. La misma palabra lleva a dos lugares. | "NUEVO" abre un menú chico con las tres formas de empezar, cada una con una línea: **Cargar obra** ("Subís el cómputo y la app le pone fórmulas y precios"), **Nuevo presupuesto** ("Armás los trabajos uno por uno"), **Importar Excel** ("Copiás un presupuesto ya hecho, con sus precios"). El tablero vacío muestra esas tres puertas como tarjetas. |
| En el menú dice "+ + Nuevo Presupuesto" (el ícono + y el texto con +). | "Nuevo presupuesto", con el ícono. |
| "Diferencias con el Excel" aparece en un presupuesto hecho a mano y termina en "Este presupuesto no tiene guardados los totales del Excel". | Solo aparece si el presupuesto vino de un Excel con totales. |
| El encabezado del editor dice "v3" fijo, y mientras carga muestra "Edificio Las Heras — Obra Gris". | Muestra la versión real ("Sin versiones" si no hay) y, mientras carga, un renglón gris sin nombre inventado. |
| El asistente "Nuevo presupuesto" muestra los pasos como círculos; Cargar obra, como pastillas "1 Subir · 2 Revisar · 3 Cargar". El botón final dice "Abrir en Editor". | Pastillas como Cargar obra ("1 Datos · 2 Trabajos · 3 Indirectos · 4 Listo"). Botón final: "Abrir el presupuesto". |
| Si Sol cierra el asistente a mitad de camino, pierde todo. | Se guarda un borrador como en Cargar obra (`lib/borrador.ts`, por usuario y empresa): al volver, "Tenés un presupuesto a medias: Seguir / Descartar". |

## 2. Servidor

- Solo **textos**: los mensajes de `HTTPException` y los textos que la pantalla muestra (`detail`, `mensaje`, títulos
  de PDF/Excel) en `app/`, con tildes, eñes y voseo; "ítem/ítems" → "trabajo/trabajos" y "sección" → "rubro" cuando
  es lo que ve Sol. **No cambian** claves, códigos (`FALTA_CONVERSION`, `A_MEDIAS`…), nombres de columna de la planilla
  simple, rutas ni datos guardados.
- Los tests que comparan textos se actualizan al texto nuevo (listarlos en el informe). `python3 -m pytest -q` todo
  verde (hoy 756 passed, 14 skipped); `ruff check` sin errores nuevos.

## 3. Pantalla (`frontend/src/`)

- Barrido de todos los textos visibles (JSX, `title`, `placeholder`, `aria-label`, mensajes de error, confirmaciones)
  de `pages/`, `components/` y `lib/` con la tabla de 1.A y las tildes de 1.B. No cambian nombres de archivos,
  variables, rutas ni claves de datos.
- `lib/textos.ts` (nuevo): `conTildes(categoria)` para mostrar categorías del Maestro (1.B) y, si hace falta, las
  palabras de la tabla 1.A en un solo lugar.
- 1.C: menú de "NUEVO" (`components/layout/TopBar.tsx`), tablero vacío con tres tarjetas (`pages/Dashboard.tsx`),
  menú sin "+ +" (`Sidebar.tsx`), "Diferencias con el Excel" condicionado (`Editor.tsx`: usar el dato que ya usa
  `DiferenciasExcel.tsx` para decir que no hay totales del Excel), versión real y carga sin nombre inventado,
  pastillas y borrador en `pages/NewProject.tsx` (reusar `lib/borrador.ts` sin cambiar cómo lo usa Cargar obra).
- **Control automático** `scripts/check_textos.cjs` (nuevo, sin dependencias): recorre `frontend/src/**/*.tsx` y
  `app/**/*.py`, toma los textos visibles (JSX text, strings en `title=`/`placeholder=`/`aria-label=`, y los strings
  de `HTTPException(...)`) y falla si encuentra palabras de una lista negra sin tilde (analisis, codigo, descripcion,
  seccion, configuracion, calculo, revision, version, informacion, duracion, logistica, automaticamente, valido,
  podes, subi, revisa, selecciona, albanileria, mamposteria, hormigon…) o jerga de 1.A (Dashboard, Click, inline,
  BoQ, Qty, "MAT Unit", "MO Unit", items/ítems visibles). Que corra en < 2 s y diga archivo:línea. Debe dar 0 al final.
- e2e: ajustar los textos que buscan los e2e existentes (`scripts/e2e_*.cjs`) a las palabras nuevas, sin bajar
  ninguna verificación. Nuevo `scripts/e2e_palabras.cjs`: menú "NUEVO" con las tres formas y que cada una lleve a su
  pantalla; tablero vacío con tres tarjetas; presupuesto hecho a mano sin "Diferencias con el Excel" y Ginkgo con;
  asistente con pastillas, cerrar a mitad y volver → "Tenés un presupuesto a medias" con lo cargado; categoría
  "Yeseria y durleria" se ve "Yesería y durlería" y la búsqueda "yeseria" la encuentra.
- `npm run build` pasa; tsc con sus 7 errores viejos, ninguno nuevo. Todos los e2e de siempre con sus OK.

## 4. Fuera de este PR
Celular (8), "+ Nuevo Presupuesto" directo al editor y la guía de Ayuda del camino a mano, "Duplicar presupuesto",
renombrar las categorías en los datos del Maestro.
