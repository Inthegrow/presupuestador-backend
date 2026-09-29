# Diagnóstico y plan: cargar el Excel "Maestro" de TERRAC en el cotizador

> Fecha: 2026-09-29.
> **Fuentes:**
> - La reunión interna "Desarrollo Terrac" del 28/9/2026: Ashu, Ayelén, Carlos y Emilia.
> - El Excel *MODELO DE PRESUPUESTACION RESUMEN* (Drive, carpeta Terrac), con sus 69 solapas analizadas, fórmulas incluidas.
> - El código de este repo.
>
> Visión general del sistema: [`ONBOARDING.md`](ONBOARDING.md).

---

## 0. Resumen

- El relevamiento de Emilia ("el Maestro") ya tiene **el mismo formato que usa el sistema**: cada ítem tiene un análisis de precio unitario con 5 secciones de recursos que toman los precios de 4 catálogos. Por eso la carga es viable y rápida.
- Lo que falta no es la estructura sino **el cálculo**, como dijo Emilia: hacen falta fórmulas, parámetros y variantes por ítem; un desperdicio general editable; y precios con fecha.
- Hay que corregir algunos errores del importador y del motor antes de cargar.
- La estimación es de **unas 50 horas para una beta**, más la certificación de avance como fase 2.

---

## 1. Qué pidió el equipo en la reunión

1. Que el sistema **calcule** el presupuesto a partir de las cantidades que carga el usuario. La lectura automática de planos queda para más adelante.
2. Catálogos de materiales, jornales, equipos y subcontratos **actualizables, con último precio y fecha**.
3. Poder **editar el método de cálculo y los parámetros de cada ítem**.
4. **Variantes** sin multiplicar la complejidad: platea de 10, 15, 20, 30 o 35 cm; con malla o sin malla; puerta de cedro o placa.
5. **Desperdicio** con un valor estándar por defecto, editable en general y por ítem.
6. **Fecha del presupuesto**: mantener los precios de esa fecha y poder actualizarlos a una fecha nueva.
7. Una "skill" que **lea el Excel y lo importe** como plantillas.
8. Fase posterior: **certificación de avance**, para comparar lo hecho contra lo presupuestado y el costo real, y armar el flujo de fondos.
9. Seguridad: hoy el sistema **no tiene clave**.

Próximos pasos acordados:
- Emilia cierra los ítems pendientes con Sol (29/9, 15:00) y Carlos participa.
- Carlos y Ashu auditan el sistema y arman este plan.
- Ayelén centraliza la carpeta y los accesos.

---

## 2. Qué contiene el Maestro

| Solapa | Contenido | Estado |
|---|---|---|
| `Condiciones` | 2 reglas: el desperdicio viene por defecto y es editable; el presupuesto guarda su fecha y se puede actualizar a precios de otra fecha | Son requisitos del sistema |
| `00_Mat` | 311 materiales: código, descripción, unidad, precio con y sin IVA, proveedor, fecha | 27 sin precio y **276 sin fecha** |
| `00_MO` | 4 categorías: MO-CA capataz, MO-PU puntero, MO-OF oficial, MO-AY ayudante | Completo |
| `00_Eq` | 27 equipos | 4 sin fecha |
| `00_Sub` | 64 subcontratos (pintura, durlock…) | 4 sin precio y 13 sin fecha |
| `CYP` | El árbol estándar: rubros 1 a 9, con unos 100 ítems y las columnas de la cascada (directo, indirecto, beneficio, neto) | **Las fórmulas están rotas (`#REF!`)**: no se conectan con las solapas de ítems |
| `4.1.1` … `8.4` y `AGREGADO` | **62 análisis de precio unitario** con **515 recursos** | Ver 2.1 |

Cada solapa de ítem tiene:
- En la fila 3, el título, la **cantidad maestra** (celda `H3`) y la unidad.
- Las secciones **MATERIALES**, **MANO DE OBRA - PERSONAS**, **MANO DE OBRA - EQUIPOS**, **MANO DE OBRA - MATERIALES** y **MANO DE OBRA - SUBCONTRATOS**.
- Por cada recurso: código (que busca descripción y precio en el catálogo con BUSCARV), cantidad (con fórmula), desperdicio, `REDONDEAR.MAS(cantidad × (1 + desperdicio))`, precio y subtotal.

Esto equivale uno a uno a `item_resources.tipo`: `material`, `mano_obra`, `equipo`, `mo_material` y `subcontrato`.

### 2.1 Cómo están escritas las cantidades (515 recursos)

| Tipo | Cantidad | Ejemplo | Qué implica para el sistema |
|---|---|---|---|
| Fórmula proporcional a la cantidad maestra | **224** | `=H3*0.2`: m³ de hormigón H30 por m² de platea de 20 cm | Se convierte directo en un coeficiente por unidad |
| Otra fórmula (variables auxiliares) | **61** | `=(0.2*0.7)*M4` (M4 = metros lineales de viga) · `=(H3*4.73)/25` (kg a bolsas) | Hacen falta **parámetros por ítem** |
| Número fijo | **230** | 206 barras de Φ6 · "ref cómputo hierros La Lucila" · 3 oficiales × 20 días | Muchos son **de una obra puntual** y no un estándar. Hay que revisarlos con Emilia y Sol |

