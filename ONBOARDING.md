# Presupuestador SOLE — Guía para el equipo

> Punto de entrada único para entender el sistema: qué es, dónde vive, cómo se levanta, cómo está hecho y en qué estado está.
> Última actualización: 2026-09-29.
> Para el análisis del Excel "Maestro" de TERRAC y el plan de trabajo, ver [`DIAGNOSTICO_MAESTRO_TERRAC.md`](DIAGNOSTICO_MAESTRO_TERRAC.md).

---

## 1. Qué es

App web para **cómputo y presupuesto de obras de construcción**, desarrollada por Inthegrow / INSPIRING para **TERRAC SA** (marca SOLE).

Flujo:
1. Se crea un presupuesto (obra) con rubros, subrubros e ítems, que se pueden separar por piso.
2. Cada ítem tiene un **análisis de precio unitario**: los recursos que lo componen se agrupan en 5 tipos (materiales, MO personas, MO equipos, MO materiales y subcontratos).
3. Los precios salen de **catálogos** (materiales, mano de obra, equipos y subcontratos).
4. El sistema aplica la **cascada**: Directo → Indirectos → Beneficio → Impuestos → IVA → Total.
5. El presupuesto se exporta a PDF o Excel para el cliente.

Hay además dos funciones con IA (GPT-4o) para leer planos y generar ítems. El cliente dijo que **no son prioridad**: prefiere cargar las cantidades a mano.

---

## 2. Dónde está todo

| Qué | Dónde |
|---|---|
| Código (backend y frontend en el mismo repo) | https://github.com/Inthegrow/presupuestador-backend (rama `main`) |
| Frontend en producción | https://presupuestador-sole.vercel.app/app (Vercel) |
| Backend en producción | https://presupuestador-backend-adm1.onrender.com (Render, plan **free**) |
| Salud del backend | `GET /health` |
| Documentación automática de la API | `GET /docs` (Swagger de FastAPI) |
| Base de datos y login | Supabase (ver sección 5) |
| Excel "Maestro" de TERRAC (relevamiento de Emilia) | Drive → carpeta Terrac → *MODELO DE PRESUPUESTACION RESUMEN* |

> ⚠️ **El login está desactivado** (`VITE_AUTH_ENABLED` no está en `true`): cualquiera con el link entra. El backend atiende las llamadas sin token con la organización de `DEMO_ORG_ID` (`app/auth.py`). No cargar datos sensibles hasta activarlo.
> ⚠️ En el plan free, Render apaga el backend cuando nadie lo usa: la primera llamada tarda entre 30 y 60 segundos.

---

## 3. Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.11 · FastAPI · Pydantic · supabase-py · pandas/openpyxl · ReportLab (PDF) · PyMuPDF · OpenAI |
| Frontend | React 19 · Vite 6 · TypeScript · Tailwind 4 · React Router · supabase-js |
| Base de datos | Supabase (Postgres con RLS por `org_id`) |
| Deploy | Render (backend, deploy automático con push a `main`) · Vercel (frontend, **deploy manual**) |

---

## 4. Estructura del repo

```
app/
  main.py            # FastAPI + CORS + routers
  config.py          # Variables de entorno (pydantic-settings)
  auth.py            # Valida el JWT de Supabase → {user_id, org_id}
  db.py              # Dos clientes Supabase: auth (EOS) y data (presupuestador)
  calculations.py    # Motor de cálculo puro (recursos → unitarios → cascada)
  tree.py            # Árbol de ítems (parent_id) y helpers numéricos
  schemas.py         # Modelos Pydantic
  routers/
    budgets.py       # CRUD de presupuestos, ítems y recursos
    catalogs.py      # CRUD de catálogos, carga de CSV, aplicar catálogo a un presupuesto
    templates.py     # Plantillas de ítems (análisis de precio reutilizables)
    analysis.py      # Indirectos, recálculo en cascada, resumen
    excel.py         # Importar Excel de obra y exportar Excel/PDF
    ai.py            # Plano (imagen/PDF) → ítems con GPT-4o
    architect.py     # Análisis arquitectónico multi-paso (experimental)
    health.py
frontend/src/
  pages/             # Dashboard, Editor, ItemDetail, Catalogs, Templates, MarkupChain,
                     # Analysis, AIPlans, NewProject, ImportExcel, Export, Versions, Login
  components/        # layout (Sidebar, AppLayout) y ui (DataTable, CostSummaryBar…)
  lib/api.ts         # Cliente HTTP (VITE_API_URL, o /api por proxy en desarrollo)
  lib/supabase.ts    # Cliente de Supabase para el login
migrations/          # SQL a correr a mano en Supabase: 001, 002, 003 (en orden)
seed_data/           # Obras de ejemplo (Las Heras, Lugones, El Encuentro) en JSON/CSV
seed_database.py     # Carga los seed_data en Supabase
tests/               # pytest (106 tests)
```

