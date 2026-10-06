# Plan: un solo total en toda la app (entrega 5) + Fórmulas con el botón arriba

> Fecha: 2026-10-06. Contrato para un solo PR. **Render: Manual Deploy SÍ** (cambia el servidor).
> Origen: auditoría de "armar un presupuesto a mano" (https://claude.ai/artifact/3KfqizZ6HkfNGqtUmSpDiL), entrega 5.
> Y el pedido de Carlos del 05/10, que repitió el 06/10: "por qué está al final cargar una nueva fórmula" → botón arriba.

## 1. Qué cambia, para Sol

### A. Un solo total

La regla, en una frase: **el precio de cada trabajo es su costo directo pasado por el Coeficiente de pase**
(`calc_cascade_indirects`: indirectos → beneficio → Ingresos Brutos y cheque → precio sin IVA → IVA). Se calcula en
**un solo lugar** (el servidor, al guardar) y **todas** las pantallas, el Excel y los dos PDF muestran ese número
guardado. Nadie lo recalcula por su cuenta.

Hoy hay 13 caminos que se apartan de esa regla (inventario completo del 06/10). Los que ve Sol:

| # | Hoy | Después |
|---|---|---|
| T1 | Guardar una nota en "memoria de cálculo" **baja el precio** del trabajo: se le caen Ingresos Brutos y cheque (de $159,49 a $147,40 por cada $100 de costo directo). | Guardar un texto no toca los números. |
| T2 | Cambiar materiales o mano de obra en el detalle cambia el costo directo pero **no** los indirectos ni los impuestos: puede quedar "Neto $247" arriba de "Total final $193". | Cada cambio de recursos, parámetros o cantidad termina con la cuenta completa de ese trabajo. Lo que se ve siempre cierra. |
| T3 | Un trabajo nuevo cargado "a mano" (sin fórmula) queda **sin indirectos ni beneficio**: precio = costo directo. | Entra con la cuenta completa, como cualquier otro. |
| T4 | Dos botones "Recalcular" que hacen cosas distintas: "Recálculo completo" del editor baja el precio (saca los impuestos) y después lo arregla en segundo plano; si eso falla, nadie se entera. | Uno solo, que hace la cuenta completa (la de Coeficiente de pase). Si falla, lo dice en rojo. |
| T5 | La barra del editor dice **"31% indirecto"** (suma 4 conceptos, se olvida de imprevistos); el detalle dice "Indirectos (31,0%)"; mientras carga, la barra dice **41%**. El real es 34%. | Un solo porcentaje, calculado con los 5 conceptos, en todos lados. Mientras carga, no se muestra ningún número. |
| T6 | La barra del editor y el tablero dicen "Neto" sin decir que no tiene IVA; los impuestos no aparecen como renglón, así que **directo + indirectos + beneficio no da el neto** (faltan $12 de cada $100). Lo mismo en el PDF interno y en el Excel exportado. | La barra, el PDF interno y el Excel muestran la escalera entera: Costo directo → Indirectos (34%) → Beneficio → Impuestos (IIBB + cheque) → **Precio sin IVA** → IVA → **Precio con IVA**. Los renglones suman. |
| T7 | Cambiar un porcentaje en Coeficiente de pase **no actualiza** los presupuestos: el editor y el tablero siguen con el precio viejo, el PDF para el cliente ya usa el nuevo. El mismo PDF interno muestra dos netos distintos. | Al guardar, la app avisa antes: "Esto cambia el precio de 4 presupuestos que usan estos porcentajes: Ginkgo, … ¿Seguir?". Al aceptar, los actualiza y dice "Listo: 4 presupuestos actualizados". Los presupuestos con porcentajes propios no se tocan. |
| T8 | El PDF para el cliente calcula su propio total (sobre la suma, con los porcentajes de hoy): puede no coincidir con el editor. | El PDF para el cliente usa el precio guardado de cada trabajo; su "Total sin IVA" es exactamente el del editor y el tablero. |
| T9 | "Aplicar lista" (Lista de precios) recalcula los trabajos **sin equipos, materiales indirectos ni subcontratos**, cobra lo que compra el cliente y no aplica indirectos. | Usa el mismo recálculo que actualizar precios: todos los recursos, lo que compra el cliente en $0 y la cuenta completa. |
| T10 | Versiones dice "Neto: $0" en todas y "0%" de diferencia. | Muestra el precio sin IVA de cada versión y la diferencia real. |
| T11 | Las tarjetas del tablero cuentan los rubros como si fueran trabajos ("N ítems" de más). | Cuentan solo trabajos. |
| T12 | Importar Excel guarda el neto que traía el Excel (con lo que el Excel haya sumado) y deja vacíos impuestos e IVA. | Guarda el costo directo del Excel y le aplica el Coeficiente de pase, como todo lo demás. El resultado de la importación dice en una línea: "Tu Excel decía $X; con tu Coeficiente de pase da $Y" (si son distintos). |

**Qué no decide este PR:** cuánto vale cada porcentaje. Si Terrac no cobra beneficio o no traslada Ingresos Brutos y
cheque, se pone 0 en Coeficiente de pase y todo el resto sigue solo (pregunta abierta a Carlos, D1).

### B. Pantalla Fórmulas

| Hoy | Después |
|---|---|
| "Nueva fórmula" es un recuadro punteado **al final de la lista**: con cientos de fórmulas hay que bajar hasta el fondo para encontrarlo. | Botón verde **"+ Nueva fórmula"** arriba a la derecha, al lado del título, siempre a la vista (la cabecera queda fija al bajar). El recuadro del final se va. |
| No hay buscador: para encontrar "cielorraso aplicado" hay que tocar el rubro y mirar una por una. | Buscador arriba de los rubros: **"Buscá una fórmula: nombre, rubro o número (ej. 6.11)"**. Mismo criterio que el buscador del detalle: todas las palabras, en cualquier orden, sin tildes. Se combina con el rubro elegido. Debajo: "12 de 340 fórmulas". Si no hay ninguna: "Ninguna fórmula dice «…». Probá con otra palabra o creá una nueva" con el botón. |
| El número de la fórmula (6.8, 5.1.4) no se ve; solo aparece escondido en la descripción ("solapa 6.8"). El cuestionario de Emilia y Sol habla por número. | El número va **chico y gris** delante del nombre (principio "palabras, no códigos": el nombre manda). Las fórmulas se ordenan por número dentro de cada rubro (6.1, 6.2 … 6.10, 6.11; no 6.1, 6.10, 6.11, 6.2). |
| La ventana de crear/editar dice "Nueva plantilla" / "Editar plantilla" (palabra vieja). Un recurso dice "de la plantilla". | "Nueva fórmula" / "Editar fórmula" / "de la fórmula". |
| Al crear una fórmula, aparece al final de la lista, quizás escondida por el filtro. | Al guardar una nueva: si el filtro o la búsqueda la esconden, se limpian; la lista baja hasta ella y queda resaltada un momento ("Fórmula creada"). Si había un rubro elegido, la ventana nueva arranca con ese rubro en "Categoría". |

## 2. Servidor

- **Una sola función de escritura**: `app/calculations.py` (o `app/budget_prices.py`, donde encaje) gana
  `price_item(item, config) -> item` = directo (ya calculado) + `calc_cascade_indirects`. Cada camino que cambia el
  costo directo de un trabajo la llama antes de guardar, con `effective_indirects` del presupuesto (leído una vez por
  pedido):
  - PATCH de item (`budgets.py` ~302): si el body no trae campos de costo (cantidad, unitarios), **no** recalcula
    nada (T1); si los trae, directo + `price_item`.
  - `_recalc_item_from_resources` (~719) y todo lo que la usa: recursos alta/cambio/baja/bulk, parámetros,
    cambio de cantidad (T2).
  - `POST /{id}/items` (~243) (T3).
  - `POST /{id}/assign-catalog/{cid}` y `POST /catalogs/apply/{bid}/{cid}`: pasan por el mismo recálculo de
    recursos que `actualizar-precios` (`_run_cascade`), con todos los tipos y `lo_compra_cliente` en $0 (T9).
  - Importar Excel (`excel.py` ~197/459): directo del Excel + `price_item`; la respuesta suma `neto_excel` y
    `neto_app` (T12).
  - `copy` (~1397): copia también `impuestos_total`, `iva_total`, `total_final`.
  - `POST /{id}/recalculate`: hace lo mismo que `cascade-recalculate` (delegar; la ruta queda por compatibilidad) (T4).
- **Cambiar porcentajes** (T7): `PATCH /budgets/{id}/indirects` recalcula ese presupuesto (cascada sobre el directo
  guardado, como `POST /{id}/indirects`) y devuelve lo de hoy + `actualizados: 1`. Para los generales
  (`/indirects/general`): `POST /indirects/general/afectados` con el mismo body que el PATCH devuelve
  `{"presupuestos": [{"id", "nombre"}]}` = los presupuestos de la empresa cuya config efectiva cambiaría; el
  `PATCH /indirects/general` acepta `aplicar: true` y entonces, además de guardar, recalcula esos presupuestos y
  devuelve lo de hoy + `actualizados: n`. Sin `aplicar` guarda y no recalcula (compatibilidad). Un presupuesto con
  todos los conceptos propios no cambia.
- **Lecturas** (T6, T8, T11): `calc_budget_summary` suma también `impuestos_total`, `iva_total`, `total_final` y
  cuenta solo trabajos (no rubros). PDF interno: KPIs, "Resumen de costos" y la página de la cascada salen de esas
  sumas guardadas (con el renglón Impuestos); se deja de recalcular desde la config. PDF cliente: precio de cada
  trabajo = su neto guardado; total sin IVA = Σ neto; IVA = Σ iva; con IVA = Σ total_final. Excel exportado: columna
  Impuestos (y fila de totales que suma).
- **Versiones** (T10): `list_versions` devuelve `neto_total` de cada versión (del snapshot: Σ neto de sus trabajos, o el
  campo que guarde; si el snapshot no lo tiene, calcularlo al listar).
- Un porcentaje de indirectos para mostrar: `GET /{id}/indirects` devuelve también `indirecto_pct` (los 5 conceptos)
  y `coeficiente` (precio sin IVA por cada $1 de directo), para que la pantalla no sume por su cuenta.
- **Tests** (`tests/test_un_solo_total.py`): un presupuesto con 3 trabajos y config por defecto; después de cada
  operación (PATCH cantidad, PATCH solo nota, alta/cambio/baja de recurso, parámetro, trabajo nuevo a mano, aplicar
  lista, recalcular, cambiar porcentajes del presupuesto y generales, importar Excel, copiar) se verifica para **cada
  trabajo**: `neto == cascada(directo, config)` al centavo, `total_final == neto × 1,21`, y que
  `summary.neto == Σ neto == total sin IVA del PDF cliente == total de la fila del Excel exportado`. Más: PATCH de
  solo texto no cambia ningún número; presupuesto con porcentajes propios no cambia al tocar los generales; versiones
  con neto real. `python3 -m pytest -q` todo verde (hoy 686 passed, 14 skipped); `ruff check` sin errores nuevos.

## 3. Pantalla (`frontend/src/`)

- **Un solo total** (T4–T7):
  - `lib/cascada.ts`: `pctIndirectos(config)` (5 conceptos). Usarlo en `Editor.tsx` (barra), `MarkupChainDisplay.tsx`
    (sacar el respaldo fijo que da 41%: sin config, sin número) e `ItemDetail.tsx` ("Indirectos (34%)").
  - `CostSummaryBar.tsx`: la escalera Costo directo → Indirectos → Beneficio → Impuestos → **Precio sin IVA** →
    Precio con IVA (los dos últimos destacados), con los totales guardados. Mismos nombres en tablero (`BudgetCard`,
    `Dashboard`) y `Analysis`: "Precio sin IVA" donde hoy dice "Neto" / "Neto Total".
  - Editor: "Recálculo completo" llama a `cascadeRecalculate` (como Coeficiente de pase) y muestra el error en rojo;
    la edición en línea ya no necesita el `applyIndirects` de después (lo hace el servidor), y si el PATCH falla se
    ve.
  - `ItemDetail.tsx`: "Costo directo" del total = `item.directo_total` (no la suma de recursos sin redondear); después
    de tocar recursos/parámetros/nota, refrescar el trabajo (el servidor ya hizo la cuenta).
  - `MarkupChain.tsx`: si no se pudieron leer los porcentajes, no se puede guardar (hoy usaría beneficio 25 inventado);
    al guardar los generales, el aviso con la lista de presupuestos afectados y "Listo: N actualizados"; al guardar los
    de un presupuesto, se actualiza solo.
  - `Versions.tsx`: neto real.
  - Importar Excel: la línea "Tu Excel decía $X; con tu Coeficiente de pase da $Y".
- e2e nuevo `scripts/e2e_un_solo_total.cjs`: Ginkgo cargado → anotar el precio sin IVA del editor; debe ser igual en
  el tablero, en el PDF para el cliente (leer el texto) y en el Excel exportado; guardar una nota en un trabajo → no
  cambia; agregar un recurso → la escalera del detalle suma y el total del editor cambia en lo mismo; cambiar
  beneficio a 20% en Coeficiente de pase → aparece el aviso con Ginkgo, aceptar → el editor muestra el precio nuevo y
  el PDF también; la barra dice 34%. Y `e2e_ginkgo`, `e2e_detalle_trabajo`, `e2e_nuevo_presupuesto`,
  `e2e_agregar_trabajo`, `e2e_sin_precios` siguen dando sus OK.
- **Fórmulas** (parte B):
  - `pages/Templates.tsx`: cabecera fija con título, contador y botón "+ Nueva fórmula" (solo si `puedeEditar`; quien
  solo mira no lo ve); buscador (reusar `sinTildes` y el criterio de "todas las palabras" de
  `components/ui/BuscadorFormulas.tsx`: moverlo a `lib/` si hace falta, no copiarlo); número chico y gris; orden por
  número natural; resaltado al crear; categoría inicial. Sacar el recuadro punteado del final. El vacío sin filtro
  ("No hay fórmulas cargadas") ofrece el mismo botón.
  - `components/ui/TemplateEditor.tsx`: textos "fórmula" (título y `ORIGEN_LABEL.plantilla`); acepta una categoría
  inicial.
  - En celular (400 px) la cabecera no se rompe: el botón pasa abajo del título a lo ancho.
  - e2e nuevo `scripts/e2e_formulas.cjs`: el botón está arriba y visible sin bajar; buscar "cielorraso aplicado" y
    "6.11" encuentran; crear una fórmula con el rubro "Yeseria y durleria" elegido → arranca con ese rubro, queda
    resaltada y visible; quien solo mira no ve el botón.
- `npm run build` pasa; tsc con sus 8 errores viejos, ninguno nuevo.

## 4. Fuera de este PR
Exportar (6: Excel Terrac como estándar, textos), palabras y tildes del resto (7), celular (8), "+ Nuevo Presupuesto"
directo al editor y la guía de Ayuda del camino a mano (después de esta). Cuánto vale cada porcentaje (D1, Carlos).
