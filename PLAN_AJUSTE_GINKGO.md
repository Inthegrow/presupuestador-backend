# Plan: Ginkgo con respuestas supuestas, correcciones con un botón y buscador de precios (entrega 8)

> Fecha: 2026-10-07. Contrato para un solo PR. **Render: Manual Deploy SÍ** y **migración 012 antes del deploy**
> (SQL Editor de Supabase DATA, como la 011). El celular pasa a ser la entrega 9.
> Origen: Carlos no puede mandarles el cuestionario a Sol y Emilia y pidió completarlo ahora: que Claude suponga las
> respuestas, que todo quede anotado (quién lo supuso, por qué, de dónde sale cada número) y un buscador de precios en
> internet dentro de la app que proponga opciones y deje marcado de dónde salió cada precio.
> Material: auditoría de Ginkgo (grupos A, B y C), detalle del grupo A (`correcciones.md`), cuestionario
> (https://claude.ai/artifact/J4zeJLpv4votpnE79xTGzC).

## 1. Qué cambia, para Sol

### A. Correcciones de la revisión de Ginkgo, para aplicar con un botón

Las fórmulas se corrigen **desde la app** (no por SQL). En **Fórmulas**, arriba, un aviso:
"Revisión de Ginkgo: 15 correcciones para aplicar · Ver". Lleva a **Fórmulas → Correcciones** (`/formulas/correcciones`).

Cada corrección es una tarjeta:
- **Título** ("Membrana: la colocación cuenta 1 rollo cada 10 m²") y **por qué** (1 o 2 oraciones).
- **Respuesta supuesta**, siempre a la vista y en un color propio: "Supuesto por Claude el 7/10/2026 · a confirmar por
  Emilia: **Sí**. Razón: …". Nunca se presenta como confirmado.
- **De dónde sale**: las fuentes ("Excel de Sol, Ginkgo, hoja 4.9-3, fila 69", "Maestro, solapa 8.4, D69", un link si
  es de internet).
- **Efecto en Ginkgo** en costo directo ("−$19,7 millones"), si se conoce.
- **Ver los cambios**: renglón por renglón, antes → después (fórmula, cantidad, código, precio), con el nombre de la
  fórmula y del recurso en palabras.
- **Estado** y botón:
  - "Para aplicar" → **Aplicar**.
  - "Aplicada el 7/10 por Carlos" → **Deshacer**.
  - "No coincide: la fórmula cambió desde la revisión" → no se puede aplicar; dice qué renglón y qué valor encontró.
    (Así no se pisa una corrección hecha a mano.)
  - Precios: si la lista ya tiene un precio **más nuevo** que el propuesto, ese cambio se saltea y lo dice ("La lista ya
    tiene un precio del 3/10: no se toca").
- Arriba de la lista: "Aplicar todas las que se pueden (12)" con confirmación en la misma pantalla (no `confirm()`), y
  un resumen: aplicadas / para aplicar / no coinciden.
- Después de aplicar: "Los presupuestos ya cargados no cambian solos. Para ver el efecto en Ginkgo, volvé a cargar la
  obra en Cargar obra." (link).

En el editor de una fórmula, el renglón corregido muestra una línea chica: "Corregido por la revisión de Ginkgo (A1),
supuesto por Claude el 7/10/2026, a confirmar por Emilia".

### B. Cada precio dice de dónde salió

En **Precios**, cada precio muestra su origen en una línea chica debajo (o en una columna "De dónde salió"):
- "Excel de Sol, Ginkgo, hoja 00_Sub · EVER · 18/09/2026"
- "Internet: Easy · Cemento Loma Negra 50 kg · consultado el 7/10/2026 · Ver" (link al sitio)
- "Cargado a mano el 7/10/2026" / "Importado de la lista …" (lo que ya se sabe hoy, sin inventar)
El historial de un precio también muestra el origen de cada valor.

### C. Buscador de precios en internet

- En **Precios**: en cada renglón, "Buscar en internet" (ícono de lupa con globo); y arriba, "Buscar un precio" para uno
  que todavía no está en la lista.
- En el **detalle de un trabajo**, en cada recurso **sin precio** (rojo): "Buscar en internet".
- Se abre un panel con la búsqueda armada (descripción + unidad, editable) y "Buscar". Mientras busca: "Buscando en
  corralones y ferreterías… (puede tardar hasta un minuto)".
- Resultados: de 2 a 6 opciones, cada una con comercio, producto, presentación, precio publicado (con o sin IVA, lo
  dice), **precio por la unidad de la app, sin IVA** con la cuenta a la vista ("$12.990 la bolsa de 50 kg con IVA →
  $10.736 sin IVA"), fecha y **Ver en el sitio** (link). Si la presentación no coincide con la unidad de la app, lo marca
  y deja corregir el número antes de guardar.
- Abajo: "Precios de venta al público: un corralón por volumen suele ser más barato."
- **Usar este precio** → guarda el precio en la lista (el renglón existente, o uno nuevo en la lista oficial que
  corresponda), con proveedor = comercio, fecha = hoy, origen "Internet: comercio · producto" y el link. Queda en el
  historial.
- Si no encuentra nada o falla: lo dice y deja reintentar. Nunca muestra un precio sin link.
- Si el servidor no tiene configurada la búsqueda: "El buscador de precios no está configurado" (no se rompe nada más).

## 2. Servidor

### Migración `migrations/012_correcciones_y_fuentes.sql` (idempotente, no borra datos)
- `catalog_entries`: `fuente text`, `fuente_url text`.
- `catalog_price_history`: `fuente text`, `fuente_url text`.
- Tabla `correcciones_aplicadas` (RLS activado, sin políticas, como `catalog_price_history`): `id`, `org_id`, `lote`,
  `correccion_id`, `estado` ('aplicada' | 'deshecha'), `aplicada_por` (email o id), `aplicada_at`, `deshecha_at`,
  `antes jsonb` (copia de lo que había: recursos de cada fórmula tocada, entradas de precio tocadas, fórmulas creadas),
  `despues jsonb` (lo que se escribió). Índice por `(org_id, lote, correccion_id)`.
- Al final, el SELECT de verificación comentado.
- El código **tolera** que la migración no esté corrida: lista y buscador funcionan; aplicar responde 409
  "Falta la migración 012" en vez de un 500.

### Correcciones (`app/correcciones.py` + `app/routers/correcciones.py`, prefijo `/correcciones`)
- Datos: `app/data/correcciones_ginkgo.json` (lo arma Claude con la auditoría; formato abajo). Se valida al cargar.
- `GET /correcciones` → `{lote, titulo, fecha, correcciones: [{id, titulo, por_que, supuesto, fuentes, efecto_ginkgo,
  cambios: [{…, nombre_plantilla, nombre_recurso, estado_cambio}], estado, aplicada: {por, fecha} | null, detalle}]}`.
  `estado` ∈ `para_aplicar` | `aplicada` | `no_coincide` | `en_parte` (algún precio salteado). Calculado contra la base
  de la empresa (`org_id`).
- `POST /correcciones/{id}/aplicar` (`require_editor`):
  1. Lee todo lo que toca, verifica cada `antes` (renglón por código dentro de la fórmula por `codigo`; plantilla nueva
     que no exista; precio). Si un renglón o fórmula no coincide → 409 con el detalle, sin escribir nada.
  2. Arma los recursos nuevos de cada fórmula; valida con la misma validación que el editor (`_check_template`).
  3. Escribe (fórmulas con `editado = true`; precios con `fuente`, `fuente_url`, `proveedor`, `fecha_precio` e
     historial), y guarda el registro en `correcciones_aplicadas` con `antes`/`despues`.
  4. Si una escritura falla: restaura lo que ya escribió y responde 500 `NO_SE_APLICO`; si además falla la
     restauración, 500 `A_MEDIAS` ("Volvé a aplicarla o deshacela"), como en indirectos.
  - Cada renglón tocado o agregado lleva `"correccion": {"lote", "id", "texto": "Corregido por la revisión de Ginkgo
    (A1), supuesto por Claude el 7/10/2026, a confirmar por Emilia"}`. Si el validador no acepta claves extra, se
    ajusta para aceptar esta.
  - Precios: se busca el código en los catálogos **oficiales** de la empresa; si existe, se actualiza (salvo que tenga
    `fecha_precio` posterior a la propuesta: se saltea y se informa); si no existe, se crea en el catálogo oficial que
    corresponda al tipo (el que tenga "Subcontrat" en el nombre para subcontratos, "Mano" para mano de obra, si no el
    primero oficial). Sin catálogo oficial → 409 con el mensaje.
- `POST /correcciones/{id}/deshacer` (`require_editor`): restaura `antes` solo si lo actual sigue igual a `despues`
  (si alguien lo editó después → 409 diciendo qué cambió); borra las fórmulas que la corrección creó (si ningún
  presupuesto las usa; si las usan, 409). Marca el registro `deshecha`.
- Formato de `correcciones_ginkgo.json`:
  ```json
  {"lote": "ginkgo-2026-10", "titulo": "Revisión de Ginkgo", "fecha": "2026-10-07",
   "correcciones": [{"id": "A1", "titulo": "…", "por_que": "…",
     "supuesto": {"respuesta": "Sí", "por": "Claude", "fecha": "2026-10-07", "confirma": "Emilia", "razon": "…"},
     "fuentes": ["…"], "efecto_ginkgo": -19732275,
     "cambios": [
       {"tipo": "renglon", "plantilla": "8.4", "codigo": "C-MEM", "antes": {"formula": "Q"}, "despues": {"formula": "Q/10"}},
       {"tipo": "renglon_nuevo", "plantilla": "5.1.4", "renglon": {…recurso completo…}},
       {"tipo": "renglon_quitar", "plantilla": "4.2.4", "codigo": "HADN6", "antes": {…recurso completo…}},
       {"tipo": "plantilla_nueva", "plantilla": {"codigo": "5.5.6", "nombre": "…", "unidad": "m2", "categoria": "…",
         "parametros": [], "desperdicio_pct": null, "recursos": […]}},
       {"tipo": "precio", "codigo": "SUB-YES-CAJON", "tipo_recurso": "subcontrato", "descripcion": "…", "unidad": "m",
        "antes": null, "despues": {"precio_sin_iva": 25000, "proveedor": "EVER", "fecha_precio": "2026-09-18"},
        "fuente": "Excel de Sol, Ginkgo, hoja 00_Sub", "url": null}]}]}
  ```
- **Reglas (MAPEO, `app/obra_import.py`)**: las entradas que cambian con la revisión (yeso proyectado → 5.5.6,
  cielorraso suspendido → 6.1, cielorraso aplicado → 6.11, y las que salgan del grupo B) aceptan una **alternativa**:
  si la fórmula preferida no existe en la empresa (corrección todavía no aplicada), se usa la de hoy. Así el deploy no
  cambia nada hasta que se aplican las correcciones, y aplicarlas no exige otro deploy. Test de `match_recipe` para esos
  textos, con y sin la fórmula nueva.

### Precios con origen (`app/routers/catalogs.py`, `app/catalog_prices.py` o donde se graba)
- Crear/editar entrada acepta `fuente` y `fuente_url` (texto; URL solo `http(s)://`, hasta 500 caracteres). Se guardan
  y pasan al historial. Si las columnas no existen (sin migración) se ignoran sin error.
- Las entradas y el historial devuelven `fuente` y `fuente_url`.
- Origen por defecto cuando no viene: crear a mano → "Cargado a mano"; importar CSV/Excel → "Importado de {archivo}".
  Los precios viejos quedan sin origen (la pantalla muestra lo que haya: proveedor y fecha).

### Buscador (`app/price_search.py` + `POST /precios/buscar`, `require_editor`)
- Entrada: `{descripcion, unidad, tipo?, codigo?}`. Salida: `{consulta, opciones: [{comercio, producto, presentacion,
  precio, con_iva, moneda, unidad_publicada, precio_unidad_app_sin_iva, cuenta, fecha, url}], aviso?}`.
- OpenAI Responses API con la herramienta de búsqueda web (`openai` pasa de 1.57.0 a **1.109.1**, la última 1.x;
  revisar que `ai.py` y `architect.py` sigan andando). Modelo en `OPENAI_MODEL_PRECIOS` (por defecto `gpt-4.1`).
  Instrucciones: Argentina (CABA/AMBA), pesos, precios actuales, corralones/ferreterías/revistas del rubro, devolver
  JSON con el esquema de arriba; si la presentación no es la unidad de la app, convertir y explicar la cuenta.
- **Anti-invento**: solo se devuelven opciones cuya `url` aparece entre las fuentes/citas que devolvió la búsqueda; las
  demás se descartan. Precio > 0, moneda ARS. Si quedan 0 → `opciones: []` con `aviso`.
- Sin `OPENAI_API_KEY` → 503 "El buscador de precios no está configurado". Error de OpenAI o tiempo (60 s) → 502 con
  mensaje claro. Nada se guarda en este paso: guardar es el PATCH/POST de la entrada con `fuente`/`fuente_url`.
- Tests con el cliente de OpenAI falso (sin red): opciones válidas, URL inventada descartada, con IVA → sin IVA,
  sin clave → 503, error → 502.

### Tests (`tests/test_correcciones.py`, `tests/test_price_search.py`, más los que toquen)
- Estado por corrección: para aplicar / aplicada / no coincide / precio más nuevo salteado.
- Aplicar: cambia exactamente los renglones, crea las fórmulas nuevas, marca `editado`, pone la nota `correccion`,
  guarda precios con fuente e historial, registra; otra empresa no se toca (`org_id`).
- Falla a mitad → se restaura y 500 `NO_SE_APLICO`; deshacer devuelve todo a como estaba; deshacer con cambio posterior
  → 409.
- El JSON real (`app/data/correcciones_ginkgo.json`) carga y valida.
- MAPEO con alternativa. `python3 -m pytest -q` todo verde (hoy 756 passed, 14 skipped); `ruff check` sin errores
  nuevos.

## 3. Pantalla (`frontend/src/`)

- `pages/Correcciones.tsx` (ruta `/formulas/correcciones`) y el aviso arriba de `pages/Templates.tsx`. Tarjetas como
  en 1.A; "Ver los cambios" plegable; aplicar/deshacer con estado (aplicando… / listo / error que queda a la vista);
  "Aplicar todas" con confirmación en la página; resumen arriba. Montos con `formatARS`; textos con tildes y voseo.
- `pages/TemplateEditor` / editor de fórmulas: la línea "Corregido por la revisión…" en el renglón.
- `pages/Catalogs.tsx`: origen debajo de cada precio (y en el historial) con link "Ver" si hay URL; "Buscar en
  internet" por renglón y "Buscar un precio" arriba.
- `components/BuscarPrecio.tsx` (panel/diálogo reutilizable): búsqueda editable, estados (buscando / resultados /
  sin resultados / error / no configurado), tarjetas de opción con la cuenta, número editable antes de guardar,
  "Usar este precio" → `PATCH`/`POST` de la entrada con `fuente`/`fuente_url`/`proveedor`/`fecha_precio`. Al guardar,
  la lista se actualiza y el renglón muestra el origen nuevo.
- `pages/ItemDetail.tsx`: "Buscar en internet" en los recursos sin precio; al guardar, el recurso toma el precio
  (como cuando se carga un precio a mano hoy).
- `lib/api.ts`: `correccionesApi` (listar, aplicar, deshacer) y `preciosApi.buscar`.
- `scripts/check_textos.cjs` sigue en 0. En 400 px, sin scroll horizontal.
- `scripts/serve_fake.py`: carga las correcciones reales; con `FAKE_BUSCADOR=1` el buscador devuelve opciones fijas
  (un archivo de ejemplo), sin red.
- e2e nuevo `scripts/e2e_ajuste_ginkgo.cjs`: aviso en Fórmulas → Correcciones; cada tarjeta muestra "Supuesto por
  Claude" y fuentes; aplicar una → "Aplicada" y la fórmula muestra la nota y el valor nuevo; deshacer → vuelve;
  una que no coincide (se edita la fórmula antes) no deja aplicar; "Aplicar todas"; en Precios, "Buscar en internet" →
  opciones con link y cuenta → "Usar este precio" → el renglón muestra precio y origen con link; desde un recurso en
  rojo del detalle de un trabajo, lo mismo; buscador sin configurar → mensaje; 400 px sin scroll horizontal.
- Los e2e de siempre con sus OK. `npm run build` pasa; tsc con sus 7 errores viejos, ninguno nuevo.

## 4. Lo que hace Claude fuera del código

- Respuestas supuestas anotadas en el cuestionario (cada una "Supuesto por Claude, a confirmar") y en la página de
  Ginkgo para Sol.
- Precios buscados en internet con su fuente (`precios_web.md`), usados para los precios del grupo B y para los que
  están mal en la lista (por ejemplo el metal desplegado a $1).
- Después del deploy: Carlos corre la migración 012, aplica las correcciones y vuelve a cargar Ginkgo; Claude actualiza
  los números de la página de Sol (dentro de ±5%, más caros, más baratos).

## 5. Fuera de este PR
Celular (9). El margen (D1, lo decide Carlos). Las correcciones del Excel de Sol (grupo C, las hace Sol en su planilla).
Buscar precios automáticamente para toda la lista de una vez.