Rutas del frontend: `/app/dashboard`, `/app/new-project`, `/app/import`, `/app/budgets/:id/{editor|analysis|ai|export|versions}`, `/app/budgets/:id/item/:itemId`, `/app/settings/markups`, `/app/catalogs`, `/app/templates`.

---

## 5. Base de datos (Supabase, "Modelo C")

La app usa **dos proyectos de Supabase**:

| Cliente | Variables | Para qué |
|---|---|---|
| Auth (compartido con EOS) | `AUTH_SUPABASE_URL` / `AUTH_SUPABASE_KEY` | Login, usuarios, memberships, organizaciones. Proyecto `yytuhddgqughemkevbni` |
| Data | `DATA_SUPABASE_URL` / `DATA_SUPABASE_KEY` | Presupuestos, ítems, catálogos. El proyecto concreto está en las variables de entorno de Render |

Si las variables `AUTH_*` y `DATA_*` no están cargadas, las dos conexiones usan `SUPABASE_URL` / `SUPABASE_KEY`.

**Tablas principales** (todas llevan `org_id`):

| Tabla | Contenido |
|---|---|
| `budgets` | La obra o presupuesto: nombre, estado (draft, review, approved, sent) |
| `budget_items` | El árbol de rubros e ítems (`parent_id`): código, descripción, unidad, cantidad, unitarios y todos los totales de la cascada |
| `item_resources` | Recursos de cada ítem. `tipo` puede ser `material`, `mano_obra`, `equipo`, `mo_material` o `subcontrato`. Tiene cantidad, desperdicio %, precio, subtotal y, para MO, trabajadores, días y cargas % |
| `price_catalogs` / `catalog_entries` | Catálogos y sus entradas: código, descripción, unidad, precio con IVA y sin IVA, referencia |
| `item_templates` | Plantillas reutilizables: `recursos` en JSONB, con `cantidad_por_unidad`, `trabajadores_por_unidad`, `dias_por_unidad` y `desperdicio_pct` |
| `indirect_config` | Porcentajes por organización: imprevistos, estructura, jefatura, logística, herramientas, beneficio, IIBB, impuesto al cheque, IVA |
| `budget_versions` | Fotos del presupuesto en JSON |
| `item_audits` / `audit_logs` | Historial de ediciones manuales |

---

## 6. Motor de cálculo (`app/calculations.py`)

```
Recurso (material / equipo / mo_material / subcontrato):
  cantidad_efectiva = cantidad × (1 + desperdicio%/100)
  subtotal          = cantidad_efectiva × precio_unitario
Recurso mano_obra:
  cantidad_efectiva = trabajadores × días × (1 + cargas%/100)
  subtotal          = cantidad_efectiva × jornal

Ítem:
  mat_unitario = Σ materiales / cantidad
  mo_unitario  = Σ (MO + equipos + MO materiales + subcontratos) / cantidad
  directo      = (mat_unitario + mo_unitario) × cantidad

Cascada (los porcentajes se guardan como números enteros: 15 = 15%):
  Subtotal 02 = Directo × (1 + imprevistos + estructura + jefatura + logística + herramientas)
  Subtotal 03 = Subtotal 02 × (1 + beneficio)
  Neto        = Subtotal 03 × (1 + IIBB + imp. cheque)
  Total final = Neto × (1 + IVA)
```

Al aplicar una plantilla a un ítem (`POST /templates/{id}/apply/{budget}/items/{item}`), cada `cantidad_por_unidad` se multiplica por la cantidad del ítem y el precio se busca en `catalog_entries` por `codigo`.

---

## 7. Cómo levantarlo en tu computadora

Requisitos: **Python 3.11**, **Node 20** o más nuevo y git.

```bash
git clone https://github.com/Inthegrow/presupuestador-backend.git
cd presupuestador-backend

# Backend → http://localhost:8000 (Swagger en /docs)
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # completar con las claves (pedírselas a Carlos)
uvicorn app.main:app --reload --port 8000

# Frontend → http://localhost:5173/app  (en otra terminal)
cd frontend
cp .env.example .env.local        # completar
npm install
npm run dev
```

En desarrollo, el frontend llama a `/api/...` y Vite lo redirige a `localhost:8000` (ver `frontend/vite.config.ts`).

**Tests:** `pytest -q` (106 tests, todos en verde).

**Claves:** nunca se suben al repo ni se mandan por mail. Se pasan por un gestor de contraseñas.

**Base de datos propia para desarrollar sin tocar producción:**
1. Crear un proyecto nuevo en Supabase.
2. Correr `migrations/001_base.sql`, `002_item_audits.sql` y `003_unit_analysis.sql` en el SQL Editor.
3. Correr `python seed_database.py`.

> `run_npm.py` y `frontend-launch.json` tienen rutas de la Mac de Carlos. Se pueden ignorar.

---

## 8. Deploy

