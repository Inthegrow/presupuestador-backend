# Diseño: hacer un presupuesto en la app, paso a paso

> Fecha: 2026-10-01. Para quien lo implemente (próximo chat, con subagentes).
> Base: `DIAGNOSTICO_MAESTRO_TERRAC.md`, PRs #19 y #20, y las charlas con Carlos.
> Escrito para que lo lea gente no técnica. La parte técnica está al final.

---

## 0. La idea en una frase

Sol sube las **cantidades** de la obra y la app hace el resto: pone las **recetas**, busca los **precios**,
calcula y le muestra qué falta. Nunca tiene que saber un código de memoria. Hacer un presupuesto tiene que
sentirse como completar un juego: una barra de avance, un semáforo y "te faltan 3 para terminar".

## 1. Qué sube cada uno y qué vive en la app

| Qué | Quién | Cómo entra | Dónde vive |
|---|---|---|---|
| **Cantidades de la obra** (m², m³, ml, unidades, por piso) | Sol y su equipo | Excel de cómputo, el de siempre. Solo la hoja de cómputo (`01_C&P`). **No** hace falta subir las solapas de recetas. Más adelante: cargar a mano en la app, o subir el plano y que un agente calcule. | En el presupuesto |
| **Recetas** (qué lleva cada trabajo) | Emilia (y Sol cuando corrige) | Ya están cargadas desde el Maestro. Se editan en la pantalla **Recetas** de la app. El Excel Maestro se retira. | En la app |
| **Precios** (materiales, jornales, equipos, subcontratos) | Sol | Lista de precios en Excel, cada tanto (misma planilla `00_Mat`, `00_MO`, `00_Eq`, `00_Sub`) o uno por uno en la app. | En la app, con fecha e historial |
| **Indirectos y beneficio** (%) | Carlos / Sol | Pantalla Cadena de Markups. Generales, y por obra. | En la app |

Regla: **la app es la única fuente**. Si algo se corrige, se corrige en la app y queda para la próxima obra.

## 2. El gran tema: los precios

Hoy el sistema frena si falta un precio, o lo pone en $0 si Sol lo fuerza. Las dos son malas:
frenar traba la carga; $0 da un presupuesto mentiroso. La propuesta es que **siempre haya un precio**,
y que la app diga **qué tan confiable es**.

### 2.1 Cada precio tiene fecha y un estado

| Estado | Qué significa | Cómo se muestra |
|---|---|---|
| **Al día** | Tiene menos de 30 días | Verde, sin aviso |
| **Viejo** | Tiene entre 30 y 90 días | Amarillo: "precio de hace 2 meses" |
| **Muy viejo** | Más de 90 días | Rojo: "precio de marzo, actualizalo" |
| **Estimado** | Lo puso la app por índice o por IA, Sol no lo confirmó | Violeta: "estimado, confirmá" |
| **Sin precio** | No hay nada | Rojo: hay que resolverlo antes de cargar |

Los días se pueden cambiar en Configuración (30 / 90 por defecto).

### 2.2 Qué pasa cuando falta un precio, en orden

La app prueba estas opciones, en este orden, y le dice a Sol cuál usó:

1. **Último precio conocido**, aunque sea viejo. Se usa y se marca "viejo" o "muy viejo". Es lo que hace hoy "Actualizar precios".
2. **Actualizar por índice.** Si el precio es muy viejo, la app ofrece traerlo a hoy con el índice de la construcción (CAC o INDEC, cargado por mes en Configuración). Queda como "estimado por índice" hasta que Sol lo confirme. Simple y sin internet.
3. **Buscar en internet con IA.** Botón "Buscar precio": un agente busca el material en sitios de proveedores, propone un precio con el enlace a la fuente, y Sol acepta o cambia. Nunca se guarda solo. Es un paso posterior, cuando lo anterior funcione.
4. **Sol lo escribe.** Un campo, un número, listo. Queda en el catálogo con fecha de hoy.

Nunca $0 en silencio. Si Sol decide seguir con precios faltantes, el presupuesto muestra arriba:
**"Este presupuesto tiene 3 materiales sin precio ($0): el total está incompleto."**

### 2.3 Cuándo subir la lista de precios

- La app muestra en Inicio: "Precios actualizados hace 12 días" y cuántos están viejos.
- Al empezar una obra, el paso 3 le pregunta si quiere subir una lista nueva. Si dice que no, sigue con los que hay.
- Subir una lista nueva **no borra** nada: agrega una fecha nueva a cada código. El historial queda.

