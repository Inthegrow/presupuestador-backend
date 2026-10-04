# Plan: las fallas de UX de "Cargar obra" vistas con Ginkgo (paso 4 del plan maestro)

> Fecha: 2026-10-04. Contrato para un solo PR. Origen: `HANDOFF_COTIZADOR_AGENTICO.md`, sección 5, punto 0c,
> más lo que vio Carlos haciendo de Sol el 04/10 (capturas de producción). Regla: lo que Sol dude es un bug.

## 1. Qué cambia, para Sol

| # | Hoy | Después |
|---|---|---|
| 1 | El panel "Precios para corregir" está al final de la página; "corregir" en cada tarjeta hace scroll hasta abajo. | El panel va **arriba de las tarjetas**, justo debajo de los filtros, abierto cuando hay precios en rojo. "corregir" lo abre y lo enfoca. |
| 2 | "Guardar" no acepta $0. Hay materiales que legítimamente van en $0 (Y-M4X1, Y-L1X1, Y-MD200X70 están en $0 también en el Excel de Sol). | Botón **"Va en $0"** al lado de Guardar: guarda precio 0 **con fecha de hoy**. Un $0 con fecha es un precio confirmado; sin fecha sigue siendo "sin precio". |
| 3 | La casilla "Cargar igual" aparece solo cuando no quedan preguntas abiertas y nada lo explica. | Debajo del botón "Cargar presupuesto" siempre se dice **qué falta**, en una frase: "Te faltan 2 preguntas y 5 precios" / "Faltan 5 precios: cargalos arriba, o marcá 'Cargar igual' y esos materiales van en $0". La casilla aparece en cuanto hay precios en rojo, con esa explicación al lado. |
| 4 | El cuadro de precio dice "Precio sin IVA por u". | Unidad en palabras: "por unidad", "por m²", "por m³", "por metro", "por kg", "por litro", "por bolsa", "por global". |
| 5 | "¿Cuántos m³ de cascote lleva cada m²?" se pregunta aunque el nombre del trabajo diga el espesor ("e=8cm", "ESP.=10cm", "e: 4cm"). | El espesor se lee del nombre y la conversión sale resuelta como dato: "Cada m² lleva 0,08 m³ de … (por los 8 cm del nombre)". Sin espesor en el nombre, queda el valor de la regla (10 cm) y se dice "(supuse 10 cm)". |
| 6 | Una coincidencia floja ("membrana líquida" → "pintura en paredes") se muestra como receta propuesta y arrastra sus precios faltantes: la tarjeta sale roja. | Las coincidencias por parecido **nunca** son la receta: la tarjeta queda **amarilla**, "Sin receta: se usa el precio del Excel", con "Quizás sea: …" para elegir con un clic. Solo las reglas y la memoria proponen receta. |
| 7 | Debajo del resumen dice "EDIFICIO LAS HERAS" (la celda A1 del Excel de Ginkgo está mal). | Si el título del Excel no se parece al nombre del archivo: aviso suave "El Excel dice 'EDIFICIO LAS HERAS'. ¿Es la obra correcta?" en ámbar. Si se parece, nada. |

## 2. Servidor (`app/obra_import.py`, `app/routers/obras.py`, `app/budget_prices.py`)

### 2.1 Espesor del nombre (falla 5)
```python
def espesor_m_from(descripcion: str) -> float | None:
    """'CONTRAPISO e=8cm' → 0.08; 'ESP.=10cm' → 0.10; 'e: 4cm' → 0.04; 'E 12 CM' → 0.12. None si no hay."""
```
Regex sobre `plain()`: `\b(?:E|ESP|ESPESOR)\s*[.:=]*\s*(\d+(?:[.,]\d+)?)\s*CM\b`. Las reglas de `MAPEO` que hoy
fijan el factor del contrapiso (`5.2.3` a 0.10, 0.08 y 0.04) pasan a `"espesor": True` y el factor sale del
nombre; si no hay espesor en el nombre, se usa el de la regla (`"factor_defecto"`). `rule_for` lo aplica.
En `_pregunta`, el `dato` dice de dónde salió: `' (por los 8 cm del nombre)'` o `' (supuse 10 cm)'`. Campo
nuevo en `pregunta`: `"origen_valor": "nombre" | "regla" | "memoria" | "mano" | null`.

