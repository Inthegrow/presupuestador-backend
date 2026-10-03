# Plan: cerrar la Etapa A de "Cargar una obra"

> Fecha: 2026-10-03. Contrato exacto entre servidor y pantalla para el PR que sigue al #24.
> Lo que no está acá, no se programa. Si algo no cierra, se cambia acá primero.
> Base: `HANDOFF_COTIZADOR_AGENTICO.md` (sección 5, Etapa A) y `DISENO_CARGAR_OBRA.md`.

## 0. Qué se hace y por qué

Tres cosas, en este orden, en **un solo PR**:

1. **Precios que el Excel ya trae.** Si falta un precio en el catálogo pero el Excel de la obra lo tiene
   (en la hoja de detalle del trabajo, donde Sol lo tipeó, o en las listas `00_Mat`/`00_MO`/`00_Eq`/`00_Sub`),
   la pantalla lo **propone**: "En tu Excel usaste $200.000 (hoja 5.2-6). ¿Lo guardo?". Un botón, listo.
   Y la **conversión de unidades que la app ya sabe** (0,1 m³ por m²) se muestra como **dato**, no como
   pregunta abierta.
2. **Catálogo oficial.** En producción conviven cuatro catálogos con los mismos códigos. Se marca uno (o
   más, uno por tipo) como **oficial**; los otros quedan **solo para consulta**: la app no usa sus precios
   para calcular, pero los muestra como referencia cuando falta un precio ("En Las Heras estaba a $X").
3. **"Ver diferencias con el Excel".** Al cargar se guarda, por ítem, lo que daba el Excel (`excel_neto`,
   `excel_directo`). Una pantalla nueva compara trabajo por trabajo lo que calcula la app contra lo que
   estimó Sol, ordenado por la diferencia mayor.

Principios que mandan (del handoff): la app propone y Sol confirma; palabras, no códigos; nunca un número
mentiroso en silencio; una decisión, una vez.

## 1. Migración `migrations/011_catalogo_oficial_excel_neto.sql`

Idempotente, solo agrega columnas. **Correrla en Supabase antes de desplegar** (como las anteriores).

```sql
ALTER TABLE price_catalogs ADD COLUMN IF NOT EXISTS oficial boolean NOT NULL DEFAULT false;
ALTER TABLE budget_items   ADD COLUMN IF NOT EXISTS excel_directo numeric;  -- columna N del 01_C&P (directo total)
ALTER TABLE budget_items   ADD COLUMN IF NOT EXISTS excel_neto    numeric;  -- columna Z del 01_C&P (total neto)
CREATE INDEX IF NOT EXISTS idx_price_catalogs_oficial ON price_catalogs(org_id, oficial);
```

Con comentario de verificación al final (como 009/010). `tests/test_migrations.py` suma una clase que
chequea: solo `ADD COLUMN IF NOT EXISTS`, nada de `DROP`/`DELETE`/`UPDATE`.

Los presupuestos cargados **antes** de esta migración no tienen `excel_neto`: la pantalla de diferencias lo
dice en una frase y pide cargar la obra de nuevo. No se inventa nada.

## 2. Servidor

### 2.1 Catálogo oficial (`app/budget_prices.py`, `app/routers/catalogs.py`, `app/routers/obras.py`)

**Regla.** Si la organización tiene **al menos un** catálogo con `oficial = true`:
- Para poner precio (analizar, cargar, "Actualizar precios", cascada) **solo cuentan las entradas de los
  catálogos oficiales**. Las demás son "de consulta" y no se usan ni aunque el código no esté en el oficial
  (en ese caso el problema es `no_esta`, con las referencias de consulta para copiarlo con un clic).
- Un recurso ya enlazado por `catalog_entry_id` a una entrada de consulta **no la sigue usando**: se busca por
  código en los oficiales (si no está, queda `sin_precio`/`no_esta` como cualquier otro).
- Si **ningún** catálogo es oficial, todo sigue como hoy (todas las entradas, desempate de `find_entry`).

