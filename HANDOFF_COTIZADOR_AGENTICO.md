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

## 4. Qué hay hecho (rama `main` + PR #20)

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

### Etapa A: cerrar la carga de una obra para que Sol la use ya
1. Correr en Supabase las migraciones **009** y **010** (SQL Editor, idempotentes). El PR #20 ya está mergeado.
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
14. Login y usuarios (hoy desactivado).
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

> Leé `HANDOFF_COTIZADOR_AGENTICO.md` y `DISENO_CARGAR_OBRA.md`. Arrancá por la Etapa A: el PR #20 ya está mergeado;
> confirmá que corrieron las migraciones 009 y 010 y hacé el punto 4 ("Ver diferencias con el Excel") con un plan de
> contrato, un subagente Opus para el servidor y uno Sonnet para la pantalla. Probá en el navegador con el
> Excel de Ginkgo antes de abrir el PR. Escribime corto y sin jerga.
