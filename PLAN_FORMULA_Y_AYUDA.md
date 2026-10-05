# Plan: "receta" pasa a llamarse "fórmula", y una sección de Ayuda dentro de la app

> Fecha: 2026-10-05. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambian textos que manda el servidor).
> Origen: Carlos, 05/10: "receta… no me gusta nada, deberíamos elegir otra palabra"; eligió **fórmula**. Y "subí a
> una sección dentro de la app la instrucción de uso".

## 0. Reglas
- Solo cambian **textos que ve el usuario**. No cambian nombres de campos, rutas, tablas, claves de JSON ni valores
  internos (`plantilla`, `receta`, `sin_receta`, `motivo_rojo`, `/app/templates`, `obra_recetas_memoria`, etc.).
- Las tres formas de empezar (Cargar obra, Nuevo Presupuesto, Importar Excel) **se quedan como están**.
- Género: "la fórmula", "las fórmulas". Ejemplos: "Sin receta" → "Sin fórmula"; "Elegir receta" → "Elegir
  fórmula"; "Nueva receta" → "Nueva fórmula"; "Quizás sea" queda igual; "con receta" → "con fórmula";
  "recetas del Maestro" → "fórmulas del Maestro"; "Recetas" (menú y título) → "Fórmulas". Cuidar la concordancia
  ("la receta no lo tiene" → "la fórmula no lo tiene"; "una receta" → "una fórmula"; "elegida" queda igual).
- **Choque de nombres**: dentro de cada fórmula, cada material tiene hoy una "fórmula" de cantidad (`Q * espesor`).
  Esa pasa a llamarse **"Cantidad"**: columna "Fórmula / Rendimiento" del editor → "Cantidad / Rendimiento";
  tooltip de `ItemDetail.tsx` "Fórmula (Q = cantidad del ítem)" → "Cantidad (Q = cantidad del ítem)". El campo
  `formula` no cambia.

## 1. Servidor (`app/`) — textos
- Todo mensaje de error, nota, aviso o texto que llegue a la pantalla y diga receta/recetas: `app/routers/obras.py`
  (409 y 400), `app/obra_import.py` (las `nota` de MAPEO, los motivos de "no hay receta…", `describe`/textos de
  `_proposal` si llegan a la pantalla), `app/routers/templates.py`, `app/routers/excel.py`, y cualquier otro que
  aparezca con `grep -rn "eceta" app/`. Comentarios y docstrings: no hace falta tocarlos.
- Los informes en Markdown de `app/maestro_recipes.py` y `app/obra_import.py` (`render_*`, informes de carga): sí,
  si alguien los lee.
- Las `notas` que ya están guardadas en la base (vienen del Maestro) no se migran.
- Tests: actualizar los que comparan esos textos. `python3 -m pytest -q` todo verde (hoy 584 passed, 14 skipped).
  `ruff check` en los archivos tocados, sin errores nuevos.

## 2. Pantalla (`frontend/src/`) — textos
- Todas las pantallas: `pages/CargarObra.tsx`, `DiferenciasExcel.tsx`, `Templates.tsx`, `ItemDetail.tsx`,
  `NewProject.tsx`, `MarkupChain.tsx`, `AIPlans.tsx`, `Dashboard.tsx`, `components/**`, `lib/api.ts` (solo
  mensajes), `components/layout/Sidebar.tsx`. Buscar con `grep -rni "receta" frontend/src`; al terminar, la
  única aparición permitida es en nombres de campos/tipos/variables.
- El e2e (`scripts/e2e_ginkgo.cjs`, `scripts/e2e_sin_precios.cjs`) busca textos: actualizarlos.

## 3. Pantalla nueva: Ayuda (`/app/ayuda`)
- `pages/Ayuda.tsx`, ruta en `App.tsx`, en el menú (`Sidebar.tsx`) al final, sección propia "AYUDA" con un ítem
  **Ayuda** (ícono de signo de pregunta de lucide, como los otros íconos). La ven todos los roles.
