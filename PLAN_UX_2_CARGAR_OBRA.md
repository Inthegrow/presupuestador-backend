# Plan: segunda tanda de fallas de UX de "Cargar obra" (paso 4b del plan maestro)

> Fecha: 2026-10-04. Contrato para un solo PR. Origen: `HANDOFF_COTIZADOR_AGENTICO.md`, sección 5, punto 0c,
> fallas (8) a (14): lo que vio Carlos haciendo de Sol el 04/10 en producción, con Ginkgo. Regla: lo que Sol
> dude es un bug. La (12) "Empresa demo" no se toca: se resuelve sola al encender la clave (paso 5).

## 1. Qué cambia, para Sol

| # | Hoy | Después |
|---|---|---|
| 8 | Recargar la página (Cmd+Shift+R) después de subir el Excel pierde todo: el archivo, las recetas elegidas, los precios cargados a mano, el nombre. | La carga en curso queda guardada **en el navegador** (IndexedDB) mientras Sol trabaja. Al volver a "Cargar obra" aparece: "Tenías una carga a medias: *EDIFICIO GINKGO_Computo y Presupuesto_V2.xlsx*, hace 12 minutos. **Seguir** / **Descartar**". Seguir vuelve a revisar el Excel con todo lo decidido. Cuando el presupuesto se carga, el borrador se borra. |
| 9 | Catálogos tarda 40 s con "Cargando catálogos…" mudo: es Render despertando (plan free). | Si cualquier pedido al servidor tarda más de 4 s, una franja arriba dice "El servidor está despertando: la primera vez puede tardar hasta un minuto…". Desaparece sola cuando responde. |
| 10 | "Cambiar" abre un buscador de recetas sin explicar qué es. | Arriba del buscador: "Elegí la receta correcta para este trabajo. Si ninguna sirve, usá el precio del Excel." La opción verde dice "Usar el precio del Excel (sin receta)" y abajo, chico: "Se carga con lo que cobró tu Excel; la app no desglosa materiales." |
| 11 | "Cargar presupuesto" tarda un buen rato y el botón solo dice "Cargando…". | El botón dice "Calculando 244 trabajos… 12 s" (contador) y debajo: "Puede tardar un minuto: la app arma los materiales de cada trabajo y recalcula la obra." El servidor mide los tiempos y los devuelve. |
| 13 | Al cargar con amarillos sin confirmar, el resultado no dice qué pasó con ellos. Carlos creyó que "se eliminaron solos". | El resultado dice: "37 trabajos entraron sin confirmar: 30 con la receta propuesta y 7 con el precio del Excel. Podés revisarlos en el presupuesto: en las notas dicen *Para confirmar*." |
| 14 | "Ver diferencias" compara precio final contra precio final. Sol aplica márgenes distintos por trabajo (12% a 51%); la app aplica una sola cadena (59%). Los trabajos "Precio del Excel" dan +23% y +42% aunque el costo es el mismo. | Un conmutador arriba: **Costo directo (sin margen)** / **Precio final**. Arranca en costo directo: ahí se ven las recetas. Una tarjeta nueva "Margen": "Tu Excel: 32% promedio · La app: 59%. Si querés que coincidan, ajustá la cadena de markups del presupuesto." Las filas y el detalle por piso siguen al conmutador. |

## 2. Servidor (`app/routers/obras.py`, tests en `tests/test_obras_api.py`)

### 2.1 `POST /obras/cargar`: qué pasó con los amarillos (falla 13) y cuánto tardó (falla 11)

La respuesta suma dos campos:

```json
"sin_confirmar": {
  "total": 37,
  "con_receta": 30,
  "sin_receta": 7,
  "claves": ["membrana liquida|m2", "..."]
},
"tiempos": {"analisis_s": 3.1, "items_s": 4.0, "recursos_s": 9.5, "cascada_s": 6.2, "total_s": 22.8}
```

- `sin_confirmar` sale de `result["tareas"]` con `estado == "amarillo"` (los rojos no llegan acá, salvo rojos
  por precio con `permitir_sin_precio`, que no cuentan como "sin confirmar"). `con_receta` = tiene `receta`;
  `sin_receta` = `receta is None`. `claves` ordenadas por `total_excel` descendente.
- En `budget_items.notas` de esos ítems (todos los ítems de la tarea amarilla) se agrega al final
  `"Para confirmar."`, para poder encontrarlos en el editor con el buscador. `item_notes(item)` recibe el
  dato por el ítem del plan: `_item_row` lo sabe porque `plan["items"]` tiene la clave de la tarea (si no la
  tiene, agregarla en `analyze` al armar el plan: `"clave"` por ítem). Los verdes y rojos no cambian.
- `tiempos` con `time.perf_counter()` alrededor de: análisis (parse + analyze), insert de ítems, insert de
  recursos, cascada. Un decimal. Además `logger.info("Carga de obra %s: %s", budget_id, tiempos)`.