| Parte | Cómo |
|---|---|
| Backend | Automático: un push a `main` hace que Render reconstruya (`render.yaml`). Las variables de entorno se cargan en el panel de Render |
| Frontend | **Manual:** `cd frontend && npx vercel deploy --prod`. Variables en Vercel: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_ENABLED` |
| Base de datos | Las migraciones nuevas se corren a mano en el SQL Editor de Supabase |

Regla acordada con Carlos (ver `ACUERDOS_CON_CARLOS.md`): **publicar siempre después de cada arreglo**, haciendo merge, push y deploy en Vercel.

---

## 9. Accesos que necesita una persona nueva

1. **GitHub:** invitación a la organización Inthegrow o como colaboradora del repo, con permiso Write.
2. **Supabase:** Team → Invite, con rol Developer, en los dos proyectos (auth y data).
3. **Render:** Workspace settings → Members.
4. **Vercel:** el equipo del proyecto. En el plan Hobby no se pueden sumar miembros: hay que pasar a Pro o mover el proyecto a un equipo.
5. **OpenAI:** una API key propia, solo si va a tocar las funciones de IA.
6. **El archivo `.env`**, por un gestor de contraseñas.

---

## 10. Estado actual

**Versión:** 3.1.1 (ver `CHANGELOG.md`). Último cambio de código: 2026-04-16.

**Funciona:**
- CRUD de presupuestos, ítems y recursos, con árbol por rubro y piso y vistas por Rubro, Piso, Material y Gremio.
- Catálogos con carga de CSV, búsqueda y edición.
- 12 plantillas de TERRAC.
- Cadena de markups con 9 porcentajes.
- Recálculo automático al editar.
- Importación de Excel de obra y exportación a PDF y Excel.
- IA para leer planos (experimental).

**Corregido en la Fase 0:** se pueden poner porcentajes en 0% en la cascada; el importador de Excel ahora clasifica bien las 5 secciones, toma los días de la mano de obra y convierte el desperdicio de fracción (0,1) a porcentaje (10).

**Pendientes conocidos** (el detalle y la priorización están en `DIAGNOSTICO_MAESTRO_TERRAC.md`):
- Login desactivado.
- Los precios de los catálogos no tienen fecha ni historial, así que no se puede "actualizar el presupuesto a precios de hoy".
- Las plantillas solo aceptan coeficientes fijos: no hay fórmulas, parámetros ni variantes.
- No hay un desperdicio general por defecto.
- No hay módulo de certificación de avance.

---

## 11. Guion de demo (unos 15 minutos)

**Antes de la reunión:**
- Abrir `/health` del backend para despertarlo.
- Tener a mano un plano en PDF real y un presupuesto ya cargado como plan B.

| # | Pantalla | Qué mostrar |
|---|---|---|
| 1 | — | Contexto: el presupuesto que hoy lleva semanas en Excel sale en minutos, con los precios de la empresa |
| 2 | Mis Presupuestos | Tarjetas, buscador y estados |
| 3 | + Nuevo Presupuesto → IA + Planos | Subir el plano y ver cómo se generan los ítems con recursos y precios |
| 4 | Editor de Obra | Árbol, vistas por Rubro, Piso, Material y Gremio. Editar una cantidad y ver que se recalcula |
| 5 | Detalle de Item | Las 5 secciones de recursos → **Cargar template** "Hormigón H-30 columnas" |
| 6 | Cadena de Markups | Cambiar el beneficio y guardar |
| 7 | Catálogos | Buscar un material y editar su precio |
| 8 | Análisis | KPIs y resumen por sección |
| 9 | Exportar | Bajar el PDF o el Excel para el cliente |

No mostrar el login (está desactivado) y no borrar datos: los de producción son los mismos.
Checklist detallado de revisión: `MANUAL_REVISION_SOLE.md`.

---

## 12. Mapa de la documentación del repo

| Documento | Para qué sirve |
|---|---|
| **`ONBOARDING.md`** (este) | Visión general y cómo arrancar |
| **`DIAGNOSTICO_MAESTRO_TERRAC.md`** | Análisis del Excel Maestro, brechas del sistema y plan de trabajo (sept. 2026) |
| `ARQUITECTURA.md` | Arquitectura del backend v2.1, endpoints y reglas (abril 2026) |
| `ARQUITECTURA_PLATAFORMA.md` | Capas universal, sector y cliente de SOLE, y el modelo comercial |
| `ACUERDOS_CON_CARLOS.md` | Reglas de trabajo y decisiones acordadas |
| `CHANGELOG.md` | Historial de versiones |
| `MANUAL_REVISION_SOLE.md` | Checklist pantalla por pantalla para revisar la app |
| `INSTRUCTIVO_EJEMPLO_COMPLETO.md` | Ejemplo completo de un presupuesto de punta a punta |
| `PLAN_FLUJO_AUTOMATICO.md` | Plan original (abril) del flujo plano → presupuesto |
| `EXCEL_DATA_EXTRACTION_REPORT.md` | Análisis de los Excel de obras anteriores (Las Heras y otras) |
| `AVANCE_2026-04-05.md`, `BRIEFING_PARA_AGENTE.md`, `AUDITORIA_*` | Notas históricas de sesiones de desarrollo |
