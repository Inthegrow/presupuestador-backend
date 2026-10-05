# Plan: Excel sin precios (paso 4c del plan maestro, falla 15)

> Fecha: 2026-10-05. Contrato para un solo PR. **Render: Manual Deploy SÍ** (toca el servidor).
> Hoy la app supone que el Excel de la obra trae costos (columnas E, J, N y Z de `01_C&P`). Si una obra nueva
> viene solo con cantidades, pasan tres cosas malas en silencio: los trabajos sin receta se cargan en $0 ("se
> usa el precio del Excel", que es cero), el panel "Guardar los precios que trae el Excel" no aparece (eso está
> bien) y "Ver diferencias" compara contra ceros. Regla nueva: **un trabajo sin receta y sin precio en el Excel
> está en rojo**; con el Excel sin precios no se ofrece la comparación.

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| Trabajo sin receta en un Excel sin precios: amarillo "Sin receta: se usa el precio del Excel" y se carga en $0. | **Rojo**: "Sin receta, y este trabajo no tiene precio en el Excel. Elegí una receta." Con "Quizás sea" y **Elegir receta**. Sin botón Confirmar. En el buscador no aparece "Usar el precio del Excel". No se puede cargar hasta resolverlo. |
| Las tarjetas dicen "Excel $0" y el resumen "Total del Excel $0". | Si el Excel no trae precios: aviso celeste arriba del resumen "Este Excel no trae precios: la app calcula todo con las recetas y la lista de precios." Las tarjetas no muestran "Excel $…". El resultado no muestra "Total del Excel" ni el botón "Ver diferencias con el Excel". |
| "Ver diferencias" sobre un presupuesto así compara contra ceros. | El servidor contesta "Este Excel no traía precios: no hay con qué comparar." y la pantalla lo muestra con el botón "Abrir el presupuesto". |
| Un trabajo sin receta cuyo renglón del Excel vale $0 (aunque el resto tenga precios) se carga en $0. | Misma regla: rojo, hay que elegir receta. |

## 2. Servidor (`app/routers/obras.py`, tests en `tests/test_obras_api.py`)

- `analyze`: cada tarea ya tiene `total_excel`. Nuevo motivo de rojo **`"sin_receta"`**: `receta is None and total_excel <= 0`
  (se evalúa antes que `"precio"`, después de `"receta_inexistente"` y `"pregunta"`). `motivo_rojo` pasa a admitir
  `"receta_inexistente" | "pregunta" | "sin_receta" | "precio" | None`. Las sugerencias ("Quizás sea") siguen viniendo.
- Resultado del análisis: campo nuevo **`"excel_con_precios": bool`** = algún ítem con `excel.neto > 0` o
  `excel.mat_unit + excel.mo_unit > 0`. `resumen.total_excel` sigue (será 0).
- `/obras/cargar`: `duros` ya frena todo rojo con motivo distinto de `"precio"`, así que `"sin_receta"` frena solo.
  El mensaje del 409 pasa a distinguir: si todos los duros son `"sin_receta"`: "Hay {n} trabajo(s) sin receta y sin
  precio en el Excel: elegí una receta antes de cargar". Si no, el mensaje de hoy.
- `GET /obras/{id}/diferencias`: si la suma de `excel_neto` y la de `excel_directo` de los ítems son 0 → 409 con
  `SIN_PRECIOS_EXCEL = "Este Excel no traía precios: no hay con qué comparar."` (distinto de `SIN_EXCEL`, que es
  para presupuestos viejos sin las columnas).
- Tests: Excel de prueba **sin precios** (las columnas E, J, N, Z vacías o 0; sin hojas de detalle ni 00_*):
  (a) un trabajo con receta queda verde o rojo por precio según el catálogo, como hoy; (b) uno sin receta queda
  rojo `motivo_rojo == "sin_receta"` con sugerencias; (c) `excel_con_precios` es False; (d) `/obras/cargar` da 409
  con el mensaje nuevo y nombra la clave; (e) eligiendo receta por `asignaciones`, carga bien; (f) `/diferencias`
  da 409 `SIN_PRECIOS_EXCEL`. (g) Con el Excel de prueba de siempre (con precios): nada cambia, `excel_con_precios`
  True, y un trabajo sin receta cuyo renglón vale 0 queda rojo `sin_receta`.
- `python3 -m pytest -q` todo verde (hoy 549 passed, 14 skipped). `ruff check` en los archivos tocados.

## 3. Pantalla (`frontend/src/`)

- `lib/api.ts`: `ObraAnalisis.excel_con_precios: boolean`; `ObraTarea.motivo_rojo?: 'receta_inexistente' | 'pregunta' |
  'sin_receta' | 'precio' | null` (hoy el campo viene del servidor; si el tipo no lo tiene, agregarlo).
- `pages/CargarObra.tsx`:
  - Tarjeta con `motivo_rojo === 'sin_receta'`: chip rojo "Falta resolver"; texto "Sin receta, y este trabajo no
    tiene precio en el Excel. Elegí una receta."; "Quizás sea: …" como hoy; botón **Elegir receta**; sin
    "Confirmar". En `RecetaBuscador`, la opción "Usar el precio del Excel (sin receta)" se oculta cuando la tarea
    tiene `total_excel <= 0` (prop nueva `sinPrecioExcel`).
  - Si `!analisis.excel_con_precios`: aviso celeste (`bg-sky-50 text-sky-800`) debajo del resumen: "Este Excel no
    trae precios: la app calcula todo con las recetas y la lista de precios." Las tarjetas no muestran "· Excel
    $…". La frase de estado cuenta estos rojos como "N trabajos sin receta" (ej.: "Te faltan 3 recetas y 2
    precios"). El resultado (`carga`) no muestra la tarjeta "Total del Excel" ni "Ver diferencias con el Excel"
    (usar `carga.total_excel > 0`).
- `pages/DiferenciasExcel.tsx`: el 409 con el texto nuevo se muestra como aviso (ya se muestra el `detail` del
  409 `SIN_EXCEL`; verificar que el texto nuevo pase igual) con el botón "Abrir el presupuesto".
- `pages/Editor.tsx` (o donde esté el botón "Ver diferencias con el Excel" del editor): se deja; la página explica.
- `npm run build` pasa; tsc con sus 13 errores viejos, ninguno nuevo.

## 4. Prueba de punta a punta (`scripts/e2e_sin_precios.cjs`, nuevo)

`scripts/make_ginkgo_sin_precios.py` (nuevo): a partir de `ginkgo.xlsx` del `EXCEL_DIR`, genera
`ginkgo_sin_precios.xlsx` en el mismo directorio: borra las hojas que no sean `01_C&P` y vacía las columnas E, J,
N y Z de esa hoja (deja las cantidades). El e2e: sube ese archivo; verifica el aviso "Este Excel no trae
precios"; que haya tarjetas rojas con "no tiene precio en el Excel"; que al tocar "Elegir receta" en una no
aparezca "Usar el precio del Excel"; que "Cargar presupuesto" esté deshabilitado o dé el mensaje "sin receta y
sin precio en el Excel"; elige una receta en una tarjeta y verifica que pasa a verde o a rojo por precio. No
hace falta llegar a cargar. Misma estructura que `scripts/e2e_ginkgo.cjs` (helper `check()`).

## 5. Fuera de este PR
- Que la app proponga una receta para cada trabajo sin receta a partir del nombre (hoy "Quizás sea" ya lo hace).
- Cargar los precios de un Excel sin precios desde otro Excel (lista de precios aparte).
