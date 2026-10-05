# Plan: listas de precios repetidas y el editor que no respeta la lista oficial (paso 5d)

> Fecha: 2026-10-05. Contrato para un solo PR. **Render: Manual Deploy SÍ** (toca el servidor).

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| Cada "Importar Excel" crea una lista de precios nueva ("Catalogo - archivo.xlsx"), aunque sea el mismo archivo. La Lista de precios crece sola (en producción ya hay 7). Si el Excel no tiene hojas de precios (00_Mat, 00_MO, 00_Eq, 00_Sub), igual crea una lista vacía. | Si ya hay una lista del **mismo archivo** (`source_file` igual, misma empresa), se **actualiza esa**: los códigos que ya están cambian de precio (con historial, como cualquier cambio de precio) y los nuevos se agregan. Si el Excel no trae hojas de precios, **no se crea ninguna lista**. Nunca se marca oficial sola. El resultado dice "Actualicé la lista X: N precios cambiados, M nuevos" o "Creé la lista X". |
| En el editor, "Aplicar receta" a un trabajo toma el **primer** material que encuentra con ese código, de cualquier lista (puede ser una de solo consulta, o un precio viejo). | Usa la misma regla que Cargar obra y Actualizar precios: primero la **lista oficial**; el precio vigente a la fecha "precios al" del presupuesto (o hoy si no tiene); un $0 cuenta solo si tiene fecha. Si el código solo está en una lista de consulta, el material queda sin precio ($0, sin vínculo) y el detalle lo marca como "sin precio", igual que en Cargar obra. |

## 2. Servidor

### 2.1 Importar Excel (`app/routers/excel.py`, `import_excel`)
- Antes de crear la lista: parsear las hojas de precios. Si no hay entradas, no crear lista (`catalog_id: null`).
- Buscar `price_catalogs` de la empresa con `source_file == file.filename`. Si hay, reusar la más reciente.
- Reusar = por cada entrada parseada, buscar por `codigo` normalizado (y `tipo` si hace falta para desempatar)
  dentro de esa lista: si existe y el precio cambió, actualizarlo dejando el precio anterior en el historial
  (`catalog_price_history`), con la misma lógica que ya usa el PATCH de entradas o la subida de listas en
  `app/routers/catalogs.py` (reusar esa función; no duplicar reglas de historial ni de fecha); si no existe,
  insertarla. Los códigos de la lista que el Excel nuevo no trae, no se tocan.
- La respuesta suma: `"catalog_reused": bool`, `"catalog_name"`, `"precios_actualizados"`, `"precios_nuevos"`.
  Lo que ya devuelve no cambia de nombre. La pantalla de Importar Excel muestra una línea con eso (si hoy
  muestra "catalog_entries", sumar al lado la frase; cambio mínimo de pantalla).
### 2.2 Aplicar receta desde el editor (`app/routers/templates.py`, ~línea 281)
- Reemplazar la búsqueda "primer `catalog_entries` con ese código" por la regla común de precios
  (`app/budget_prices.py`: `load_catalog_index` / `find_entry` / `pick_price`, o el `PriceBook` de
  `app/routers/obras.py` si queda más simple), a la fecha `precios_al` del presupuesto (o hoy).
- `precio_fecha` y `catalog_entry_id` quedan como en Cargar obra: solo si hay precio válido.
### 2.3 Tests
- Importar el mismo Excel dos veces: una sola lista; la segunda vez con un precio cambiado deja el precio nuevo
  y el viejo en el historial; un código nuevo se agrega; uno que falta no se borra. Excel sin hojas de precios:
  ninguna lista. Otro archivo: otra lista.
- Aplicar receta con el código en una lista oficial y en una de consulta con distinto precio: usa el oficial.
  Con precio fechado después de `precios_al`: usa el vigente a esa fecha. Solo en lista de consulta: $0 y sin
  vínculo. Sin ninguna lista oficial: comportamiento de hoy (precio más nuevo entre todas, regla existente).
- `python3 -m pytest -q` todo verde (hoy 569 passed, 14 skipped). `ruff check` en los archivos tocados.
