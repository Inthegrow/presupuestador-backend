# Plan: que el precio no salga mal sin aviso, y que el PDF del cliente no muestre el margen

> Fecha: 2026-10-05. Contrato para un solo PR. **Render: Manual Deploy SÍ** (toca el servidor).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL),
> entrega 1 + la parte urgente de la 6. Afecta también a las obras de Cargar obra (editor y exportación).

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| En el detalle de un trabajo, "Cargar fórmula" dos veces (o elegir otra para corregir) **suma** los materiales a los que ya había: el ladrillo pasa de $22.189 a $44.378 por m². | La fórmula **reemplaza** lo que tenía el trabajo. Si ya tiene una, el botón dice **Cambiar fórmula** y avisa: "Reemplaza los materiales y la mano de obra que tiene ahora." |
| Contrapiso de 30 m² con la fórmula "DE CASCOTE" (en m³): la app calcula 30 m³ sin preguntar. Sale 10 veces más caro. | Si la unidad del trabajo y la de la fórmula no coinciden, la app pregunta lo mismo que en Cargar obra: "La fórmula está en m³ y el trabajo en m². ¿Cuántos m³ hay en 1 m²?" con el valor propuesto (el espesor del nombre del trabajo, "e=8cm" → 0,08, o el que propone la regla, 0,10 para contrapiso). Sin respuesta no se aplica. |
| Materiales sin precio en la lista oficial quedan en $0 sin ninguna marca. | Al aplicar, un aviso rojo: "Faltan precios: Látex…, Enduido…. Cargalos en Lista de precios." (con enlace). |
| Después de aplicar una fórmula, el neto del trabajo sigue en $0 hasta "Recálculo completo"; y ese botón no refresca la tabla que se ve. | El trabajo queda con su neto calculado al aplicar. "Recálculo completo" refresca la tabla visible. |
| "Vista Cliente (Venta) — Solo netos, sin costos internos" descarga **el mismo PDF interno**, con costo directo, indirectos y beneficio. | Descarga un PDF para el cliente de verdad: por rubro, cada trabajo con unidad, cantidad, precio unitario de venta y total; abajo, total sin IVA, IVA y total con IVA. Sin costo directo, sin indirectos, sin beneficio, sin porcentajes, sin materiales. |

## 2. Servidor

### 2.1 Aplicar una fórmula (`app/routers/templates.py`, `apply_template`)
- **Reemplazar**: después de calcular todas las filas (si una fórmula falla, 422 como hoy y no se toca nada), borrar
  los `item_resources` del trabajo (`item_id`, `org_id`) y recién ahí insertar las nuevas.
- **Conversión de unidades**: `TemplateApply` suma `factor: float | None = None`. Comparar la unidad del trabajo con la
  de la fórmula normalizadas (usar la normalización que ya usa Cargar obra en `app/obra_import.py`; m2 = m² etc.).
  - Iguales: factor 1, como hoy.
  - Distintas y sin `factor`: **409** con `detail` objeto: `{"codigo": "FALTA_CONVERSION", "mensaje": "La fórmula está
    en {uf} y el trabajo en {ut}. ¿Cuántos {uf} hay en 1 {ut}?", "unidad_formula": uf, "unidad_trabajo": ut,
    "factor_propuesto": x | null}`. `factor_propuesto` = `espesor_m_from(descripcion del trabajo)` si la fórmula está
    en m³ y el trabajo en m²; si no, el `factor_defecto` de la regla de `match_recipe(descripcion)` cuando esa regla
    usa esta fórmula; si no, null.
  - Con `factor` (> 0; si no, 422 "El factor tiene que ser mayor que cero"): escalar con `_scale` y
    `_scale_rendimiento` de `app/obra_import.py`, igual que `expand_item`, de modo que los recursos guardados queden con
    la fórmula escalada (`(Q*0.1)`) y un recálculo posterior dé lo mismo.
- **Precios que faltan**: la respuesta suma `"precios_faltantes": [{"codigo", "descripcion", "motivo"}]` con cada
  recurso con código cuyo `PriceBook.price` no dio precio válido (`entry is None` o `problema`), sin repetir códigos.
  `motivo`: el texto de `problema` si lo hay, o "No está en la lista oficial".
- **Neto al día**: al terminar, el trabajo queda con `indirecto_total`, `beneficio_total` y `neto_total` calculados
  igual que `POST /budgets/{id}/recalculate` (reusar esa función para este trabajo; no duplicar la cuenta).
- Lo que ya devuelve no cambia de nombre.