### 2.4 Qué devuelve el presupuesto sobre sus precios

Una línea arriba del total: **"Precios al 01/10/2026 · 92% al día · 6% viejos · 2% estimados"**.
Y el botón **"Actualizar precios a hoy"** que ya existe (Versiones), que guarda la versión anterior.

## 3. El caso de uso, pantalla por pantalla

Barra de avance arriba, siempre visible: **1 Obra · 2 Cantidades · 3 Precios · 4 Revisar · 5 Listo**.
Cada paso termina con un botón grande "Siguiente". Se puede volver atrás. Se puede **guardar y seguir después**:
la carga en curso queda en la app, no en la computadora de Sol.

### Pantalla 1: la obra

Pide: **nombre** de la obra. Opcional: dirección, cliente, nota.
Muestra: "Precios al día de hoy (01/10/2026)". Se puede cambiar la fecha si el presupuesto es a otra fecha.

Fallas y respuesta:
- Nombre repetido → "Ya hay una obra con ese nombre. ¿Es la misma? Abrir / Poner otro nombre".
- Fecha futura → "La fecha no puede ser futura".

### Pantalla 2: las cantidades

Tres formas, en tres tarjetas grandes:
- **Subir el Excel de cómputo** (la de hoy). Texto: "El cómputo que hacés siempre. Solo usamos la hoja de cantidades; lo demás lo ignora."
- **Cargar a mano**: elegir rubros y trabajos del árbol estándar (TERRAC - Maestro), poner cantidad por piso. Para obras chicas o para arreglar algo.
- **Subir el plano** (futuro, gris): "Pronto: un agente calcula las cantidades desde el plano".

Al soltar el Excel la app lo lee y muestra un resumen en una frase:
**"Encontré 5 rubros, 30 pisos o partes y 244 trabajos. Total del Excel: $2.155 M."**
Debajo, lo que corrigió sola, en gris: "El código 4.8-6.2 estaba en el piso 4.7: lo acomodé. Un trabajo sin unidad: le puse m² como a los otros pisos."

Fallas y respuesta:
- No es Excel / está roto → "No pude abrir el archivo. Tiene que ser .xlsx."
- No tiene la hoja de cómputo → "No encuentro la hoja de cantidades (01_C&P). ¿Es el archivo correcto?"
- Hoja vacía o sin cantidades → "La hoja está vacía o no tiene cantidades."
- Códigos convertidos en fechas por Excel → se arreglan solos, se avisa en gris.
- Trabajo sin unidad → se toma la de los otros pisos; si no hay, queda rojo en el paso 4 con la pregunta "¿En qué unidad está este trabajo?".
- Misma descripción con unidades distintas (ml y m³) → son dos trabajos distintos; se avisa.
- Cantidad 0 o vacía → se carga en 0 y se avisa: "7 trabajos tienen cantidad 0: no suman".
- Cantidad negativa o texto → rojo en el paso 4: "Cantidad inválida en 4.2.3".
- El título del Excel dice otra obra (A1 = "EDIFICIO LAS HERAS") → aviso suave: "El Excel dice 'EDIFICIO LAS HERAS'. ¿Es la obra correcta?" con "Sí, seguir".
- El Excel tiene precios propios → se guardan solo para **comparar** al final; no se usan para calcular.

### Pantalla 3: los precios

Muestra el estado del catálogo en una tarjeta:
**"Tenés 406 precios. 92% al día · 25 viejos · 8 muy viejos · 13 sin precio."**
Botones: **"Subir lista de precios nueva"** y **"Seguir con los que hay"**.

Si sube una lista: resumen "Actualicé 311 materiales, 4 jornales, 27 equipos, 64 subcontratos. 9 códigos nuevos. 2 repetidos para resolver."

Fallas y respuesta:
- Columnas que no se entienden → "No encuentro la columna de precio en la hoja 00_Mat. Tiene que decir Precio, Costo o Precio sin IVA."
- Código repetido en la lista → "D-FIJ aparece 2 veces con precios distintos: ¿cuál vale?" (elige uno).
- Precio 0 o vacío → se ignora esa fila y se avisa: "27 filas sin precio: no las cargué".
- Sin fecha en la lista → "¿De qué fecha son estos precios?" (por defecto hoy).
- Código que no existe en el catálogo → se agrega como nuevo, se avisa.
- Mayúsculas distintas (`Lh18` / `LH18`) → se unifican solas.

Este paso se puede saltar. Los faltantes se resuelven en el paso 4, trabajo por trabajo.

