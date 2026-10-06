# Plan: el detalle de un trabajo usa el buscador y el semáforo de Cargar obra (entrega 2)

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (endpoint nuevo).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL),
> entrega 2. Sigue a `PLAN_PRECIO_SEGURO.md` (PR #37, mergeado): no cambia nada de lo que hizo.

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| "Cargar fórmula" abre una ventana con pestañas por rubro ("Aislaciones" primero), sin buscador; hay que encontrar "LADRILLO CERAMICO HUECO DEL 18" a ojo. | La ventana abre con un buscador arriba ("Buscá como hablás: revoque, pintura, contrapiso…", el de Cargar obra) y, antes de la lista, **"Quizás sea:"** con la fórmula que propone la app para el nombre de este trabajo (la que eligió antes para un trabajo igual, o la regla de Cargar obra) y hasta 3 parecidas, cada una con "por qué" ("Se parece por 'hueco', '18'"). La lista completa queda debajo, agrupada por rubro, filtrada por lo que se escribe. |
| El detalle no dice si el trabajo está bien. | Al lado del título, el mismo chip que las tarjetas de Cargar obra: **verde "Listo"** (tiene fórmula y no faltan precios), **rojo "Falta resolver"** (faltan precios, o no tiene nada cargado), **amarillo "Para confirmar"** (tiene recursos cargados a mano, sin fórmula). Debajo del chip, una frase: "Faltan 8 precios", "Sin fórmula: cargá una o completá los recursos a mano", etc. |
| Las tarjetas de arriba dicen "MAT UNIT", "MO UNIT", "EQ UNIT", "MAT.IND UNIT", "SUB UNIT". | "Materiales por m²", "Mano de obra por m²", "Equipos por m²", "Materiales indirectos por m²", "Subcontratos por m²" (la unidad del trabajo, en palabras de obra: m², m³, metro, unidad, etc.). |
| Cada renglón de recurso muestra la cuenta interna ("= (Q*2/12)/20", "redondeo +0,90") y la columna "Qty Efectiva". | Por defecto se ve: código, descripción, unidad, cantidad, desperdicio, precio y subtotal. Un enlace chico **"Ver cómo se calcula"** arriba de las tablas muestra la cuenta, el redondeo y la cantidad efectiva (columna "Cantidad con desperdicio"). La elección se recuerda en el navegador. |

## 2. Servidor

- `GET /templates/sugerir?descripcion=...&unidad=...` (en `app/routers/templates.py`, con `get_current_user`, todo por
  `org_id`). Respuesta:
  ```json
  {"propuesta": {"id", "codigo", "nombre", "unidad", "categoria", "origen": "memoria" | "regla", "porque", "factor"} | null,
   "parecidas": [{"id", "codigo", "nombre", "unidad", "categoria", "porque", "puntaje"}]}
  ```
  - `propuesta`: la misma decisión que Cargar obra antes de que Sol elija (`_proposal` de `app/routers/obras.py`: memoria
    por `task_key(descripcion, unidad)` y después la regla `MAPEO`). Solo si esa decisión tiene **una** fórmula; `factor`
    es el de la regla/memoria si lo hay (puede ser null). Si la regla combina varias fórmulas, `propuesta` es null y esas
    fórmulas van primeras en `parecidas` con `porque` "Cargar obra usa {A} + {B} para este trabajo".
  - `parecidas`: `suggest_recipes(descripcion, templates, top=3)`, sin repetir la propuesta.
  - `id` es el id de `item_templates` (lo que usa `apply`). Reusar `_templates` y `_memoria` de obras.py (no duplicar).
  - `descripcion` vacía: `{"propuesta": null, "parecidas": []}`.
- Tests: "Muro ladrillo hueco del 18" (m2) → propuesta 5.1.4 origen "regla"; un trabajo guardado en memoria → origen
  "memoria" con su fórmula; un texto sin regla ("Revestimiento texturado raro") → propuesta null y parecidas por palabras;
  descripción vacía; otra empresa no ve fórmulas ajenas. `python3 -m pytest -q` todo verde (hoy 628 passed, 14 skipped);
  `ruff check` sin errores nuevos.

## 3. Pantalla (`frontend/src/`)

- `components/ui/BuscadorFormulas.tsx` (nuevo): el buscador de `RecetaBuscador` de `CargarObra.tsx` (input, filtro por
  nombre y rubro, lista agrupada) como componente reutilizable, con props opcionales para lo propio de Cargar obra (la
  opción "Usar el precio del Excel (sin fórmula)" va como un `extra` que CargarObra le pasa) y un bloque opcional
  "Quizás sea:". `CargarObra.tsx` pasa a usarlo **sin cambiar lo que se ve ni los textos** (el e2e de Ginkgo tiene que
  seguir dando 33 OK).
- `lib/api.ts`: `templateApi.sugerir(descripcion, unidad)`.
- `pages/ItemDetail.tsx`:
  - La ventana de fórmulas usa `BuscadorFormulas` con "Quizás sea:" arriba (la propuesta con un chip "Propuesta" y su
    `porque`; las parecidas con su `porque`). Elegir una sigue el mismo camino de hoy (confirmar reemplazo → conversión →
    aplicar), y si la propuesta trae `factor`, la pregunta de conversión arranca con ese valor.
  - Chip de estado y frase (tabla del punto 1), con los colores de `ESTILO` de CargarObra (mover `ESTILO` a un lugar
    común si hace falta). Se recalcula con los recursos y los faltantes que ya se cargan.
  - Tarjetas de arriba con las etiquetas nuevas y la unidad en palabras (`m2` → `m²`, `m3` → `m³`, `ml`/`m` → `metro`,
    `u`/`un` → `unidad`, `gl` → `global`; otras, tal cual).
  - "Ver cómo se calcula" (punto 1), recordado en `localStorage` con try/catch.
- `npm run build` pasa; tsc con sus 13 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
El asistente (entrega 3), agregar trabajo en un renglón del editor (4), un solo total (5), resto de exportar (6),
coherencia general y tildes (7), celular (8).