- Mismo estilo que las otras pantallas (título en mayúsculas como las demás, frase gris debajo: "Cómo se usa la
  app, paso a paso."). Arriba, un índice con enlaces a cada sección (anclas). Texto, sin capturas.
- Contenido (textos exactos en el anexo A, se pueden ajustar solo para que entren en el diseño):
  1. **Cargar una obra desde el Excel** — los 8 pasos.
  2. **Qué quiere decir cada color** — verde, amarillo, rojo.
  3. **Cómo encuentra la app la fórmula de cada trabajo** — los 3 pasos.
  4. **Si el Excel tiene otro formato**.
  5. **Lista de precios**: cuál se usa.
- `npm run build` pasa; tsc con sus 13 errores viejos, ninguno nuevo.

## Anexo A: textos de la Ayuda

### 1. Cargar una obra desde el Excel
1. **Entrar a Cargar obra.** Desde SOLÉ: Crecer → Presupuestador → Abrir el Presupuestador, con el mismo mail y
   clave de SOLÉ. En el menú de la izquierda, Cargar obra.
2. **Arrastrar el Excel de la obra.** El de siempre, el que tiene la hoja 01_C&P. No hay que agregarle nada. Si se
   recarga la página, la app ofrece seguir donde quedaste.
3. **Leer el resumen.** Cuántos trabajos hay, cuántos listos (verde), para confirmar (amarillo) y en rojo.
4. **Resolver los precios.** En el panel "Precios para corregir", tocar "Guardar los precios que trae el Excel".
   Para un material que no se cotiza, "Va en $0". Para los demás, escribir el precio sin IVA y "Guardar".
5. **Mirar las tarjetas rojas que queden.** Si hay una pregunta, responderla. Si la fórmula no es la correcta,
   "Cambiar". Si no hay fórmula y el trabajo se cobra con el precio del Excel, "Confirmar".
6. **Los amarillos, si hay tiempo.** Confirmarlos deja todo verde, pero no hace falta para cargar.
7. **Poner el nombre y Cargar presupuesto.** Si quedan materiales sin precio, marcar "Cargar igual": esos
   materiales quedan en $0 y después se completan en Lista de precios. Puede tardar un minuto.
8. **Ver diferencias con el Excel.** Arranca en costo directo: ahí se ven las fórmulas. "Precio final" suma el
   margen de cada uno. Si el Excel no traía precios, no hay con qué comparar.

### 2. Qué quiere decir cada color
- **Verde · Listo**: la app encontró la fórmula y todos los precios. No hay que hacer nada.
- **Amarillo · Para confirmar**: la app no está segura (sin fórmula, o una duda escrita en el Maestro). Se puede
  cargar igual.
- **Rojo · Falta resolver**: falta un precio, una conversión o una fórmula. Hay que resolverlo, o marcar "Cargar
  igual" si es solo un precio.

### 3. Cómo encuentra la app la fórmula de cada trabajo
Prueba tres cosas, en este orden:
1. **Lo que ya se eligió antes.** Si en otra obra se eligió una fórmula para un trabajo con el mismo nombre y la
   misma unidad, usa esa.
2. **Las reglas por nombre.** Busca palabras en el nombre del trabajo (por ejemplo, "hueco del 18" → fórmula 5.1.4
   Ladrillo cerámico hueco del 18). Si el trabajo dice un espesor ("e=10cm"), lo usa para pasar de m³ a m².
3. **Las parecidas.** Si ninguna regla aplica, muestra "Quizás sea…" con las fórmulas de nombre más parecido. Esas
   nunca se ponen solas: hay que elegirlas.
Las fórmulas salen del Maestro y se pueden ver y corregir en **Fórmulas**. Una corrección vale para las obras que
se carguen después; las ya cargadas no cambian.

### 4. Si el Excel tiene otro formato
Cargar obra lee la hoja **01_C&P** con el formato de Terrac: código en la columna A, descripción en B, unidad en C
y cantidad en D, desde la fila 8. Si el Excel no tiene esa hoja, la app avisa y no carga nada. Si tiene la hoja
pero con otras columnas, los trabajos salen mal: conviene pasar las cantidades a la planilla de Terrac. Los
precios (columnas E, J, N y Z) no son obligatorios: si no están, la app calcula todo con las fórmulas y la lista de
precios.

### 5. Lista de precios: cuál se usa
La app calcula con la lista **oficial**. Las demás son para consultar. Si un material tiene varios precios, usa el
que estaba vigente a la fecha "precios al" del presupuesto (o el de hoy). Un precio en $0 solo vale si tiene
fecha: si no, el material cuenta como sin precio. Importar dos veces el mismo Excel actualiza su lista; no crea
otra.