### 2.2 PDF para el cliente (`app/routers/excel.py`)
- `GET /budgets/{id}/export/pdf?vista=cliente` (sin `vista` o `vista=interna`: el PDF de hoy, sin cambios).
- Mismo encabezado que el interno (logo, empresa, obra, fecha). Una tabla por rubro: trabajo, unidad, cantidad,
  precio unitario y total. Abajo: **Total sin IVA**, **IVA (21%)** y **Total con IVA**.
- Cuenta: el total sin IVA es el **NETO (sin IVA)** de la cascada que ya arma el PDF interno
  (`_cascade_from_config(directo_total, cfg)["neto"]`) y el total con IVA es su `total_final`. El precio de cada
  trabajo es su costo directo × (neto de la cascada ÷ directo total), redondeado a centavos; la diferencia de
  redondeo se suma al trabajo más caro para que la suma dé exacto el total. (Así los precios cierran con el total y
  no se ve el margen. Cuál de los dos totales de hoy es "el" total lo decide Carlos en la entrega 5; si elige el
  otro, se cambia acá en una línea.)
- No aparece en ningún lado: costo directo, materiales, mano de obra, indirectos, beneficio, porcentajes,
  imprevistos, impuestos (salvo el IVA).
- Nombre del archivo lo pone la pantalla.

### 2.3 Tests (`tests/`)
- Aplicar dos veces la misma fórmula deja los mismos recursos (misma cantidad de filas, mismo directo). Aplicar
  otra fórmula deja solo los de la nueva.
- Trabajo en m² con fórmula en m³: sin factor → 409 `FALTA_CONVERSION` con `factor_propuesto` 0.08 si la
  descripción dice "e=8cm"; con 0.10 de una regla de contrapiso sin espesor en el nombre. Con `factor=0.1` → el
  directo es 1/10 del que daría con factor 1. Factor 0 → 422. Misma unidad → como hoy.
- `precios_faltantes` trae los códigos sin precio en la lista oficial (y no los que tienen precio, ni un $0 fechado).
- Después de aplicar, `neto_total` del trabajo > 0 e igual al que deja `/recalculate`.
- PDF cliente: responde PDF; el texto extraído (si hay `pypdf` o similar instalado; si no, testear la función que
  arma las filas) no contiene "Directo", "Indirecto", "Beneficio" ni "%" salvo "IVA (21%)"; la suma de los precios
  de los trabajos es igual al total sin IVA. El PDF interno sigue igual.
- `python3 -m pytest -q` todo verde (hoy 584 passed, 14 skipped). `ruff check` en los archivos tocados sin errores
  nuevos (excel.py ya tiene 17 viejos).

## 3. Pantalla (`frontend/src/`)
- `lib/api.ts`: `templateApi.apply(..., { parametros?, factor? })`; tipo de la respuesta con `precios_faltantes`.
  `budgetApi.exportPdf(id, vista?: 'cliente')`. Un 409 con `detail.codigo === 'FALTA_CONVERSION'` tiene que llegar a
  la pantalla con su objeto (hoy los errores se convierten en texto: ver cómo `request` arma el Error y exponer
  `detail`).
- `pages/ItemDetail.tsx`:
  - Si el trabajo ya tiene fórmula (`template_id`), el botón dice **Cambiar fórmula** y, al elegir, muestra antes de
    aplicar: "Reemplaza los materiales y la mano de obra que tiene ahora." con **Reemplazar** / **Cancelar** (en la
    página, sin `confirm()`).
  - 409 `FALTA_CONVERSION`: un recuadro con el `mensaje`, un campo numérico con `factor_propuesto` (vacío si es
    null), la ayuda "Para contrapisos y carpetas es el espesor en metros: 10 cm = 0,10" y **Aplicar**, que reenvía con
    `factor`. Mismo estilo que la pregunta de conversión de las tarjetas de `CargarObra.tsx`.
  - `precios_faltantes` no vacío: aviso rojo (mismo rojo que Cargar obra) "Faltan precios: {descripciones, hasta 5,
    y "y N más"}. Cargalos en Lista de precios." con enlace a `/app/catalogs`. Se va al recargar si ya no faltan.
- `pages/Editor.tsx`: "Recálculo completo" (`handleRecalculate`) refresca la lista visible del rubro elegido.
- `pages/Export.tsx`: "Vista Cliente (Venta)" llama a `exportPdf(id, 'cliente')`; subtítulo "Precio de venta por
  trabajo, sin costos internos".
- `npm run build` pasa; tsc con sus 13 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
Buscador de fórmulas en el detalle, asistente, agregar trabajo en un renglón, un solo total en todos lados, celular:
entregas 2 a 8 de la auditoría.
