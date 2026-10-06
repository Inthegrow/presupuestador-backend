# Plan: agregar un trabajo en un renglón del editor (entrega 4)

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (endpoint nuevo).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL), entrega 4,
> fricciones B-9, B-10, B-12 y B-14. Es "el corazón del camino nuevo": armar el presupuesto escribiendo trabajos.
> Las tres formas de empezar y el asistente (PR #39) quedan como están.

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| Para agregar un trabajo en el editor: "+ Item" pide Código, Unidad, Cantidad, "MAT Unit." y "MO Unit.", sin fórmula. Después hay que entrar al trabajo, "Cargar fórmula", elegir, aplicar y volver: unos 6 clics por trabajo. | Arriba de la tabla del editor, un renglón: **"Agregá un trabajo: escribí como hablás (hueco 18, contrapiso, pintura…)"**. Mientras escribe aparece "Quizás sea:" (las mismas sugerencias del detalle: la propuesta y las parecidas) y la lista filtrada de fórmulas. Elige una, pone la **cantidad** (la unidad la pone la fórmula; si escribe otra unidad, se respeta y aplica la pregunta de conversión), **Enter**: el trabajo queda creado, con su fórmula aplicada, dentro del rubro de la fórmula, y aparece en la tabla con su semáforo. |
| El trabajo nuevo cae en el rubro que esté elegido en el árbol, o suelto. | Cae en el **rubro de la fórmula** (su categoría: "Albañilería", "Terminaciones"…); si el presupuesto no tiene ese rubro, se crea. Si Sol tiene un rubro elegido en el árbol, va a ese. |
| Un trabajo sin fórmula se carga con MAT/MO a mano. | Sigue existiendo, plegado: "Agregar un trabajo sin fórmula (precio a mano)" abre el formulario de hoy, con etiquetas en castellano ("Materiales por unidad", "Mano de obra por unidad"). |
| La tabla no dice qué trabajos están bien. | Cada trabajo de la tabla del editor muestra el mismo punto de color que el detalle (verde / amarillo / rojo) con su frase al pasar el mouse. Para no pedir los faltantes uno por uno, el servidor los devuelve todos juntos (punto 2). |

## 2. Servidor

- `POST /budgets/{budget_id}/trabajos` (en `app/routers/budgets.py` o donde encaje mejor; `require_editor`; todo por
  `org_id`). Body: `{template_id: str, cantidad: number > 0, descripcion?: str, unidad?: str, parent_id?: str, factor?: number}`.
  - `descripcion` por defecto: el nombre de la fórmula en "Oración" (primera mayúscula). `unidad` por defecto: la de la
    fórmula.
  - Rubro: `parent_id` si viene (y es un rubro de ese presupuesto); si no, el rubro cuyo nombre coincide con la
    `categoria` de la fórmula (sin importar mayúsculas ni tildes); si no existe, se crea (como lo crea `create-full`).
  - Código del trabajo: el siguiente dentro del rubro (como numera hoy el editor; mirar `createItem`/secciones).
  - Crea el trabajo y le aplica la fórmula con **la misma lógica que `apply_template`** (reutilizarla: todo o nada,
    conversión de unidades con `FALTA_CONVERSION`, precios faltantes, cascada). Si la conversión falta, **no se crea nada**
    y vuelve el mismo 409 `FALTA_CONVERSION` (la pantalla pregunta y reenvía con `factor`). Si algo falla después de crear
    el trabajo, se borra el trabajo (no queda un trabajo vacío).
  - Respuesta: `{item: <el trabajo creado, ya calculado>, rubro: {id, nombre, creado: bool}, precios_faltantes: [...]}`.
- `GET /budgets/{budget_id}/precios-faltantes` → `{por_item: {item_id: n}}` con la misma regla de
  `budget_prices.precios_faltantes` (para el punto de color de la tabla). Que lea los recursos del presupuesto en bloque
  (no un pedido por trabajo).
- Tests: crear con fórmula en m² → trabajo dentro del rubro de su categoría (creado si no estaba), con recursos y neto;
  rubro elegido (`parent_id`) se respeta; unidad distinta sin factor → 409 y no queda nada creado; con factor → creado y
  escalado; fallo al aplicar → no queda el trabajo; otra empresa → 404; `precios-faltantes` del presupuesto cuenta bien.
  `python3 -m pytest -q` todo verde (hoy 656 passed, 14 skipped); `ruff check` sin errores nuevos.

## 3. Pantalla (`frontend/src/`)

- `pages/Editor.tsx`: el renglón "Agregá un trabajo" arriba de la tabla del rubro, con `components/ui/BuscadorFormulas.tsx`
  (el del detalle, con "Quizás sea" usando `templateApi.sugerir(texto, '')` sobre lo que escribe, con una espera corta entre
  teclas) + campo de cantidad (y unidad opcional, prellenada con la de la fórmula) + Enter / botón "Agregar". Después de
  agregar: limpia el renglón, deja el foco en el buscador para el próximo trabajo, refresca el árbol y la tabla, y si
  faltan precios lo dice en una línea ("Agregado. Faltan 3 precios: …"). La pregunta de conversión, igual que en el
  detalle (con el valor propuesto). Errores visibles.
- El formulario de hoy (`components/ui/AddItemForm.tsx`) queda plegado detrás de "Agregar un trabajo sin fórmula (precio a
  mano)", con etiquetas en castellano.
- Punto de color por trabajo en la tabla (con `lib/semaforo.ts` y el nuevo `precios-faltantes` del presupuesto). Para un
  trabajo: con fórmula y 0 faltantes → verde; faltantes > 0 o sin recursos → rojo; recursos sin fórmula → amarillo; si la
  consulta falló → sin punto (nunca verde sin saber).
- e2e nuevo `scripts/e2e_agregar_trabajo.cjs` (patrón de `scripts/e2e_detalle_trabajo.cjs`): presupuesto vacío → escribir
  "hueco 18", elegir la propuesta, 40, Enter → aparece en "Albañilería" con verde; "contrapiso e=8cm", 30 → pregunta con
  0,08 → aparece; "lija" → pintura, 120 → rojo "faltan precios"; el foco vuelve al buscador; el formulario sin fórmula
  sigue andando.
- `npm run build` pasa; tsc con sus 8 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
Que "+ Nuevo Presupuesto" vaya directo al editor vacío (se decide después de que Sol pruebe esto), un solo total (5),
exportar (6), palabras y tildes del resto (7), celular (8).