### 2.2 Las sugerencias no proponen receta (falla 6)
En `_proposal`, se elimina la rama `sugerida`: solo `memoria` y `regla` proponen. `sugerencias` sigue
viniendo (hasta 3) para el "Quizás sea". `receta.origen` ya no puede ser `"sugerida"`; cuando Sol elige
una sugerencia, es `"manual"`. Se borra `SUGGEST_MIN`. Tests: `test_suggestion_until_confirmed` pasa a
verificar que la tarjeta queda amarilla sin receta y con la sugerencia en `sugerencias`.

### 2.3 $0 con fecha es un precio (falla 2)
`PriceBook.price`, `price_problems` (obra_import) y `load_price_lookup`/`discarded_prices` (budget_prices):
un precio `0` cuenta como válido **solo si tiene `fecha_precio`**. Sin fecha, `0` sigue siendo "sin precio"
(así eran los ceros viejos del Maestro). `PATCH /catalogs/{id}/entries/{eid}` ya pone fecha de hoy cuando
cambia el precio; verificar que con `precio_sin_iva: 0` también la ponga. Tests en `test_obras_api`
(`sin_precio` → "Va en $0" → la tarjeta deja de estar roja y el recurso carga con 0) y `test_budget_prices`.

### 2.4 Título del Excel (falla 7)
`analizar` devuelve `"titulo_dudoso": bool`: `True` si `plain(titulo)` y `plain(nombre del archivo sin
extensión)` no comparten ninguna palabra de 4 letras o más (sin "EDIFICIO", "OBRA", "COMPUTO", "PRESUPUESTO",
"CASA", "TORRE"). Ginkgo: título "EDIFICIO LAS HERAS", archivo "EDIFICIO GINKGO_Computo…" → `True`.

### 2.5 Contrato (solo se agrega)
- `tareas[i].pregunta.origen_valor` (2.1).
- `receta.origen` ∈ `memoria | regla | manual` (ya no `sugerida`).
- `titulo_dudoso` arriba de todo.

## 3. Pantalla (`frontend/src/pages/CargarObra.tsx`)
- Falla 1: mover el bloque del panel de precios (el `div` con `ref={panelRef}`) arriba de `<div className="space-y-3">` de las tarjetas, debajo de los filtros. Abierto por defecto si `rojosPrecio > 0`.
- Falla 2: en `PrecioRow`, botón secundario **"Va en $0"** (blanco con borde) que guarda `precio_sin_iva: 0` y `fecha_precio: hoy` (`updateEntry` si existe, `createEntry` si no). `valido` acepta `0` solo por ese botón; el campo sigue pidiendo > 0 para "Guardar".
- Falla 3: debajo de "Cargar presupuesto", frase de estado con `rojosOtros` y `rojosPrecio`: "Te faltan {n} preguntas y {m} precios" / "Faltan {m} precios: cargalos arriba, o marcá 'Cargar igual' y esos materiales van en $0." La casilla "Cargar igual" se muestra siempre que `rojosPrecio > 0`, deshabilitada mientras `rojosOtros > 0`.
- Falla 4: `unidadEnPalabras(u)` en `frontend/src/lib/format.ts`: u/un/unid → "unidad", m2 → "m²", m3 → "m³", m/ml → "metro", kg → "kg", l/lt → "litro", bolsa → "bolsa", gl → "global", otro → tal cual. Placeholder "Precio sin IVA por {palabra}".
- Falla 5: el `dato` ya viene con el paréntesis; nada que hacer salvo mostrarlo.
- Falla 6: `origen === 'sugerida'` desaparece del tipo; el "Quizás sea" ya existe para `receta === null`.
- Falla 7: si `analisis.titulo_dudoso`, aviso ámbar debajo del resumen: "El Excel dice '{titulo}'. ¿Es la obra correcta?" (sin botón: es solo un aviso).
- `api.ts`: `ObraPregunta.origen_valor`, `ObraReceta.origen` sin `'sugerida'`, `ObraAnalisis.titulo_dudoso`.

## 4. Prueba
`scripts/e2e_ginkgo.cjs` con el Excel real: el panel aparece arriba; "Va en $0" en Y-M4X1 saca ese código
de los rojos; la frase de estado cambia; la membrana líquida queda amarilla; el contrapiso de 8 cm sale
"(por los 8 cm del nombre)"; el aviso del título aparece. `pytest` y `npm run build` en verde.