### Pantalla 4: revisar (el corazón)

Arriba: **"244 trabajos. 60 listos · 10 para confirmar · 14 para resolver."** y la frase del juego:
**"Te faltan 14 para poder cargar."** Barra de avance que se llena a medida que resuelve.

Filtros: **Para resolver · Para confirmar · Listos · Todos.** Por defecto, los dos primeros.

Lista de tarjetas, **una por trabajo distinto** (lo que se repite en los pisos se decide una vez):

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ● Para confirmar                                                           │
│ MURO DE MAMPOSTERIA EN LADRILLO HUECO DEL 18. h 3m                         │
│ 8 veces · 1.928 m² · en el Excel $15,6 M                                   │
│                                                                            │
│ Receta: Ladrillo cerámico hueco del 18                   [Confirmar] [Cambiar] │
│ porque: coincide la descripción                                            │
│ Altura de la pared: 3 m (la saqué del nombre del trabajo)   [cambiar]      │
└────────────────────────────────────────────────────────────────────────────┘
```

Lo que puede pasar en una tarjeta, y qué ve Sol:

| Situación | Color | Qué ve | Qué hace |
|---|---|---|---|
| Receta clara, precios al día | Verde | "Listo" | Nada |
| La app propuso una receta parecida, no está segura | Amarillo | "Quizás sea: Buña perimetral. Se parece por 'buña'." | Confirmar o Cambiar |
| Ya la usó en otra obra | Verde | "Ya la usaste así en Las Heras" | Nada (puede cambiar) |
| Sin receta | Amarillo | "No tengo receta para esto. Se carga con el precio del Excel." | Elegir receta, o dejarlo así |
| Sin receta y el Excel no traía precio | Rojo | "No tengo receta ni precio. Elegí una receta o escribí un precio por m²." | Elegir / escribir |
| Unidad distinta (receta en m³, trabajo en unidades) | Rojo | "¿Cuántos m³ de hormigón tiene cada base?" + campo | Escribir el número |
| La receta tiene un dato que cambia por obra (altura, espesor) | Verde o Amarillo | "Altura: 3 m (la saqué del nombre)" / "¿Qué espesor tiene la platea?" | Confirmar o escribir |
| La receta tiene una duda escrita por Emilia | Amarillo | "¿Es hueco o portante?" | Elegir |
| Falta un precio de la receta | Rojo | "Falta el precio de EPS-500 (placa de telgopor)" + campo + "Buscar precio" | Escribir / buscar / usar el último |
| Precio viejo | Amarillo | "El cemento tiene precio de marzo" | Actualizar / seguir |
| Código repetido en el catálogo | Rojo | "Hay 2 'SUB-PI' con precios distintos: ¿cuál vale?" | Elegir uno |
| Cantidad inválida | Rojo | "La cantidad de 4.2.3 no es un número" | Corregir |
| Dos recetas juntas (telgopor + contrapiso) | Verde | "Placas EPS + Contrapiso de cascote (8 cm)" | Nada |

Cambiar receta: un buscador. "Buscá como hablás: revoque, pintura, contrapiso…". Lista por rubro, con
nombre y unidad. El código no se ve, o se ve chico en gris. Al elegir, si la unidad no coincide, aparece
la pregunta de conversión en palabras.

Todo lo que Sol decide **se recuerda** para la próxima obra. Y todo lo que corrige de precios **queda en
el catálogo**.

Fallas del sistema en este paso:
- Faltan recetas en la app (nunca se cargó el Maestro) → pantalla entera: "Todavía no hay recetas cargadas. Pedile a Emilia que cargue el Maestro." No se puede seguir.
- Se cortó internet / el servidor → "No pude revisar. Reintentar." Sin perder lo hecho.
- Sol cierra la pestaña → la carga queda guardada como borrador; al volver, "Seguir con Edificio Ginkgo (te faltan 6)".

### Pantalla 5: listo

Botón grande **"Armar el presupuesto"**. Habilitado solo sin rojos. Si quedan amarillos: "Podés cargar igual; quedan 4 para confirmar".

Mientras calcula: "Calculando 244 trabajos y 1.100 materiales…" (2 a 10 segundos).

Resultado:
```
EDIFICIO GINKGO                              Precios al 01/10/2026 · 92% al día
Costo directo                 $1.482 M
Indirectos y beneficio        $  702 M   (Cadena de Markups de esta obra)
Total                         $2.184 M        En el Excel: $2.155 M  (+1,3%)