- La memoria de recetas sigue guardando solo lo confirmado (sin cambios).

### 2.2 `GET /obras/{budget_id}/diferencias`: costo directo y margen (falla 14)

Cada **ítem** del detalle (`trabajos[].items[]`) suma `app_directo`, `excel_directo`, `diferencia_directo`.
Cada **trabajo** suma:

```json
"diferencia_directo": 1234.5,
"diferencia_directo_pct": 12.3,
"margen_app_pct": 59.0,
"margen_excel_pct": 31.5,
"app_unitario_directo": 51234.0,
"excel_unitario_directo": 48000.0
```

- `margen_*_pct` = `neto / directo − 1` en %, un decimal; `null` si el directo es 0.
- `_diff` ya existe: usarlo para el directo igual que para el neto (`diferencia_directo_pct` es `null` si el
  Excel directo es 0).

`total` suma `diferencia_directo`, `diferencia_directo_pct`, `margen_app_pct`, `margen_excel_pct` (sobre las
sumas, no promedio de porcentajes). `resumen` suma un bloque por modo:

```json
"resumen": {
  "trabajos": 85, "sin_receta": 30,
  "mas_caros": 67, "mas_baratos": 10, "parecidos": 8,
  "directo": {"mas_caros": 40, "mas_baratos": 20, "parecidos": 25}
}
```

`_how_different` recibe el modo (neto o directo) y aplica la misma regla de 5 % (`PARECIDO_PCT`). El orden
de `trabajos` sigue siendo por `|diferencia|` del neto (la pantalla reordena si hace falta). Lo que ya
existe no cambia de nombre ni de forma.

### 2.3 Tests

- `tests/test_obras_api.py`: `sin_confirmar` con un Excel que tiene un amarillo con receta propuesta
  (aviso con pregunta sin confirmar) y uno sin receta; los ítems amarillos tienen "Para confirmar." en
  `notas` y los verdes no; `tiempos` tiene las cinco claves numéricas. Diferencias: los campos nuevos por
  ítem, por trabajo y en total; `margen_*_pct` null con directo 0; `resumen.directo` cuenta con la regla
  del 5 %.
- `python3 -m pytest -q` todo verde (hoy 547 passed, 14 skipped). `ruff check` solo en los archivos tocados
  (hay 19 errores viejos en `app/routers/` que no son de este PR).

## 3. Pantalla (`frontend/src/`)

### 3.1 Tipos (`lib/api.ts`)

```ts
export interface ObraCarga {
  // ...lo que ya está
  sin_confirmar?: { total: number; con_receta: number; sin_receta: number; claves: string[] }
  tiempos?: { analisis_s: number; items_s: number; recursos_s: number; cascada_s: number; total_s: number }
}
export interface ObraDiferenciaItem { /* + */ app_directo: number; excel_directo: number; diferencia_directo: number }
export interface ObraDiferenciaTrabajo {
  /* + */ diferencia_directo: number; diferencia_directo_pct: number | null
  margen_app_pct: number | null; margen_excel_pct: number | null
  app_unitario_directo: number | null; excel_unitario_directo: number | null
}
// ObraDiferencias.total: + diferencia_directo, diferencia_directo_pct, margen_app_pct, margen_excel_pct
// ObraDiferencias.resumen: + directo: { mas_caros; mas_baratos; parecidos }
```

### 3.2 Borrador de carga (falla 8): `lib/borrador.ts` + `pages/CargarObra.tsx`

- Sin dependencias nuevas. `lib/borrador.ts` envuelve IndexedDB (base `presupuestador`, store `borradores`,
  clave `cargar-obra`): `guardarBorrador(b)`, `leerBorrador()`, `borrarBorrador()`. Todo en `try/catch`:
  si el navegador no deja (modo privado), la pantalla funciona igual que hoy.
- Qué se guarda: `{ archivo: Blob, nombreArchivo: string, nombre: string, asignaciones, pendientes,
  permitir: boolean, guardadoEn: string (ISO) }`. Las respuestas a preguntas y los precios ya viven en
  `asignaciones` / en el catálogo, así que con eso alcanza.
- Cuándo: después de que `analizar` responde, y en cada cambio de `asignaciones`, `pendientes`, `nombre` o
  `permitir` (debounce 500 ms). Se borra cuando `cargar` responde bien y cuando Sol toca "Quitar" o
  "Descartar".
- Al entrar a la pantalla sin archivo: si hay borrador, arriba del cuadro "1. SUBÍ EL EXCEL" una tarjeta
  ámbar: **"Tenías una carga a medias"** · nombre del archivo · "hace N minutos" (o "ayer", o la fecha) ·
  botones **Seguir** (primario) y **Descartar**. Seguir rearma `File` desde el Blob, repone
  `asignaciones`/`pendientes`/`nombre`/`permitir` y llama a `analizar` como si lo acabara de arrastrar.

