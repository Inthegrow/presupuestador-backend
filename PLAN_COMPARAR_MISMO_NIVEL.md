# Plan: comparar con el Excel al mismo nivel, y "Cadena de Markups" pasa a "Coeficiente de pase"

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambia `/obras/{id}/diferencias`).
> Origen: Carlos, 06/10: "podemos hacer la comparación al mismo nivel del Excel: si en el Excel no está, no comparar ese
> cálculo de la app, más allá que la app sí lo cargue". Y eligió el nombre "Coeficiente de pase".

## 1. Qué cambia, para Sol

| Hoy | Después |
|---|---|
| "Ver diferencias con el Excel" tiene dos vistas: costo directo y **precio final**. En Ginkgo el precio final da +20,9% porque la app suma beneficio 10%, Ingresos Brutos 7% y cheque 1,2%, y el Excel de Sol corta en los indirectos (34%). Parece una diferencia de la app y no lo es. | Dos vistas: **Costo directo** y **Al nivel del Excel**. La app mira hasta dónde llega el Excel (cuánto le suma al costo directo) y compara la app **hasta ese mismo punto**. Arriba lo dice en una frase: "Tu Excel le suma 34% al costo directo: llega hasta los indirectos. Comparo la app hasta ahí. El precio final de la app además suma beneficio e impuestos: $X." En Ginkgo la diferencia "al nivel del Excel" queda cerca de la del costo directo (+1,6%), que es la verdadera. |
| El menú y la pantalla dicen "Cadena de Markups" (y "Markups" en otros textos). | Dicen **"Coeficiente de pase"**. Debajo del título de esa pantalla: "Lo que se le suma al costo directo para llegar al precio: indirectos, beneficio e impuestos. Por cada $100 de costo directo, el precio sin IVA es $X." (con la misma cuenta de `frontend/src/lib/cascada.ts`). La ruta no cambia. |

## 2. Servidor (`app/routers/obras.py`, `GET /obras/{budget_id}/diferencias`)

- Niveles de la app para cada trabajo, con lo que ya está guardado en `budget_items`:
  `directo` = `directo_total`; `indirectos` = `directo_total + indirecto_total`; `beneficio` = `+ beneficio_total`;
  `neto` = `neto_total` (con impuestos).
- Nivel del Excel: `r = Σ excel_neto / Σ excel_directo` de los trabajos. Factores de la app para este presupuesto con
  sus indirectos efectivos (`effective_indirects` + defaults, la misma config que la cascada): `f_ind = 1 + (imprevistos
  + estructura + jefatura + logística + herramientas)/100`; `f_ben = f_ind × (1 + beneficio/100)`; `f_neto = f_ben × (1 +
  (IIBB + cheque)/100)`. El nivel es el de factor más cercano a `r` (si `r <= 1.0005`: `directo`).
- Respuesta: se suma `"nivel_excel": {"nivel": "directo"|"indirectos"|"beneficio"|"neto", "factor_excel": r,
  "factor_app": f, "texto": "..."}` y un modo nuevo **`"nivel"`**: por trabajo `app_nivel`, `diferencia_nivel`,
  `diferencia_nivel_pct`, unitarios `app_unitario_nivel` y los mismos campos en `resumen.nivel`. Lo que ya devuelve
  (`neto`, `directo`) **no cambia de nombre** (otras pantallas o tests lo usan). Si el pedido trae `?modo=nivel`, ordena por
  esa diferencia (mirar cómo hoy usa `MODOS`).
- `texto`: "Tu Excel le suma {pct}% al costo directo: llega hasta {los indirectos | el beneficio | los impuestos}.
  Comparo la app hasta ahí." Para `directo`: "Tu Excel no le suma nada al costo directo: comparo costo directo."
- Tests (`tests/test_obras_api.py` o uno nuevo): Excel con neto = directo × 1,34 y config por defecto → nivel
  `indirectos` y `app_nivel = directo + indirecto` por trabajo; Excel con neto = app neto → `neto`; Excel sin margen →
  `directo`; los campos viejos siguen igual. `python3 -m pytest -q` todo verde (hoy 648 passed, 14 skipped); `ruff check`
  sin errores nuevos.

## 3. Pantalla (`frontend/src/`)

- `pages/DiferenciasExcel.tsx`: las vistas pasan a **Costo directo** y **Al nivel del Excel** (reemplaza "Precio
  final"). En "Al nivel del Excel", la frase `nivel_excel.texto` arriba y, aparte y chico, "Precio final de la app (con
  todo): $X". Tarjetas, tabla y detalle por renglón usan los campos `*_nivel`. `lib/api.ts`: tipos nuevos.
- "Coeficiente de pase" en todos los textos visibles que hoy dicen "Cadena de Markups" o "Markups": `Sidebar.tsx`,
  `pages/MarkupChain.tsx` (título y la frase de arriba), `components/ui/MarkupChainDisplay.tsx`, `pages/Editor.tsx`,
  `pages/NewProject.tsx`, `pages/Ayuda.tsx` si lo nombra. No cambian nombres de archivos, rutas ni variables.
- `scripts/e2e_ginkgo.cjs`: ajustar la parte de diferencias (hoy toca "Precio final"): en "Al nivel del Excel" aparece
  "llega hasta los indirectos" y la diferencia total está entre −5% y +5%. Menú: "Coeficiente de pase".
- `npm run build` pasa; tsc con sus 8 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
Un solo total en todas las pantallas (entrega 5: incluye el "31% indirecto" de la barra del editor), agregar trabajo en
un renglón (4), exportar (6), resto de palabras y tildes (7), celular (8). Las 6 fórmulas de Ginkgo (grupo A) van
aparte, cuando Emilia y Sol las revisen.