### 2.2 Problemas del Excel a limpiar

1. **REDONDEAR.MAS sobre la cantidad de ejemplo.** Pasa en las 24 solapas que tienen cantidad = 1: se redondea a unidades enteras de compra por cada unidad del ítem. Ejemplo: `7.4.1` pintura de cielorraso da **$265.949 por m²**, porque cobra un balde entero de 20 L por cada m². El redondeo tiene que aplicarse sobre el total de la obra, no sobre el precio unitario.
2. **La mano de obra está en días fijos** de una obra de ejemplo: `4.1.1` tiene 1 capataz, 3 oficiales y 1 ayudante × 20 días para 194 m². Hay que expresarla como **rendimiento**, como ya hace `5.1.1` con `días = H3/15` (15 m² por día por pareja).
3. **Errores de copiar y pegar:**
   - `5.1.4` a `5.1.6` dicen "PORTANTE" pero son de ladrillo hueco.
   - `4.2.4` es una copia de `4.2.2`.
   - `7.4.1` y `7.4.2` son iguales.
   - `4.1.4`, `4.1.6` y `4.2.3` no tienen título ni cantidad.
   - Excel convirtió algunos códigos de ítem en fechas (`5.1.1` quedó como 05/01/2001).
4. **Códigos de recurso problemáticos:**
   - Duplicados en el catálogo: `SUB-PI`, `HADN6K` a `HADN25K`, `INOD`, `D-FIJ`, `D-BUN`.
   - Mayúsculas distintas (`Lh18`/`LH18`, `mo-ay`/`MO-AY`): Excel las da por iguales, el sistema no.
   - Códigos que no existen en el catálogo: `pil`, `rp-zoc`, `sub-YES-PARED`, `eps-500`.
5. **Ítems del CYP sin solapa o pendientes:**
   - Rubros 1 (preliminares), 2 (movimiento de suelo), 3 (demolición), 7-2 ventanas, 7-3 puertas y 9 cubierta.
   - `AGREGADO` (no se sabe qué es).
   - Las celdas en rojo, como la aislación hidrófuga.
   - Los rubros 4-3 a 4-5 dicen "replicar por piso": eso lo resuelve el sistema con los pisos.

---

## 3. Qué tiene el sistema frente a lo que se pidió

| Requisito | Estado | Detalle en el código |
|---|---|---|
| 4 catálogos | ✅ | `catalog_entries.tipo`, con CRUD y carga de CSV (`app/routers/catalogs.py`) |
| Precio **con fecha** e historial | ❌ | `catalog_entries` no tiene columna de fecha ni historial |
| Plantillas por ítem | 🟡 | `item_templates.recursos` (JSONB) con `cantidad_por_unidad` fijo. Sin fórmulas ni parámetros |
| Editar el método de cálculo | ❌ | — |
| Variantes paramétricas | ❌ | Cada variante sería una plantilla distinta |
| Desperdicio por defecto y editable | 🟡 | Editable por recurso (`desperdicio_pct`). No hay valor general ni herencia |
| Cascada de indirectos, beneficio, impuestos e IVA | ✅ | `calc_cascade_indirects`; coincide con las columnas del CYP |
| Rubros por piso | ✅ | Árbol con `parent_id` y vista por piso |
| Fecha del presupuesto y actualizar precios | ❌ | Hay `budget_versions` (fotos), pero sin fecha de precios |
| Importar el Maestro como plantillas | ❌ | `excel.py` importa **presupuestos** con el formato `01_C&P` y lee valores, no fórmulas |
| Certificación de avance | ❌ | — |
| Login | ❌ | Desactivado (`VITE_AUTH_ENABLED`, `DEMO_ORG_ID`) |

### 3.1 Errores confirmados que afectan la carga

| Archivo | Error | Efecto |
|---|---|---|
| `app/routers/excel.py` (`_parse_detail_sheets`) | Busca "MATERIALES" y "MANO DE OBRA" antes que "EQUIPO" o "SUBCONTRAT" | "MO – Materiales" queda como `material`. "MO – Equipos" y "MO – Subcontratos" quedan como `mano_obra`. **Tres de las 5 secciones quedan mal clasificadas** |
| `app/routers/excel.py` (`_parse_detail_sheets`) | Guarda el desperdicio como fracción (0,1), pero el motor lo divide por 100 | Un 10% queda en 0,1% |
| `app/routers/excel.py` | Ignora la columna Días de la MO | Los jornales quedan mal |
| `app/calculations.py` (`calc_cascade_indirects`) | Usa `float(config.get(...) or 3)` | **No se puede poner 0%**: un beneficio de 0 pasa a ser 10% |
| `app/routers/templates.py` (`apply_template`) | Busca el precio por `codigo` distinguiendo mayúsculas, sin filtrar catálogo, y toma la primera coincidencia | Con duplicados trae un precio al azar |
| `tests/test_api.py` | Falla `test_get_indirects_defaults` | 85 de 86 tests en verde |

