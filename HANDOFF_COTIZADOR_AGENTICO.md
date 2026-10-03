# Handoff: el cotizador agéntico de TERRAC

> Para el próximo chat. Leer entero antes de tocar código. Fecha: 2026-10-01.
> Lo escribió la sesión que hizo los PRs #19 y #20, con Carlos.

---

## 1. La ambición, en una frase

Esta app va a ser **el cotizador agéntico más famoso y funcional del mundo de la construcción**.
No es "un sistema para cargar presupuestos": es un equipo de agentes que hace el trabajo pesado y le deja
a la arquitecta solo las decisiones. La vara es: **hacer un presupuesto tiene que sentirse como un juego
que se gana en 20 minutos**, no como una planilla que se sufre en dos días.

Todo lo que se construya se mide contra esto:
1. ¿Sol lo entiende sin que nadie se lo explique?
2. ¿Le ahorra trabajo o se lo agrega?
3. ¿La app hace primero y pregunta después, o pregunta primero y hace después? (Tiene que ser lo primero.)

## 2. Quién usa la app

- **Sol** (arquitecta, TERRAC) y su equipo: suben cantidades, revisan, aprueban. **No saben códigos** y no
  tienen por qué saberlos. Hablan de "muro de ladrillo hueco", no de "5.1.4".
- **Emilia**: hizo el Maestro (las recetas). Las mantiene en la app, pantalla Recetas.
- **Carlos**: dueño del producto. Define indirectos, decide qué va y qué no. Habla simple y quiere
  respuestas simples. **Escribirle corto, sin jerga.**
- **Codex**: auditor automático de los PRs. Comenta con semáforo (verde/amarillo/rojo). Siempre audita el
  head que le indiques; si audita uno viejo, decírselo en el PR y pedir re-auditoría del head correcto.

## 3. Los principios de experiencia (no negociables)

1. **La app propone, Sol confirma.** Nunca una pantalla vacía esperando que Sol sepa qué poner.
2. **Palabras, no códigos.** Recetas por nombre ("Ladrillo cerámico hueco del 18"), materiales por nombre.
   El código, si aparece, va chico y gris.
3. **Semáforo en todo lo que pide decisión.** Verde listo, amarillo confirmar, rojo resolver. Y la frase
   del juego: "Te faltan 3 para terminar".
4. **Una decisión, una vez.** Lo que se repite (el mismo muro en 8 pisos) se decide una sola vez. Lo que
   Sol decidió hoy, la app lo recuerda mañana.
5. **Preguntas en castellano de obra.** "¿Cuántos m³ de hormigón tiene cada base?" Nunca "factor de
   conversión", "plantilla", "template", "cascada", "asignación".
6. **Nunca un número mentiroso en silencio.** Si falta un precio, la app usa el último conocido y lo marca
   como viejo; si fuerza $0, lo dice arriba del total. Cada total lleva su "confianza": "92% de los
   precios al día".
7. **El Excel es solo la entrada de cantidades.** Recetas y precios viven en la app. El Excel Maestro se
   retiró.
8. **Nada queda a medias.** Si algo falla, no se guarda nada y se dice qué pasó, en una frase.
9. **Guardar y seguir después.** La carga en curso vive en la app, no en la pestaña de Sol.
10. **Botones en infinitivo, una acción por botón, y la acción principal siempre a la derecha.**

## 4. Qué hay hecho (rama `main`, PRs #20 a #23)

