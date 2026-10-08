# Plan: la app en el celular y en una notebook chica (entrega 9)

> Fecha: 2026-10-08. Contrato para un solo PR, **solo pantalla** (`frontend/`, `scripts/`). **Render: Manual Deploy
> NO** (Vercel publica solo). Origen: auditoría "armar un presupuesto a mano", entrega 8 de esa lista (celular), y la
> medición del 08/10 de las 15 pantallas en 390×844 (celular), 1280×720 y 1366×768 (notebook de 13–14").

## 0. Lo que se midió (08/10)

- **Celular (390 px):** el menú lateral ocupa siempre 224 px y el contenido queda en **166 px**. Los títulos, los
  botones del editor, la escalera de totales y las tablas se cortan o se apilan de a una palabra. La barra de arriba
  no entra (logo, IA, NUEVO, usuario). Editor, detalle de un trabajo, Diferencias con el Excel, Análisis, Versiones y
  Coeficiente de pase tienen cosas que se salen de la pantalla.
- **Notebook 1280×720 y 1366×768:** casi todo se ve bien. El problema es el **editor**: el encabezado, la escalera de
  totales, las pestañas Rubro/Piso/Material/Gremio y "Agregá un trabajo" ocupan unos 600 px. La tabla de trabajos
  empieza en el borde de abajo y no se ve ningún trabajo sin bajar. Además la tabla es más ancha que su lugar y
  "Beneficio" y lo que sigue quedan cortados.

## 1. Qué cambia, para Sol

### A. El menú y la barra de arriba
- **Menos de 1024 px de ancho** (celular, tablet, ventana angosta): el menú lateral se esconde. En la barra de arriba
  aparece **☰**, que lo abre como un cajón desde la izquierda, con el mismo contenido y el mismo orden. Se cierra al
  elegir algo, al tocar afuera, con la X o con Esc. El contenido usa todo el ancho.
- **Barra de arriba en el celular:** ☰, el logo chico (sin "PRESUPUESTADOR PRO" ni la empresa: la empresa va dentro
  del cajón), el botón de la IA, **NUEVO** como un botón redondo "+" (abre el mismo menú con las tres formas de
  empezar, de ancho completo) y el avatar. Nada se corta ni se superpone.
- **1024 px o más:** el menú queda fijo como hoy. Entre 1024 y 1279 px arranca **angosto** (solo íconos, 64 px, con el
  nombre al pasar el mouse). Con un botón « / » se agranda o se achica, y la app se acuerda de la elección (por
  usuario, en el navegador). **1280 px o más: igual que hoy** (los e2e de siempre corren así).
- El bloque "Proyecto actual" (Editor, Análisis, Planos con IA, Exportar, Versiones) sigue en el menú. En el celular
  también aparece arriba del contenido de esas pantallas como pestañas que se deslizan de costado.

### B. El editor
- **Notebook baja (800 px de alto o menos), 1024 px o más de ancho.** El primer trabajo de la tabla se ve sin bajar.
  - La escalera de totales se compacta a **un renglón**: "Costo directo $X → Precio sin IVA $Y · con IVA $Z" con
    "Ver la escalera". Al tocarlo se abre como hoy, y la app se acuerda de lo elegido.
  - "Agregá un trabajo" queda en un renglón: buscador, cantidad, unidad, Agregar. La ayuda va en un ícono "?".
  - Los botones del encabezado no pasan a dos renglones. Lo que no entra va a un menú "Más" (⋯). "Guardar versión"
    queda siempre a la vista.
- **Tabla de trabajos en la notebook:** se desliza de costado dentro de su caja. Las columnas **Código y Trabajo
  quedan fijas** a la izquierda y el **total queda fijo** a la derecha. Ninguna columna se corta a la mitad.
- **Celular (menos de 768 px):**
  - **Encabezado:** nombre de la obra, estado, "Guardar versión" y "Más" (⋯) con Recálculo completo, Planos con IA,
    Diferencias con el Excel y Exportar.
  - **Escalera:** una tarjeta con Precio sin IVA y con IVA grandes y el costo directo abajo. "Ver la escalera" abre
    los 6 escalones apilados.
  - **Rubro, Piso, Material y Gremio:** pestañas que se deslizan de costado.
  - **El árbol de rubros:** un botón "Rubro: 1 TAREAS PRELIMINARES ▾" que abre el árbol en una hoja desde abajo.
    Elegir un rubro la cierra.
  - **Los trabajos:** **tarjetas** en vez de tabla. Cada una muestra código, nombre (hasta 2 renglones), unidad ·
    cantidad, precio sin IVA y el semáforo. Tocar la tarjeta abre el detalle del trabajo. La cantidad se puede
    cambiar desde la tarjeta con un campo numérico grande.
  - **Agregar un trabajo:** el buscador a lo ancho; cantidad y unidad abajo; Agregar a lo ancho.

### C. Las otras pantallas en el celular
- **Detalle de un trabajo.** Los 5 importes por unidad van en 2 columnas. Cada recurso (materiales, mano de obra,
  etc.) es una tarjeta: descripción, código chico, "cantidad unidad × precio = subtotal", y desperdicio y "Lo compra
  el cliente" en una línea chica. Editar y borrar pasan a un menú ⋯ con botones grandes. "Cambiar fórmula" y "Buscar
  en internet" se pueden tocar fácil.
- **Diferencias con el Excel y Análisis.** Cada trabajo es una tarjeta con Excel / App / Diferencia. Los filtros se
  deslizan de costado y los cuadros de arriba van en 2 columnas.
- **Mis presupuestos, Cargar obra, Nuevo presupuesto, Importar Excel, Lista de precios, Fórmulas, Correcciones,
  Coeficiente de pase, Exportar, Versiones, Ayuda, Login y las de la clave:** una columna, sin nada que se salga. Los
  pasos (1 Subir · 2 Revisar · 3 Cargar) entran en el ancho. Los campos de porcentaje de Coeficiente de pase quedan
  en su renglón.
- **Ventanas** (buscador de precios, editor de fórmula, confirmaciones, elegir fórmula): en el celular ocupan toda la
  pantalla, con el título y la X fijos arriba y los botones fijos abajo.
- **Para el dedo:** todo lo que se toca mide al menos 40 px de alto. Los campos usan letra de 16 px, así el iPhone no
  hace zoom al escribir. Nada depende de pasar el mouse.

## 2. Pantalla (`frontend/src/`)

- `lib/pantalla.ts` (ya está): `usePantalla()` → `{celular, chica, baja}` con los cortes 768 / 1024 / alto 800. Los
  cambios de diseño van con clases de Tailwind (`md:`, `lg:`, `[@media(max-height:800px)]:`) siempre que se pueda. El
  hook se usa solo donde cambia **qué** se muestra (tarjetas o tabla, hoja o árbol), no para estilos.
- `components/layout/AppLayout.tsx`, `TopBar.tsx`, `Sidebar.tsx`: cajón, menú angosto con «/» guardado
  (`localStorage`, protegido con try/catch), barra compacta.
- Editor: `pages/Editor.tsx`, `components/ui/CostSummaryBar.tsx`, `TreeView.tsx`, `DataTable.tsx`,
  `AgregarTrabajo.tsx`, `ViewModeSelector.tsx`. Detalle: `pages/ItemDetail.tsx`. `pages/DiferenciasExcel.tsx`,
  `pages/Analysis.tsx` y el resto de `pages/`.
- No cambian rutas, llamadas al servidor, cálculos ni textos de fondo. Los `data-testid` y los textos que leen los
  e2e de siempre se mantienen. Si hace falta cambiar uno, se ajusta el e2e **sin bajar ninguna verificación**.
- Textos nuevos en castellano rioplatense con tildes: `node scripts/check_textos.cjs` en 0.

## 3. Pruebas

- **e2e nuevos** `scripts/e2e_celular.cjs` (menú, barra y recorrido de todas las pantallas) y
  `scripts/e2e_celular_editor.cjs` (editor, detalle, Diferencias y Análisis), con el servidor falso y Ginkgo cargada. Recorren las 15 pantallas de la
  medición en **390×844, 768×1024, 1280×720 y 1366×768**, y en cada una controla:
  - nada más ancho que la ventana, salvo lo que está adentro de una caja que se desliza;
  - en el celular, el contenido usa al menos el ancho de la ventana menos 32 px.
- **Además, el e2e controla en cada medida:**
  - **Celular:**
    - ☰ abre el cajón con todas las entradas del menú, y elegir una navega y cierra el cajón;
    - NUEVO "+" ofrece las tres formas de empezar;
    - en el editor se ven tarjetas (no la tabla) y tocar una abre el detalle;
    - el botón Rubro abre el árbol y elegir otro rubro cambia las tarjetas;
    - la cantidad se cambia desde la tarjeta y el total se actualiza;
    - agregar un trabajo funciona;
    - "Más" ofrece Exportar y Diferencias;
    - la ventana del buscador de precios ocupa toda la pantalla y se cierra;
    - los campos tienen letra de 16 px.
  - **Notebook 1280×720:**
    - en el editor el primer trabajo se ve sin bajar, y "Ver la escalera" abre la escalera completa;
    - la tabla se desliza de costado con Código y Trabajo fijos;
    - entre 1024 y 1279 px el menú arranca angosto, «/» lo agranda y al recargar se acuerda.
  - **1366×768:** el menú queda como hoy.
- Capturas a 390 y 1280×720 de cada pantalla, en una carpeta fuera del repo, revisadas una por una.
- Los e2e de siempre con todos sus OK:

  | e2e | OK |
  |---|---:|
  | palabras | 75 |
  | exportar | 50 |
  | un_solo_total | 49 |
  | ginkgo | 37 |
  | nuevo_presupuesto | 59 |
  | agregar_trabajo | 44 |
  | formulas | 35 |
  | detalle_trabajo | 13 |
  | sin_precios | 12 |
  | ajuste_ginkgo | 62 |

  Corren en 1280 px de ancho o más, como hoy.
- `npm run build` pasa. tsc con sus errores viejos y ninguno nuevo.

## 4. Fuera de este PR
- Usar la app sin conexión.
- Instalarla como aplicación (PWA).
- Cargar obra desde la cámara.
- Una versión del PDF para el celular.
- Arreglar la subida de listas por .csv (aparte).