---

## 4. Diseño propuesto

**Plantillas con fórmulas y parámetros**

```jsonc
// item_templates (ejemplo: 4.1.1 Platea con hierro)
{
  "codigo": "4.1.1", "nombre": "Platea de fundación con hierro", "unidad": "m2",
  "parametros": [
    {"clave": "espesor",    "valor": 0.20, "unidad": "m"},
    {"clave": "ml_vigas",   "valor": 0,    "unidad": "ml"},
    {"clave": "ancho_viga", "valor": 0.70, "unidad": "m"}
  ],
  "recursos": [
    {"tipo": "material", "codigo": "H30", "formula": "Q * espesor", "desperdicio_pct": 10},
    {"tipo": "material", "codigo": "H30", "formula": "espesor * ancho_viga * ml_vigas", "desperdicio_pct": 10},
    {"tipo": "material", "codigo": "A-NY200100m2", "formula": "Q / 100", "desperdicio_pct": 10, "redondear": true},
    {"tipo": "mano_obra", "codigo": "MO-OF", "trabajadores": 3, "rendimiento": "Q / 10"}
  ]
}
```

- `Q` es la cantidad del ítem en el presupuesto. Los parámetros tienen un valor por defecto y se pueden cambiar en cada presupuesto.
- Así, una platea de 15, 20 o 30 cm es **una sola plantilla**.
- Las fórmulas se evalúan con un evaluador seguro que solo admite aritmética y variables, **nunca `eval` libre**.
- Los números fijos se importan con la marca `revisar: true`.

**Desperdicio:** hay un valor general de la organización (en `indirect_config` o una tabla nueva de condiciones). La plantilla lo puede sobrescribir y el presupuesto también. En la pantalla se ve el valor heredado y se puede editar.

**Redondeo:** se aplica solo a los recursos marcados `redondear` y sobre la cantidad total de la obra, no sobre el precio unitario.

**Precios con fecha:**
- Se agregan `catalog_entries.fecha_precio` y una tabla `catalog_price_history (entry_id, precio_sin_iva, fecha)`.
- El presupuesto guarda `precios_al` (fecha). Cada recurso guarda el precio con el que se calculó.
- "Actualizar a [fecha]" toma el último precio igual o anterior a esa fecha, recalcula y guarda una versión nueva.

**Árbol estándar:** el CYP se carga como un árbol de TERRAC (rubros, subrubros e ítems enlazados con su plantilla). Un presupuesto nuevo se arma eligiendo ítems de ese árbol y cargando sus cantidades por piso.

---

## 5. Plan de trabajo

| Fase | Entregable | Horas aprox. |
|---|---|---|
| **0. Seguridad y base** | Activar el login y crear usuarios de TERRAC. Separar datos demo de reales. Arreglar el `or` de la cascada y el test que falla | 5 |
| **1. Catálogos con fecha** | Migración con fecha e historial. Importar `00_Mat`, `00_MO`, `00_Eq` y `00_Sub` con precio sin IVA, fecha y proveedor. Unificar mayúsculas y listar duplicados | 6 |
| **2. Plantillas con fórmulas** | Parámetros, fórmulas, evaluador seguro, herencia del desperdicio, redondeo al total, MO por rendimiento. Pantalla de edición de fórmulas y parámetros | 14 |
| **3. Importador del Maestro** | Script o endpoint que lee las 62 solapas. Traduce `H3` a `Q` y las celdas auxiliares a parámetros. Carga el CYP como árbol estándar. Genera un **informe de problemas por ítem** | 10 |
| **4. Presupuesto por fecha** | `precios_al` y el botón "Actualizar precios a…" que guarda una versión nueva | 6 |
| **5. Prueba con obra real** | Recrear *Edificio Las Heras* cargando solo cantidades y comparar ítem por ítem contra el Excel. Las diferencias muestran lo que falta parametrizar | 6 |
| **Total beta** | | **~47 h** |
| 6. (posterior) Certificación | Avance por ítem y piso, certificado contra costo real, flujo de fondos | 15–20 |

Orden sugerido:
1. Las fases 0 y 1 no dependen de nada.
2. La fase 3 puede generar el informe de problemas **antes** de terminar la 2, para que Emilia y Sol corrijan el Excel en paralelo.

---

## 6. Decisiones para cerrar con Emilia y Sol

1. **Hierros y encofrados:** ¿hay una regla estándar (kg por m³ según el elemento, placas por m²) o siempre sale del cómputo del estructuralista de cada obra?
2. **Rendimientos de mano de obra por ítem** (m² por día por cuadrilla), en lugar de días fijos.
3. **Qué variantes se parametrizan** (espesor de platea, con malla o sin malla, tipo de ladrillo) y **cuáles son plantillas distintas** (tipos de abertura).
4. **Alcance de la beta:** ¿solo obra gris (rubros 1 a 5 y aislaciones)?
5. Cerrar los ítems en rojo, `AGREGADO` y los rubros sin solapa (1, 2, 3, 7-2, 7-3 y 9).
6. Resolver los códigos duplicados del catálogo y definir la fecha de los 276 materiales que no la tienen.