**Implementación.** Una sola función que arma el índice de catálogos, usada por `PriceBook` (obras) y por
`load_price_lookup` (analysis), para que no haya dos reglas:

```python
def load_catalog_index(db, org_id: str) -> dict:
    """{"by_id", "by_codigo", "history", "consulta_by_codigo", "catalogos", "hay_oficial"}.

    Cada entrada lleva "catalogo" (nombre), "_catalogo_creado" y "oficial" (bool).
    Con hay_oficial, by_id y by_codigo tienen solo entradas oficiales; consulta_by_codigo tiene el resto.
    Sin oficial, consulta_by_codigo está vacío.
    """
```
`find_entry` no cambia.

**Endpoint nuevo.** `PATCH /catalogs/{catalog_id}` con body `{"oficial": true|false}` → devuelve la fila del
catálogo actualizada. 404 si no es de la org; 400 si `oficial` no es booleano. `GET /catalogs` ya devuelve
`oficial` (es `select *`).

### 2.2 Precios que el Excel ya trae (`app/obra_import.py`)

```python
def excel_prices(wb) -> dict[str, dict]:
    """Precios que trae el Excel de la obra, por código normalizado (normalize_codigo).

    Dos fuentes, en este orden de prioridad:
    1. "detalle": las hojas de detalle de cada trabajo (nombre tipo "5.2-6", "3.1-1", "4.2-4.2", "2.2";
       se excluyen las 00_* y 01_*). Fila 3: A = código del ítem, B = descripción del trabajo.
       Secciones por el texto de la columna A (startswith, en mayúsculas):
         MATERIALES → material · MANO DE OBRA - PERSONAS → mano_obra · MANO DE OBRA - EQUIPOS → equipo
         MANO DE OBRA - MATERIALES → material · SUBCONTRATOS → subcontrato
       Debajo de cada sección, la fila con A == "Código" es el encabezado: de ahí salen las columnas
       Descripción, Unidad y "Precio Unitario" (contiene PRECIO). Las filas siguientes cuentan si tienen
       código y precio > 0, hasta una fila cuya A empiece con "TOTAL" o una sección nueva.
    2. "lista": las hojas 00_Mat/00_MO/00_Eq/00_Sub, leídas con app.maestro_import.parse_workbook
       (mismo formato que el Maestro): codigo, descripcion, unidad, precio_sin_iva, fecha_precio, proveedor.
       Solo filas con precio > 0. Si una fila solo tiene "precio con IVA" (en el Excel de Ginkgo la sección
       de pintura está rotulada así aunque la hoja diga "sin IVA"), se propone igual con la aclaración en
       "nota"; en los demás casos "nota" es null.

    Gana el primer "detalle" encontrado (en el orden de las hojas); si no hay, la "lista".
    Los otros precios distintos del mismo código quedan en "otros".
    """
```

Cada valor:
```json
{"codigo": "RE-PLI20", "descripcion": "Albalatex Extra Mate 20 l (u)", "unidad": "u", "tipo": "material",
 "precio": 200000.0, "fecha": "2026-09-17" | null, "proveedor": "ML" | null,
 "nota": "En la lista del Excel figura como precio con IVA: fijate si va sin IVA." | null,
 "origen": "detalle" | "lista", "hoja": "5.2-6",
 "trabajo": "EJECUCION DE PINTURA EN PAREDES. INCLUYE ENDUIDO..." | null,
 "otros": [{"precio": 140000.0, "hoja": "5.1-3"}]}
```
No falla nunca por una hoja rara: la hoja que no se entiende se saltea. Celdas con `#REF!` o texto en el
precio se ignoran.

### 2.3 `POST /obras/analizar` y `POST /obras/cargar`: cambios de contrato

Todo lo que ya existe se mantiene igual. Se **agrega**:

**Arriba de todo:**
- `catalogo_oficial: boolean` — la org tiene al menos un catálogo oficial.