| Pieza | Estado | Dónde |
|---|---|---|
| Catálogos con precio, fecha, proveedor e historial (Fase 1) | ✅ | `app/catalog_prices.py`, `migrations/004` |
| Recetas con fórmulas, parámetros, desperdicio heredado, redondeo de compra (Fase 2) | ✅ | `app/recipes.py`, `app/formulas.py`, `migrations/005` |
| Importar el Maestro: 61 recetas + árbol estándar (Fase 3) | ✅ | `import_recetas.py`, `app/maestro_recipes.py`, `migrations/006-007` |
| Indirectos por obra, "Actualizar precios a hoy", versiones (Fase 4) | ✅ | `app/budget_prices.py`, `app/routers/analysis.py`, `migrations/008` |
| Script de carga de una obra con SQL (Fase 5, superado por el PR #20) | ✅ mergeado (#19) | `import_obra.py` |
| Leer la hoja de cómputo, agrupar trabajos por descripción + unidad, cruce con recetas, conversión de unidades explícita, sugerencias por nombre | ✅ | `app/obra_import.py` |
| **Pantalla "Cargar una obra"**: subir, revisar con semáforo, cargar. Memoria de recetas. | ✅ mergeado (#20) | `frontend/src/pages/CargarObra.tsx`, `app/routers/obras.py`, `migrations/009-010` |
| Diseño completo del caso de uso, pantalla por pantalla, con todas las fallas y la política de precios | ✅ documento | `DISENO_CARGAR_OBRA.md` |

El PR #20 se mergeó el 2026-10-01. Falta correr en Supabase las migraciones 009 y 010 (ver Etapa A).

## 5. Qué falta (en el orden que conviene)

### Antes de todo: clave y usuarios, con la estructura multiempresa de SOLÉ
Hoy cualquiera con el link entra y ve todo. Esto va **antes** de cargar obras reales de TERRAC.
Decisión de Carlos: usar **la misma estructura multiempresa de SOLÉ**, no inventar una nueva.

1. **Login con usuario y clave** usando el Supabase de auth compartido con SOLÉ/EOS (`AUTH_SUPABASE_*`):
   tablas `organizations` y `memberships`. Cada usuario pertenece a una o más empresas (`org_id`).
2. **Cada empresa ve solo lo suyo.** Todas las tablas ya tienen `org_id` y `app/auth.py` ya lo resuelve
   desde `memberships`. Revisar que **todas** las rutas usen `get_current_user` y filtren por `org_id`.
3. **Usuario con varias empresas:** hoy `app/auth.py` toma la primera membresía (`limit(1)`). Hay que
   dejar elegir la empresa (selector arriba, como en SOLÉ) y mandar la elegida en cada pedido.
4. **No perder los datos actuales:** crear la empresa TERRAC en SOLÉ con el **mismo `org_id` que hoy
   tiene `DEMO_ORG_ID`** en Render. Después crear los usuarios (Sol, Emilia, Carlos…) y sus membresías.
5. **Encender:** `VITE_AUTH_ENABLED=true` en Vercel (y publicar el frontend) y **borrar `DEMO_ORG_ID`**
   en Render. Probar que sin clave no se ve nada.
6. La pantalla de login ya existe (`frontend/src/pages/Login.tsx`). Sumar "Olvidé mi clave".
7. **Preguntarle a Carlos** los nombres exactos de tablas, columnas y roles que usa SOLÉ antes de
   programar. No suponerlos.

### Etapa A: cerrar la carga de una obra para que Sol la use ya
0. **Lo que enseñó la primera carga real (01/10 y 03/10):** en producción conviven cuatro catálogos con los
   mismos códigos (Maestro + Las Heras + Lugones + Belgrano) y Ginkgo salió con 55 rojos. Se arregló la
   regla de desempate en `find_entry` (PR #23, mergeado y desplegado): gana el precio **vigente a la fecha**
   del presupuesto, después el catálogo más nuevo. Hoy Ginkgo da **85 grupos, 39 verdes, 36 amarillos,
   10 rojos y 14 códigos sin precio**. Queda por hacer bien: **marcar un catálogo como oficial** en la
   app y dejar los viejos solo para consulta. También: la pregunta de conversión aparece aunque la app
   ya sepa la respuesta (0,1 m³ por m²); mostrarla como dato resuelto, no como pregunta abierta.
   Y Render **no despliega solo** aunque Auto-Deploy esté en "On Commit": revisar la conexión con
   GitHub; mientras tanto, "Manual Deploy → Deploy latest commit" después de cada merge.
0b. **Los 14 sin precio y cómo los resolvió Sol en su Excel.** En la hoja `00_Mat` del Excel de Ginkgo
   esos códigos están **sin precio**. Sol los cargó a mano dentro de las hojas de detalle (5.2-6, 5.1-3,
   5.2-2, 5.2-4, 4.9-2). Valores que usó, sin IVA: RE-PLI20 (látex interior 20 l) 200.000 · RE-END15
   (enduido) 60.000 · RE-LIJ220 700 · RE-LIJ150 800 · RE-CIN 6.859 · RE-FIJ 57.190 · RE-PINC25 3.000 ·
   RE-PINC15 2.500 · RE-ROD 10.000 · EPS-500 (placa 30 mm) 10.000 · yeso 13.900. Para cielorrasos Sol
   usó RE-CLI20 (látex cielorraso) a 140.000, pero la receta del Maestro usa RE-PLI20. Los perfiles
   **Y-M4X1, Y-L1X1 e Y-MD200X70 están en $0 también en el presupuesto de Sol**, y **SUB-YES-AGARGANTA**
   no existe en su Excel (la receta 7.4.x del Maestro usa masilla D-MAS + subcontrato SUB-PI; Sol usó
   enduido RE-END y sin subcontrato). O sea: la app no puede dar el mismo total que el Excel de Sol sin
   que alguien cargue esos precios en el catálogo (el panel "corregir" de la pantalla lo permite) y sin
   decidir si las recetas del Maestro o las de Sol son las buenas. Idea para la Etapa B: cuando el Excel
   trae un precio en la hoja de detalle y el catálogo no lo tiene, **proponerlo** ("Sol usó 200.000, ¿lo
   guardo?") en vez de pedirlo en blanco.
1. Migraciones **009** y **010** ya corridas en Supabase (verificado 03/10). PRs #20, #21 y #23 mergeados.
   El login (PR #22) está mergeado pero **no exige clave todavía**: ver "Antes de todo".
2. Cargar en la app las recetas (Fase 3) y los catálogos (Fase 1) del Maestro actual, si aún no están.
3. Primera carga real de **Edificio Ginkgo** con Sol al lado. Anotar cada vez que duda: eso es un bug de UX.
4. **"Ver diferencias con el Excel"**: tabla trabajo por trabajo, ordenada por la diferencia mayor. Hay que
   guardar `excel_neto` por ítem al cargar. Es lo que Emilia y Sol necesitan para afinar recetas.

### Etapa B: precios que no mienten
5. **Estado de cada precio** (al día / viejo / muy viejo / estimado / sin precio) con umbrales en
   Configuración (30 y 90 días). Módulo nuevo `app/precio_estado.py`.
6. **Frase de confianza** arriba de cada presupuesto: "Precios al 01/10 · 92% al día · 6% viejos".
7. **Pantalla 3 "Precios"** del flujo: estado del catálogo, subir lista nueva con resumen amable
   ("Actualicé 311 materiales; 2 repetidos para resolver"), o seguir con los que hay.
8. **Índice de la construcción** por mes (CAC/INDEC) para traer a hoy un precio muy viejo, marcado
   "estimado por índice" hasta que Sol confirme.

### Etapa C: la app como equipo de agentes
9. **Agente de recetas**: ante un trabajo sin receta, propone la más parecida y explica por qué en una
   línea. Ya hay una base sin IA (`suggest_recipes`); sumarle un modelo cuando el parecido sea bajo.
10. **Agente de precios**: botón "Buscar precio", busca en sitios de proveedores, propone precio con link a
    la fuente, Sol acepta. Nunca se guarda solo.
11. **Agente calculista**: subir el plano y producir el mismo cómputo que el Excel (rubros, pisos,
    trabajos, cantidades), para que entre por la pantalla 2 como si fuera un Excel. Hoy existe
    "IA + Planos" como borrador en `app/routers/ai.py` y `frontend/src/pages/AIPlans.tsx`.
12. **Borrador de carga** (guardar y seguir después): tabla `obra_cargas` con el archivo y las decisiones.
13. **Recargo por piso**: el m² del 6º no cuesta lo mismo que el del 1º (subir materiales). Un % por piso
    en la obra. Pedido de Carlos.

### Etapa D: producto
14. Login y usuarios: ver "Antes de todo" arriba. Va primero.
15. Certificación de avance (fase posterior del diagnóstico original).

## 6. Cómo trabajar (lo que funcionó)

- **Un plan con el contrato exacto** entre pantalla y servidor antes de programar
  (`/tmp/.../PLAN_CARGAR_OBRA.md` fue el de esta vez; escribir uno nuevo por etapa, en el repo).
- **Dos subagentes en paralelo**: uno **Opus** para el servidor (donde están los casos finos que Codex
  encuentra), uno **Sonnet** para la pantalla. El orquestador integra, no programa.
- **Probar de punta a punta en el navegador** con el Excel real de Ginkgo antes de pedir auditoría.
  Receta: `scratchpad/serve_fake.py` levanta la app con los datos del Maestro en una base en memoria
  (puerto 8000), `vite --port 5179` con `VITE_AUTH_ENABLED=false`, y Playwright con
  `executablePath: '/opt/pw-browsers/chromium'`. Mirar las capturas.
- **Tests siempre en verde** antes de subir: `python3 -m pytest -q` (hoy 386 passed) y
  `cd frontend && npm run build`. `ruff check` sobre los archivos tocados (el repo tiene errores viejos en
  otros archivos; no arreglarlos en el mismo PR).
- **Commits chicos, en castellano simple**, con el "por qué" en el cuerpo. Un PR por etapa.
- **Codex**: responderle punto por punto en el PR, con el commit y el test que cierra cada hallazgo, y pedir
  re-auditoría del head exacto.
- **A Carlos**: corto, sin jerga, con la decisión que necesita de él al final. Si algo no se entiende,
  reformular en menos palabras, no en más.

## 7. Datos útiles

- Excel de Ginkgo: Drive, "EDIFICIO GINKGO_Computo y Presupuesto_V2" (la celda A1 dice "EDIFICIO LAS
  HERAS"; es un error del Excel). Hoja de cómputo: `01_C&P`. 244 trabajos, 30 pisos/partes, 85 trabajos
  distintos. Con el Maestro actual: 39 listos, 35 para confirmar, 11 rojos (todos por precio).
- Excel Maestro: Drive, "MODELO DE PRESUPUESTACION RESUMEN". 61 recetas. Códigos sin precio que frenan
  Ginkgo: `EPS-500`, `RE-*` (pintura), `SUB-YES-AGARGANTA`, `Y-L1X1`, `Y-M4X1`, `Y-MD200X70`.
  Duplicados en el catálogo: `SUB-PI`, `D-FIJ`.
- Dos sugerencias dudosas quedaron a propósito en amarillo (Carlos las aceptó así): membrana líquida como
  "pintura 3 manos" y texturado como "fino exterior". Sol decide.
- Migraciones pendientes de correr en Supabase si no se corrieron: 008 (Fase 4), 009 y 010 (PR #20).
- Documentos de referencia, en orden: `DIAGNOSTICO_MAESTRO_TERRAC.md` (origen de todo),
  `DISENO_CARGAR_OBRA.md` (el caso de uso detallado), `ONBOARDING.md` (visión del sistema), este archivo.

## 8. Primer mensaje sugerido para el próximo chat

> Leé `HANDOFF_COTIZADOR_AGENTICO.md` y `DISENO_CARGAR_OBRA.md` antes de tocar nada. Estado: PRs #20, #21,
> #22 y #23 mergeados; migraciones 009 y 010 corridas; Render desplegado a mano (Auto-Deploy no anda).
> Ginkgo en producción da 85 grupos, 10 rojos y 14 códigos sin precio (sección 5, punto 0b, dice cómo los
> resolvió Sol). Yo voy a hacer el rol de Sol varias veces antes de dársela a ella.
>
> Orden de trabajo:
> 1. **Precios que el Excel ya trae**: si la hoja de detalle del Excel tiene un precio y el catálogo no,
>    la pantalla lo propone ("Sol usó $200.000, ¿lo guardo?") en vez de pedirlo en blanco. Y la pregunta
>    de conversión que la app ya sabe responder (0,1 m³ por m²) se muestra como dato, no como pregunta.
> 2. **Catálogo oficial**: marcar uno como oficial y dejar los otros tres solo para consulta.
> 3. **"Ver diferencias con el Excel"** (Etapa A, punto 4): trabajo por trabajo, ordenado por la diferencia
>    mayor, para comparar lo que da la app contra lo que estimó Sol.
> 4. Recién después: login que exija clave con la estructura multiempresa de SOLÉ (preguntame tablas y roles).
>
> Forma de trabajar: vos armás el plan con el contrato (campos exactos), un subagente Opus hace el
> servidor y uno Sonnet la pantalla. Probá en el navegador con el Excel de Ginkgo antes de abrir el PR.
> Yo mergeo; Codex audita y te paso el veredicto. Después de cada merge me recordás "Manual Deploy" en
> Render. Escribime corto, sin jerga, en castellano rioplatense. Lo que Sol dude es un bug de UX.
