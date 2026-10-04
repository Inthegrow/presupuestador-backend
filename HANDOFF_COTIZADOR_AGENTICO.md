# Handoff: el cotizador agéntico de TERRAC

> Para el próximo chat. Leer entero antes de tocar código. Fecha: 2026-10-01 (plan maestro: 2026-10-04).
> Lo escribió la sesión que hizo los PRs #19 y #20, con Carlos.

---

## 0. Plan maestro (04/10): un solo chat programa, un PR por vez

Hubo tres chats a la vez y se pisaron en el handoff. Desde hoy: **un solo chat programa** (el que hizo los
PRs #25 y #27). Los PR salen de a uno. Carlos prueba la app como Sol y anota las dudas; cada duda es un bug
de UX y entra a este archivo (sección 5, punto 0c) antes de programarse.

| # | Paso | Quién | Estado |
|---|---|---|---|
| 1 | Mergear el PR #26 (handoff con las fallas de UX) | Carlos | ✅ 04/10 |
| 2 | Render → Manual Deploy del PR #25. En la app, Catálogos → marcar los cuatro del Maestro como oficiales | Carlos | pendiente de confirmar |
| 3 | PR #27 (login con SOLÉ): Codex audita → corregir → mergear → Manual Deploy. La app sigue abierta hasta el paso 5 | chat + Carlos | ✅ 04/10 (mergeado; Manual Deploy pendiente de confirmar) |
| 4 | Las fallas de UX del punto 0c, un solo PR, probado con el Excel de Ginkgo (`PLAN_UX_CARGAR_OBRA.md`) | chat | PR #28 en auditoría |
| 5 | Encender el login: SQL en DATA y en SOLÉ, invitaciones, `VITE_AUTH_ENABLED=true`, borrar `DEMO_ORG_ID` (sección 5 de `PLAN_LOGIN_SOLE.md`) | Carlos guiado por el chat | después del 4 |
| 6 | Primera carga real de Ginkgo con Sol | Sol + Carlos | después del 5 |
| 7 | Etapa B: estado de cada precio y frase de confianza | chat | después del 6 |
| — | Limpieza: borrar las ramas viejas `claude/*` y `codex/*` ya mergeadas en GitHub | Carlos | cuando quiera |

Reglas para no volver a pisarse: el handoff lo edita solo el chat que programa, dentro del PR del trabajo;
Carlos no abre otro chat de programación mientras haya un PR abierto; si abre uno de consulta, le pide que
**no toque el repo**.

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
| **Cierre de la Etapa A** (PR #25): precios que el Excel ya trae (propuestos con un botón, y "Guardar los N"), conversión conocida mostrada como dato, **catálogo oficial** (los demás solo consulta), **"Ver diferencias con el Excel"** trabajo por trabajo | ✅ en PR | `PLAN_ETAPA_A_CIERRE.md` (contrato), `app/obra_import.py` (`excel_prices`), `app/budget_prices.py` (`load_catalog_index`), `app/routers/obras.py` (`/obras/{id}/diferencias`), `frontend/src/pages/DiferenciasExcel.tsx`, `migrations/011` |
| Diseño completo del caso de uso, pantalla por pantalla, con todas las fallas y la política de precios | ✅ documento | `DISENO_CARGAR_OBRA.md` |

El PR #20 se mergeó el 2026-10-01. Falta correr en Supabase las migraciones 009 y 010 (ver Etapa A).

## 5. Qué falta (en el orden que conviene)

### Antes de todo: clave y usuarios, con la estructura multiempresa de SOLÉ
Hoy cualquiera con el link entra y ve todo. Esto va **antes** de cargar obras reales de TERRAC.
Decisión de Carlos: usar **la misma estructura multiempresa de SOLÉ**, no inventar una nueva.

**Estado (04/10): programado en el PR #27** según `PLAN_LOGIN_SOLE.md`: `GET /me`, empresa activa en el
header `X-Org-Id` (403 si no es miembro, 428 si tiene varias y no eligió), roles `admin`/`leader`/`member`
en todas las rutas (`tests/test_auth.py` tiene la tabla ruta → rol y falla si alguien agrega una ruta sin rol),
pantallas "Olvidé mi clave", "Creá tu clave" y "¿Con qué empresa entrás?", selector de empresa en la barra,
botones ocultos para quien solo mira. Probado en el navegador con `scripts/e2e_login.cjs`
(`FAKE_DOS_EMPRESAS=1 python3 scripts/serve_fake.py`). **Lo que falta es operativo** y está en la sección 5
del plan: crear TERRAC en SOLÉ con el `org_id` de la base DATA, invitar a Sol/Emilia/Carlos, poner
`VITE_AUTH_ENABLED=true` en Vercel y **borrar `DEMO_ORG_ID`** en Render. Hasta ese momento la app sigue
abierta (modo demo), con el usuario demo como admin.

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
7. ~~Preguntarle a Carlos los nombres exactos de tablas, columnas y roles que usa SOLÉ~~ **Hecho (03/10):**
   se leyeron del repo `casanchez71/eos-inthegrow-saas` y están, con el contrato completo del login,
   en `PLAN_LOGIN_SOLE.md`. Resumen: `organizations` + `memberships` (roles `admin`/`leader`/`member`),
   `super_admins`, `invitations` + RPC `accept_my_invitations()`, selector de empresa guardado en
   `localStorage`, "olvidé mi clave" con `resetPasswordForEmail`. El `org_id` de TERRAC no está en ningún
   repo: se lee con `SELECT org_id FROM budgets` en la base DATA (sección 5 del plan).

### Etapa A: cerrar la carga de una obra para que Sol la use ya
0. **Lo que enseñó la primera carga real (01/10 y 03/10):** en producción conviven cuatro catálogos con los
   mismos códigos (Maestro + Las Heras + Lugones + Belgrano) y Ginkgo salió con 55 rojos. Se arregló la
   regla de desempate en `find_entry` (PR #23, mergeado y desplegado): gana el precio **vigente a la fecha**
   del presupuesto, después el catálogo más nuevo. Hoy Ginkgo da **85 grupos, 39 verdes, 36 amarillos,
   10 rojos y 14 códigos sin precio**. **Hecho en el PR #25:** catálogo oficial (Catálogos → "Marcar
   como oficial"; los otros quedan solo para consulta y se muestran como referencia cuando falta un
   precio) y la conversión conocida como dato ("Cada m² lleva 0,1 m³ de …" + "cambiar").
   Y Render **no despliega solo** aunque Auto-Deploy esté en "On Commit": revisar la conexión con
   GitHub; mientras tanto, "Manual Deploy → Deploy latest commit" después de cada merge.
   **Después de mergear el #25:** correr `migrations/011` en Supabase ANTES del deploy (si no, cargar
   una obra falla), después en la app marcar los cuatro catálogos del Maestro como oficiales y volver
   a cargar Ginkgo. Con el Excel real, en la prueba local: 14 sin precio → "Guardar los 9 precios que
   trae el Excel" → quedan 5 (EPS-500, SUB-YES-AGARGANTA, Y-L1X1, Y-M4X1, Y-MD200X70), que tampoco
   tienen precio en el Excel de Sol (ver 0b). La app dio +20% contra el Excel; las diferencias grandes
   son cielorrasos (+120%), carpeta (+57%) y grueso interior (+55%): trabajo para Emilia con la pantalla
   "Diferencias con el Excel".
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
   decidir si las recetas del Maestro o las de Sol son las buenas. **Hecho en el PR #25:** cuando el Excel
   trae un precio (hoja de detalle, o listas 00_*) y el catálogo no lo tiene, la pantalla lo **propone**
   ("En tu Excel usaste $200.000 · Guardar ese precio"). Lo que no se puede proponer: EPS-500 (Sol lo
   carga con el código `eps`, no `EPS-500`) y los que están en $0 también en su Excel. Ojo con la lista
   `00_Mat` de Ginkgo: la sección "MATERIALES PINTURA" dice "PRECIO CON IVA" en la columna que la hoja
   llama "sin IVA"; la app propone el valor igual con un aviso en ámbar. Convendría que Sol arregle el
   rótulo en su Excel.
   **Datos para arreglar en la app (Emilia, pantalla Recetas):** hay recetas del Maestro con nombres que
   no se entienden solos ("DE CASCOTE", "GRUESO INTERIOR", "CIELORRASO", "TABIQUES"): en la frase de la
   conversión queda 'Cada m² lleva 0,1 m³ de "De cascote"'. Renombrarlas ("Contrapiso de cascote") es
   un cambio de datos, no de código.
0c. **Fallas de UX vistas en producción el 03/10 (pantalla real con Ginkgo). El PR #25 resolvió la de proponer
   precios; el PR #28 resuelve las seis de abajo más el aviso del título del Excel (`PLAN_UX_CARGAR_OBRA.md`).
   Con eso Ginkgo pasa de 10 a 9 rojos al abrir, y "Va en $0" permite cerrar los perfiles que Sol también tiene en $0:**
   (1) el panel "Precios para corregir" está al final de la página, lejos de las tarjetas; tiene que estar
   a mano. (2) "Guardar" no acepta $0, y hay materiales que legítimamente van en $0 o "no lo cotizo".
   (3) La casilla "Cargar igual" aparece solo cuando no quedan preguntas abiertas, y nada lo explica.
   (4) El cuadro de precio dice "Precio sin IVA por u"; mostrar la unidad en palabras. (5) La pregunta
   de m³ de cascote por m² se puede responder sola con el espesor que dice el nombre del trabajo
   (8 cm = 0,08). (6) La receta propuesta para "membrana líquida" es pintura de paredes; una
   coincidencia floja tiene que mostrarse como duda, no como propuesta.
1. Migraciones **009** y **010** ya corridas en Supabase (verificado 03/10). PRs #20, #21 y #23 mergeados.
   El login (PR #22) está mergeado pero **no exige clave todavía**: ver "Antes de todo".
2. Cargar en la app las recetas (Fase 3) y los catálogos (Fase 1) del Maestro actual, si aún no están.
3. Primera carga real de **Edificio Ginkgo** con Sol al lado (Carlos hace de Sol varias veces antes).
   Anotar cada vez que duda: eso es un bug de UX.
4. ~~**"Ver diferencias con el Excel"**~~ ✅ PR #25: `GET /obras/{budget_id}/diferencias` y la página
   `budgets/:id/diferencias` (botón en el resultado de la carga y en el Editor). Los presupuestos cargados
   antes de la migración 011 no tienen `excel_neto`: la pantalla pide recargar la obra.

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
  Receta (ahora en el repo): bajar de Drive `ginkgo.xlsx` y `maestro.xlsx` a una carpeta (la herramienta
  de Drive devuelve base64; si es grande lo deja en un JSON en disco: `jq -j .content | base64 -d`),
  `EXCEL_DIR=<carpeta> python3 scripts/serve_fake.py` (app con el Maestro + 4 catálogos en memoria,
  puerto 8000), `cd frontend && VITE_AUTH_ENABLED=false npx vite --port 5179`, y
  `EXCEL_DIR=<carpeta> NODE_PATH=/opt/node-tools/node_modules node scripts/e2e_ginkgo.cjs`
  (Playwright con `executablePath: '/opt/pw-browsers/chromium'`). Mirar las capturas en `EXCEL_DIR/shots`.
  Para matar el servidor falso no usar `pkill -f serve_fake` desde un comando que lo relanza (se mata a sí
  mismo): matar por PID.
- **Tests siempre en verde** antes de subir: `python3 -m pytest -q` (hoy 419 passed) y
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

> Leé `HANDOFF_COTIZADOR_AGENTICO.md` (empezá por la sección 0, el plan maestro), `DISENO_CARGAR_OBRA.md`,
> `PLAN_ETAPA_A_CIERRE.md` y `PLAN_LOGIN_SOLE.md` antes de tocar nada. Estado: PRs #20 a #27 mergeados;
> migraciones 009, 010 y 011 corridas; Render desplegado a mano (Auto-Deploy no anda); el Maestro marcado
> como oficial en Catálogos. Yo hago el rol de Sol. Sos el único chat que programa: un PR por vez.
>
> Orden de trabajo: seguí el plan maestro de la sección 0 desde el primer paso que no esté tildado.
> Hoy eso es: (4) las fallas de UX del punto 0c de la sección 5, en un solo PR probado con el Excel de Ginkgo;
> después (5) encender el login guiándome con la sección 5 de `PLAN_LOGIN_SOLE.md`.
>
> Forma de trabajar: vos armás el plan con el contrato (campos exactos), un subagente Opus hace el
> servidor y uno Sonnet la pantalla. Probá en el navegador con el Excel de Ginkgo antes de abrir el PR
> (`scripts/serve_fake.py` + `scripts/e2e_ginkgo.cjs`). Yo mergeo; Codex audita y te paso el veredicto.
> Después de cada merge me recordás "Manual Deploy" en Render. Escribime corto, sin jerga, en castellano
> rioplatense. Lo que Sol dude es un bug de UX.