**En cada `precios[i]`** (los códigos sin precio / repetidos / que no están):
- `motivo`: con catálogo oficial, `no_esta` dice **"No está en el catálogo oficial"**; sin oficial sigue "No está en el catálogo".
- `entradas`: con catálogo oficial, **solo las entradas oficiales** del código (es donde se guarda/borra).
- `referencias: [...]` — entradas **de consulta** del mismo código con precio > 0, más nueva primero (fecha
  vacía al final), máximo 5. Sin catálogo oficial: `[]`.
  `{"id", "catalog_id", "catalogo", "codigo", "descripcion", "unidad", "tipo", "precio_sin_iva", "fecha_precio"}`.
- `propuesta: {...} | null` — el valor de `excel_prices(wb)` para ese código (ver 2.2). `null` para `duplicado`.
- `catalogo_destino: {"id", "name"} | null` — dónde conviene **crear** el código si no está: el catálogo
  oficial que más entradas tiene de ese `tipo` (si hay empate, el más nuevo). Sin oficial: `null`.

**En cada `tareas[i].pregunta`** (cuando no es `null`):
- `dato: string | null` — si `valor` no es `null`, la frase para mostrarla como dato resuelto, con número
  en formato argentino: `'Cada m² lleva 0,1 m³ de "Contrapiso de cascote"'`. Si `valor` es `null`, `dato` es `null`
  y la pregunta se muestra como hoy.

**`POST /obras/cargar`**: cada `budget_items` de nivel ítem se guarda con `excel_directo` (columna N) y
`excel_neto` (columna Z) del Excel; rubros y pisos con `null`. El resto igual.

### 2.4 `GET /obras/{budget_id}/diferencias`

Compara el presupuesto cargado contra lo que decía el Excel. No escribe nada.

- 404 si el presupuesto no es de la org.
- 409 con `detail` = `"Este presupuesto no tiene guardados los totales del Excel. Cargá la obra de nuevo desde
  \"Cargar obra\" para poder compararla."` si ningún ítem tiene `excel_neto`.

Respuesta:
```json
{
  "budget_id": "…", "nombre": "EDIFICIO GINKGO", "precios_al": "2026-10-03", "source_file": "….xlsx",
  "total": {"app_neto": 0, "excel_neto": 0, "diferencia": 0, "diferencia_pct": 0.0 | null,
            "app_directo": 0, "excel_directo": 0},
  "resumen": {"trabajos": 85, "mas_caros": 30, "mas_baratos": 40, "parecidos": 15, "sin_receta": 31},
  "trabajos": [
    {"clave": "MURO … | m2", "descripcion": "MURO DE MAMPOSTERIA…", "unidad": "m²", "veces": 8,
     "cantidad_total": 1928.0,
     "receta": {"codigo": "5.1.4", "nombre": "Ladrillo cerámico hueco del 18"} | null, "sin_receta": false,
     "app_neto": 0, "excel_neto": 0, "diferencia": 0, "diferencia_pct": 12.3 | null,
     "app_directo": 0, "excel_directo": 0,
     "app_unitario": 0 | null, "excel_unitario": 0 | null,
     "items": [{"id": "…", "code": "4.2.1", "piso": "PRIMER PISO", "cantidad": 240.0,
                "app_neto": 0, "excel_neto": 0, "diferencia": 0}]}
  ]
}
```
Reglas:
- Un **trabajo** = misma clave que en analizar: `task_key(description, unidad)`. `items` ordenados por `sort_order`.
- `diferencia = app − excel` (positivo = la app da **más caro**). `diferencia_pct = diferencia / excel × 100`,
  redondeado a 1 decimal; `null` si `excel` es 0.
