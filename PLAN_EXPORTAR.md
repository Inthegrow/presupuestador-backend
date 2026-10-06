# Plan: exportar sin sorpresas (entrega 6)

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (formato Terrac nuevo en el servidor).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL), entrega 6
> (B-6 y textos). El PDF para el cliente ya existe (PR #37) y los totales ya coinciden en todos lados (PR #42).

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| La pantalla Exportar tiene 4 tarjetas iguales, con jerga: "PDF Profesional · UNIVERSAL", "Excel Estándar (BoQ) · Bill of Quantities genérico", "Excel Formato Terrac · 26 col + hojas detalle 78 filas", "Vista Cliente (Venta)". No dice para quién es cada una. | Arriba, el total que se va a exportar, el mismo del editor: "Ginkgo · Precio sin IVA $2.639.518.457 · con IVA $3.193.817.333 · 244 trabajos". Debajo, cuatro opciones que dicen **para quién son** y **qué llevan** (2 o 3 renglones cada una). La primera, destacada: **"Para el cliente (PDF)"**. |
| "Excel Formato Terrac" baja **el mismo archivo** que el Excel estándar. | **"Planilla Terrac (Excel)"** es la planilla de Sol: hoja `01_C&P` con sus 26 columnas, sus encabezados y sus rubros y pisos, un renglón por trabajo. Además, **una hoja por trabajo** con sus materiales y su mano de obra, como las hojas de detalle de Sol, y una hoja "Coeficiente de pase" con los porcentajes. Se puede volver a subir en Cargar obra: vuelve con los mismos trabajos, cantidades, rubros, pisos y porcentajes de la obra (los lee de la hoja "Coeficiente de pase"); los trabajos sin fórmula conservan su precio al centavo y los que tienen fórmula se calculan con las fórmulas y la lista oficial de ese día (Cargar obra es para calcular un cómputo, no para restaurar una copia exacta). |
| "PDF Profesional". | **"Informe interno (PDF)"**: con costos, indirectos, beneficio e impuestos. "No se lo mandes al cliente: tiene tus costos". |
| "Excel Estándar (BoQ)". | **"Planilla simple (Excel)"**: un renglón por trabajo con su rubro y la escalera (costo directo → precio con IVA). Para filtrar u ordenar, o pasar a otro sistema. Encabezado en negrita, columnas con ancho y formato de pesos, primera fila fija. |
| Se exporta sin avisar si hay trabajos en rojo (precios que faltan): el total sale corto y nadie se entera. | Si hay trabajos en rojo, un aviso arriba **antes** de exportar: "Hay 3 trabajos con precios que faltan: el total puede quedar corto. Ver cuáles" (lleva al editor). Se puede exportar igual. |
| Un error desaparece a los 5 segundos. Los archivos se llaman "Ginkgo_presupuesto.pdf". | El error queda hasta que Sol lo cierra o vuelve a intentar, y dice qué pasó. Los archivos se llaman "Ginkgo - Para el cliente - 2026-10-06.pdf", "Ginkgo - Planilla Terrac - 2026-10-06.xlsx", etc. |
| La nota de abajo habla de "logo SOLE", "26 columnas y 44+ hojas detalle para compatibilidad total". | Se va. Cada tarjeta ya dice lo suyo. |

## 2. Servidor (`app/routers/excel.py` o un módulo nuevo `app/terrac_export.py`)

- `GET /budgets/{id}/export/excel?formato=terrac` (sin `formato`, o `formato=simple`: la planilla simple de hoy,
  mejorada en formato pero con **la misma primera fila de encabezados y los mismos nombres de columna**, porque los
  tests y los e2e la leen así). Mismos permisos y filtro por `org_id` que la exportación actual.
- **Hoja `01_C&P`** (el layout que lee `app/obra_import.py`: `COL_ITEM`=A, `COL_DESC`=B, `COL_UNIDAD`=C,
  `COL_CANTIDAD`=D, E = materiales por unidad, J = M.O. por unidad, N = directo general, Z = total neto; datos desde la
  fila 8). Copiar los encabezados de las filas 1 a 7 de la planilla de Sol (`EDIFICIO …` → nombre de la obra; "PLANILLA
  COMPUTO Y PRESUPUESTO"; fila 5: ITEM, DESCRIPCIÓN, UNIDAD, CANTIDAD, SUBTOTAL 01: GASTOS DIRECTOS … SUBTOTAL 02: GASTOS
  INDIRECTOS … SUBTOTAL 03: BENEFICIO E IMPUESTOS … TOTAL (NETO); filas 6 y 7: V.UNITARIO / V.GENERAL y MAT. / M.O.:
  JORNALES / M.O.: EQUIPOS / M.O.: MATERIALES / M.O.: SUBCONTRATOS / M.O. / GENERAL …).
  - Rubros como renglón de título ("1- TAREAS PRELIMINARES" en B, como Sol), pisos como subtítulo; trabajos con su
    código en A (texto, tal cual: "1.1"), descripción, unidad, cantidad.
  - E..I por unidad, separando por tipo de recurso: material → E, mano_obra → F, equipo → G, mo_material → H,
    subcontrato → I (lo que compra el cliente no suma). Trabajo sin recursos (precio a mano): `mat_unitario` → E,
    `mo_unitario` → F. J = F+G+H+I, K = E+J; L = D×E, M = D×J, N = L+M (debe dar `directo_total` al centavo; si el
    redondeo de unitarios no da, ajustar para que N sea exactamente el guardado).
  - O..Q indirectos (MAT, M.O., general), R..T beneficio **más impuestos** (el encabezado lo dice), U..W total neto por
    unidad, X..Z total neto general. Partir cada total guardado del trabajo entre MAT y M.O. en proporción a L y M.
    Z = `neto_total` guardado (el mismo precio sin IVA del editor).
  - **Valores, no fórmulas**: un archivo hecho por la app no tiene los resultados de las fórmulas calculados, y Cargar
    obra (y cualquier programa que lea los valores) vería celdas vacías. Se escriben números, con formato de pesos.
  - Una fila de totales al final (N, Q, T, Z sumados) que da el resumen del presupuesto.
- **Una hoja por trabajo** (solo los que tienen recursos): nombre = código del trabajo (hasta 31 caracteres, sin
  `[]:*?/\`, único; si se repite, sufijo "-2"). Arriba: código, descripción, unidad, cantidad. Tabla: tipo (en
  palabras: Materiales, Mano de obra, Equipos, Materiales indirectos, Subcontratos), código, descripción, unidad,
  cantidad, desperdicio, precio, subtotal; "Lo compra el cliente" marcado y en $0. Abajo: total = directo del trabajo.
- **Hoja "Coeficiente de pase"**: los 9 porcentajes efectivos del presupuesto y "por cada $100 de costo directo, $X sin
  IVA" (`cascade_factors`).
- Tests (`tests/test_exportar.py`):
  - **Ida y vuelta**: exportar en formato Terrac → leer con `parse_obra` → mismos trabajos (código, descripción, unidad,
    cantidad), mismos rubros y pisos en el mismo orden, directo (N) y neto (Z) de cada uno iguales a los guardados al
    centavo; E y J por unidad coinciden con lo que lee Cargar obra.
  - Fila de totales = resumen del presupuesto. Una hoja por trabajo con recursos y su total = directo. Nombres de hoja
    válidos y únicos (códigos repetidos, largos o con "/"). Precio a mano sin recursos → E/F y sin hoja de detalle.
  - La planilla simple sigue teniendo los mismos encabezados en la primera fila. Otra empresa → 404.
  - `python3 -m pytest -q` todo verde (hoy 729 passed, 14 skipped); `ruff check` sin errores nuevos.

## 3. Pantalla (`frontend/src/pages/Export.tsx`, `lib/api.ts`)

- Cabecera con el nombre de la obra y el total (de los totales guardados, como la escalera del editor: precio sin IVA,
  con IVA, cantidad de trabajos).
- Aviso de trabajos en rojo con `GET /budgets/{id}/precios-faltantes` (y la misma regla que `lib/semaforo.ts`): cuántos
  y "Ver cuáles" → editor. Si la consulta falla, no se muestra aviso falso ni "todo bien".
- Cuatro opciones (en este orden), cada una con: para quién, qué lleva, el botón "Descargar" y el estado
  (descargando / "Descargado" / error con "Probar de nuevo"):
  1. **Para el cliente (PDF)** — destacada. "Precio de venta de cada trabajo y el total, con y sin IVA. Sin tus costos."
  2. **Planilla Terrac (Excel)** — "Tu planilla de siempre: hoja 01_C&P, una hoja por trabajo con sus materiales y mano
     de obra, y el Coeficiente de pase. Si la volvés a subir en Cargar obra, vuelve con los mismos trabajos, cantidades y
     porcentajes; los trabajos con fórmula se calculan con los precios de ese día."
  3. **Informe interno (PDF)** — "Con costos, indirectos, beneficio e impuestos. No se lo mandes al cliente."
  4. **Planilla simple (Excel)** — "Un renglón por trabajo con su rubro y su precio. Para filtrar u ordenar."
- `budgetApi.exportExcel(id, formato?)`; nombres de archivo "{obra} - {opción} - {AAAA-MM-DD}.{ext}".
- Sacar la nota de abajo, "UNIVERSAL", "BoQ", "Bill of Quantities", "26 col…". En celular (400 px), una columna.
- e2e nuevo `scripts/e2e_exportar.cjs` (con Ginkgo, como `e2e_un_solo_total.cjs`): la cabecera muestra el mismo precio
  sin IVA que el editor; las cuatro descargas bajan archivos distintos con los nombres nuevos; el PDF cliente dice ese
  total; la Planilla Terrac tiene la hoja 01_C&P y, subida otra vez por `/obras/analizar`, da la misma cantidad de
  trabajos; con un trabajo sin precio aparece el aviso y "Ver cuáles" lleva al editor; un error 500 queda visible;
  400 px sin scroll horizontal. Y los e2e de siempre siguen dando sus OK.
- `npm run build` pasa; tsc con sus 7 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
Palabras y tildes del resto (7), celular (8), "+ Nuevo Presupuesto" directo al editor y la guía de Ayuda del camino a
mano. Fórmulas vivas en la Planilla Terrac (hoy van valores, para que se pueda volver a subir).