Avisos: 3 materiales con precio viejo · 2 trabajos sin receta (precio del Excel)
[Abrir el presupuesto]  [Ver diferencias con el Excel]  [Cargar otra obra]
```

"Ver diferencias con el Excel": tabla trabajo por trabajo, ordenada por la diferencia más grande. Eso
es exactamente lo que necesitan Emilia y Sol para ajustar las recetas.

Fallas:
- Error a mitad de la carga → no queda nada a medias (ya está así), y "Algo falló al armar el presupuesto. No se guardó nada. Reintentar."
- Total muy distinto al Excel (más de 20%) → aviso: "El total da 35% más que tu Excel. Mirá las diferencias antes de usarlo."

### Después

- **Cadena de Markups**: ajustar indirectos y beneficio de esta obra.
- **Versiones**: "Actualizar precios a hoy" cuando pase el tiempo.
- **Exportar**: Excel y PDF.
- **Recetas**: Emilia corrige una receta y, con "Recalcular obra", el presupuesto se actualiza.

## 4. Pendientes que quedaron anotados (no van ahora)

1. **Recargo por piso**: el m² de pared del 6º no cuesta lo mismo que el del 1º (subir materiales). Un % por piso en la obra, que multiplica la mano de obra o el total del trabajo. Pedido de Carlos.
2. **Calculista con IA**: subir el plano y que un agente calcule las cantidades por piso. Hoy existe "IA + Planos" como borrador; hay que llevarlo a producir el mismo cómputo que el Excel (rubros, pisos, trabajos, cantidades) para que entre por la pantalla 2 como si fuera un Excel.
3. **Buscar precio en internet** con IA (punto 2.2.3).
4. **Índice de la construcción** por mes (punto 2.2.2).
5. **Certificación de avance** (fase posterior del diagnóstico).
6. **Login y usuarios** (hoy desactivado).

## 5. Qué ya existe y qué falta (para el que lo implemente)

| Pieza | Estado | Dónde |
|---|---|---|
| Leer la hoja de cómputo, agrupar trabajos por descripción + unidad | Hecho | `app/obra_import.py` |
| Cruce automático con recetas, conversión de unidades, preguntas | Hecho | `app/obra_import.py` (`MAPEO`, `rule_for`) |
| Sugerir recetas parecidas por nombre | Hecho | `app/obra_import.py` (`suggest_recipes`) |
| Memoria de recetas por trabajo | Migración hecha, servidor en curso | `migrations/009`, `app/routers/obras.py` |
| Revisar y cargar desde la app (semáforo) | En curso (PR #20) | `app/routers/obras.py`, `frontend/src/pages/CargarObra.tsx` |
| Precios con fecha e historial, último precio a una fecha | Hecho (Fase 1 y 4) | `app/budget_prices.py`, `app/catalog_prices.py` |
| Subir lista de precios en Excel | Hecho, falta el resumen amable y los repetidos | `app/routers/catalogs.py` (`upload-excel`) |
| Indirectos por obra, actualizar precios, versiones | Hecho (Fase 4) | `app/routers/analysis.py` |
| Estado de cada precio (al día / viejo / muy viejo / estimado) | Falta | nuevo: `app/precio_estado.py` + umbrales en `indirect_config` |
| Frase de confianza en el presupuesto ("92% al día") | Falta | `analysis.py` + Editor |
| Índice de la construcción por mes | Falta | nueva tabla `indices_construccion` |
| Buscar precio con IA | Falta | `app/routers/ai.py` |
| Pantallas 1, 2 (a mano), 3 y 5 con "Ver diferencias" | Falta | frontend |
| Borrador de carga (guardar y seguir después) | Falta | nueva tabla `obra_cargas` con archivo + decisiones |
| Comparación trabajo por trabajo con el Excel | Falta | guardar `excel_neto` por ítem al cargar; endpoint y pantalla |

Orden sugerido para el próximo chat:
1. Terminar PR #20 (pantalla 4 y 5 básicas) y mergear.
2. Estado de precios + frase de confianza + pantalla 3.
3. Borrador de carga + pantalla 1 y 2 completas.
4. "Ver diferencias con el Excel".
5. Índice, IA de precios, recargo por piso.

Reparto que funcionó en este chat: un plan con el contrato exacto (`PLAN_CARGAR_OBRA.md`), un agente
Opus para el servidor, uno Sonnet para la pantalla, y una prueba de punta a punta en el navegador con el
Excel real de Ginkgo antes de pedir la auditoría.