- `app_unitario = app_neto / cantidad_total`, `excel_unitario = excel_neto / cantidad_total`; `null` si la cantidad es 0.
- `receta`: por `template_id` del primer ítem del grupo → `item_templates` (codigo, nombre). `sin_receta = receta is None`.
- `piso`: `description` del padre directo del ítem (`parent_id`), o `null`.
- `trabajos` ordenado por `abs(diferencia)` descendente.
- `resumen`: `parecidos` = `|diferencia_pct| <= 5` (o `excel` y `app` ambos 0); `mas_caros` = pct > 5; `mas_baratos` = pct < −5; `sin_receta` = cuenta de trabajos sin receta. Los trabajos con `excel_neto = 0` y `app_neto > 0` cuentan como `mas_caros`.
- Solo cuentan los ítems hoja (`notas != "Seccion"`); los que tienen `excel_neto` en `null` se ignoran.

### 2.5 Tests (todos en verde antes de subir: `python3 -m pytest -q`)

- `tests/test_obra_import.py`: `excel_prices` con un workbook sintético: una hoja de detalle con dos
  secciones, una lista `00_Mat`, un código en los dos (gana el detalle, la lista va a `otros`), un código solo
  en la lista, una fila con precio 0 (se ignora), una hoja con nombre raro (se saltea), sin hojas 00_* (no falla).
- `tests/test_obras_api.py`: `propuesta` presente para `sin_precio` y `no_esta`; `referencias` vacías sin
  oficial y llenas con oficial; con oficial, un código que solo está en consulta sale `no_esta` con
  `catalogo_destino`; un recurso con `catalog_entry_id` a una entrada de consulta se repone por código;
  `pregunta.dato` con la regla (0,08) y `null` cuando falta el valor; `excel_neto`/`excel_directo` guardados
  al cargar; `GET /obras/{id}/diferencias`: orden por diferencia, `piso`, `receta`, `sin_receta`, totales,
  409 sin excel_neto, 404 de otra org.
- `tests/test_catalog_prices.py` o `test_api.py`: `PATCH /catalogs/{id}` (ok, 404, 400).
- `tests/test_budget_prices.py`: `load_catalog_index` con y sin oficial; "Actualizar precios" (`/actualizar-precios`)
  ignora el catálogo de consulta cuando hay oficial.
- `tests/test_migrations.py`: clase para 011.
- `ruff check` sobre los archivos tocados.

## 3. Pantalla

### 3.1 `frontend/src/lib/api.ts` y `types.ts`
- `PriceCatalog.oficial: boolean`.
- `ObraPrecio` suma `referencias`, `propuesta`, `catalogo_destino`. `ObraPregunta.dato: string | null`.
  `ObraAnalisis.catalogo_oficial: boolean`.
- `catalogApi.setOficial(id, oficial)` → `PATCH /catalogs/{id}`.
- `obraApi.diferencias(budgetId)` → `GET /obras/{budgetId}/diferencias`, tipo `ObraDiferencias` (2.4).

### 3.2 `CargarObra.tsx`
**Panel "Precios para corregir" (PrecioRow):**
- Si hay `propuesta`: arriba del campo, en una línea: **"En tu Excel usaste $200.000"** + gris: "(hoja 5.2-6,
  Pintura en paredes)" si `origen = detalle`, o "(lista de precios del Excel, 17/09/2026)" si `origen = lista`.
  Si `nota` no es null, se muestra debajo en ámbar. Si `otros` no está vacío: "También figura a $140.000 en 5.1-3." El campo de precio arranca **cargado con la
  propuesta**. Botón principal: **"Guardar ese precio"** (para `sin_precio`: `updateEntry` con
  `precio_sin_iva` y `fecha_precio = propuesta.fecha ?? hoy`; para `no_esta`: `createEntry` en el catálogo
  elegido con `codigo`, `descripcion` (la de la propuesta si la del recurso está vacía), `unidad`, `tipo`,
  `precio_sin_iva`, `fecha_precio`). Si Sol cambia el número, el botón dice "Guardar".
- Si no hay propuesta pero hay `referencias`: "En Las Heras estaba a $6.592 (12/03/2026)" por cada una (máx. 3)
  con botón chico **"Usar este"** → crea la entrada en el catálogo destino con ese precio y esa fecha.