### 3.3 Servidor despertando (falla 9): `lib/api.ts` + `components/layout/AppLayout.tsx`

- En `request`, `postFile` y `getBlob`: un `setTimeout` de 4 s que, si el pedido no terminó, hace
  `window.dispatchEvent(new CustomEvent('api:lento'))`; al terminar (bien o mal) `api:respondio`. Contador
  de pedidos lentos en curso para que la franja no parpadee.
- Componente `ServidorDespertando` (en `components/layout/`, montado en `AppLayout` arriba del contenido):
  franja ámbar fija arriba: "El servidor está despertando: la primera vez puede tardar hasta un minuto…".
  Se muestra con `api:lento`, se oculta cuando el contador vuelve a 0. Sin dependencias nuevas.

### 3.4 El buscador explica qué es (falla 10): `RecetaBuscador` en `pages/CargarObra.tsx`

Debajo del cuadro de búsqueda, una línea gris: "Elegí la receta correcta para este trabajo. Si ninguna
sirve, usá el precio del Excel." La opción verde queda en dos líneas: "Usar el precio del Excel (sin
receta)" y abajo en 11px "Se carga con lo que cobró tu Excel; la app no desglosa materiales."

### 3.5 Progreso al cargar (falla 11): `pages/CargarObra.tsx`

Mientras `cargando`: el botón dice `Calculando {analisis.resumen.trabajos} trabajos… {s} s` con un contador
de segundos (`setInterval`), y debajo del botón: "Puede tardar un minuto: la app arma los materiales de cada
trabajo y recalcula la obra." Al terminar, si viene `tiempos`, `console.info` (no se muestra).

### 3.6 El resultado dice qué pasó con los amarillos (falla 13): `pages/CargarObra.tsx`

Debajo de los totales, si `carga.sin_confirmar?.total > 0`, una línea ámbar:
"{total} trabajos entraron sin confirmar: {con_receta} con la receta propuesta y {sin_receta} con el precio
del Excel. Podés revisarlos en el presupuesto: en las notas dicen *Para confirmar*." Singular/plural
correctos ("1 trabajo entró sin confirmar…"). Si es 0, nada.

### 3.7 Diferencias: costo directo y margen (falla 14): `pages/DiferenciasExcel.tsx`

- Conmutador arriba de las tarjetas, dos botones tipo pestaña: **Costo directo (sin margen)** / **Precio
  final**. Arranca en costo directo. Abajo del conmutador, una línea: en costo directo "Acá se ven las
  recetas: lo que cuesta hacer cada trabajo, sin margen."; en precio final "Lo que cobra cada uno, con su
  margen."
- Las tres tarjetas (Excel de Sol / La app / Diferencia) muestran el modo elegido. Una cuarta tarjeta
  **Margen**: "Tu Excel: {margen_excel_pct}% promedio · La app: {margen_app_pct}%" y debajo, chico: "Si
  querés que coincidan, ajustá la cadena de markups del presupuesto." La frase ámbar del total ("El total
  da X% más caro…") usa el modo elegido.
- Los filtros (Más caros / Más baratos / Parecidos) usan `resumen.directo` en modo directo y la
  clasificación por `diferencia_directo_pct` con la misma regla del 5 %. Las filas muestran Excel / App /
  Diferencia del modo; el "Por m²" de la fila abierta y el detalle por piso también. En modo directo las
  filas se ordenan por `|diferencia_directo|`.
- Rótulos de columnas: en modo directo "EXCEL (COSTO)" y "APP (COSTO)"; en precio final como hoy.

### 3.8 Prueba de punta a punta (`scripts/e2e_ginkgo.cjs`)

Sumar al guion que ya existe: (a) después de subir Ginkgo y guardar los precios del Excel, `page.reload()`;
debe aparecer "Tenías una carga a medias" y al tocar **Seguir** el resumen vuelve con la misma cantidad de
rojos; (b) "Cambiar" muestra "Elegí la receta correcta para este trabajo"; (c) el resultado muestra
"entraron sin confirmar" cuando se carga con amarillos; (d) en diferencias, el conmutador arranca en costo
directo, la tarjeta Margen muestra los dos porcentajes y "Precio final" cambia los números. `cd frontend &&
npm run build` tiene que pasar (tsc tiene 13 errores viejos heredados que no son de este PR).

## 4. Fuera de este PR (anotado)

- Excel sin precios: si el 01_C&P no trae costos, los trabajos sin receta tienen que salir en rojo ("falta
  receta o precio"), no amarillos en $0; el panel de precios del Excel no aparece y "Ver diferencias" no se
  ofrece. PR siguiente, chico (handoff 0c, punto 15).
- Borrador en el servidor (tabla `obra_cargas`) para seguir desde otra máquina: después de la primera carga
  real con Sol, si hace falta.
- Filtro "Para confirmar" en el editor: hoy alcanza con el buscador de notas.