- Selector de catálogo (solo para `no_esta`): por defecto `catalogo_destino`; si hay catálogo oficial, solo se
  listan los oficiales.
- Arriba del panel, si hay 2 o más propuestas: botón **"Guardar los N precios que trae el Excel"**: guarda una
  por una (en serie), muestra "Guardando 3 de 14…", y al final llama a `revisar()`. Si una falla, sigue con
  las demás y al final dice cuáles no se pudieron guardar.
- Texto del panel: con `catalogo_oficial`, "Lo que corrijas acá queda guardado en el catálogo **oficial** …".

**Tarjeta del trabajo (TareaCard):**
- Si `pregunta.dato` no es `null`: en lugar de la pregunta, una línea gris: `{dato}` + enlace **"cambiar"**.
  Al tocar "cambiar" aparece el campo numérico con el valor actual (mismo comportamiento que hoy). La
  tarjeta no cambia de color por esto.
- Si `pregunta.dato` es `null`: como hoy (pregunta + campo, en rojo).

**Resultado de la carga:** botón **"Ver diferencias con el Excel"** → `/app/budgets/{budget_id}/diferencias`,
al lado de "Abrir el presupuesto".

### 3.3 `Catalogs.tsx`
- Chip por catálogo: **"Oficial"** (verde) o **"Solo consulta"** (gris) en lugar del "Activo" de hoy. Botón al
  lado: "Marcar como oficial" / "Dejar solo para consulta" → `setOficial`. Sin confirmación (es reversible).
- Si ningún catálogo es oficial: aviso arriba, amarillo suave: "Ningún catálogo es oficial: la app toma el
  precio más nuevo entre todos. Marcá como oficial el que mantenés; los otros quedan para consultar."
- Si hay oficiales: aviso verde: "La app calcula con los catálogos oficiales. Los demás son solo para consultar."

### 3.4 Página nueva `DiferenciasExcel.tsx` (ruta `budgets/:id/diferencias`)
- Cabecera: nombre de la obra, "Precios al dd/mm/aaaa", botón "Abrir el presupuesto".
- Tres tarjetas: **Excel de Sol** (`excel_neto`), **La app** (`app_neto`), **Diferencia** (`$` y `%`, rojo si la
  app da más caro, verde si más barato, gris si |%| ≤ 5). Si |%| > 20: aviso "El total da X% distinto a tu
  Excel. Mirá las diferencias antes de usarlo."
- Filtros: **Todos · Más caros · Más baratos · Parecidos · Sin receta** (con cantidades).
- Tabla ordenada como viene (diferencia mayor primero): Trabajo (descripción + "8 veces · 1.928 m²") ·
  Receta (nombre; "Precio del Excel" en gris si `sin_receta`) · Excel · App · Diferencia ($ y %, con color).
  Fila clickeable que despliega los ítems por piso (`items`: piso, código chico y gris, cantidad, Excel, App, diferencia).
- Error 409: tarjeta con el `detail` del servidor y botón "Ir a Cargar obra".
- Enlace desde el `Editor.tsx`: botón **"Diferencias con el Excel"** junto a "Exportar".

### 3.5 Comprobación
`cd frontend && npm run build` sin errores de tipos. Sin `any` nuevos.

## 4. Prueba de punta a punta (la hace el orquestador)
Servidor falso en memoria con las recetas del Maestro y cuatro catálogos (Maestro oficial + tres viejos),
`vite --port 5179`, Playwright con el Excel real de Ginkgo. Capturas de: panel de precios con propuestas,
"Guardar los N precios", conversión como dato, catálogos con el chip, diferencias con el Excel.

## 5. Después del merge
Correr `migrations/011` en Supabase **antes** de "Manual Deploy → Deploy latest commit" en Render. Después, en
la app: Catálogos → marcar el Maestro como oficial (los cuatro, uno por tipo). Recargar Ginkgo.
