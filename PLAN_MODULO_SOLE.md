# Plan: módulo "Presupuestador" en SOLÉ (paso 5b del plan maestro)

> Fecha: 2026-10-05. Dos PR, uno por repo. Origen: Carlos, 05/10: "¿podría ser un módulo en SOLÉ que lo habilite,
> ahora sólo a TERRAC, y desde ahí ingresen a la app nueva?".

## 0. Lo que ya existe (leído en el repo y en la base de SOLÉ, 05/10)

- SOLÉ (`casanchez71/eos-inthegrow-saas`) tiene módulos por empresa con tres tablas: `cfg_modules` (catálogo),
  `cfg_plan_entitlements` (qué trae cada plan) y `cfg_org_module_overrides` (encendido/apagado por empresa, con
  historial en `cfg_org_module_override_events`). La RPC `get_org_effective_modules(p_org_id)` resuelve: override de
  la empresa > lo que trae su plan > apagado, y solo módulos con `is_active`.
- La pantalla de administración de SOLÉ (`src/components/admin/FeatureFlags.jsx` y `SuiteManager.jsx`) lista los
  módulos desde esa RPC y prende/apaga por empresa. Un módulo nuevo en `cfg_modules` aparece ahí solo.
- El menú de SOLÉ sale de `src/platform/moduleCatalog.ts` (fuente de verdad: ruta, `featureKey`, roles, sección).
  El módulo "Talento" (`supabase/migrations/20260615140000_talento_module_governance.sql`) es el modelo: registrado
  en `cfg_modules`, apagado en los 4 planes, se enciende por empresa.
- La suite "Growth" de SOLÉ ya dice en su descripción "CRM, seguimiento comercial, presupuestador".
- El presupuestador ya lee `?org=<id>` de la URL al entrar (`AuthContext.tsx`, `urlOrg`) y elige esa empresa.
- Usuarios y claves son los mismos en las dos apps (mismo proyecto de Supabase). Cada app guarda su propia sesión
  en su dominio: la primera vez hay que poner mail y clave en el presupuestador; después queda la sesión.

## 1. Qué cambia, para Sol y para Carlos

| Hoy | Después |
|---|---|
| Para entrar al presupuestador hay que saber la dirección. | En el menú de SOLÉ, sección **Crecer**, aparece **Presupuestador** (solo en las empresas que lo tienen encendido). Abre una pantalla corta con un botón **Abrir el Presupuestador** que lo abre en otra pestaña, ya en esa empresa. |
| Carlos ve sus 9 empresas en el selector del presupuestador. | El presupuestador muestra solo las empresas con el módulo encendido. Hoy: Terrac. |
| Cualquier miembro de cualquier empresa de SOLÉ puede entrar (ve su empresa vacía). | Si ninguna de sus empresas tiene el módulo: "Tu empresa no tiene el Presupuestador habilitado. Pedíselo al administrador de SOLÉ." |
| No hay dónde encenderlo. | SOLÉ → Configuración → módulos de la empresa → **Presupuestador**: se prende y apaga como Talento. |

## 2. PR A: presupuestador (`Inthegrow/presupuestador-backend`) — Render: Manual Deploy SÍ

### 2.1 Servidor (`app/auth.py`, tests en `tests/test_auth.py`)
- Constante `MODULE_KEY = "presupuestador"` y `NO_MODULE = "Tu empresa no tiene el Presupuestador habilitado.
  Pedíselo al administrador de SOLÉ."`.
- `_fetch_orgs(user_id)`: después de leer membresías y empresas (sumar `plan` al select de `organizations`),
  filtrar las empresas con el módulo encendido:
  1. Leer `cfg_modules` con `key = MODULE_KEY`. **Si no hay fila: no se filtra** (transición: el PR se puede
     desplegar antes de correr la migración de SOLÉ). Si hay fila con `is_active = false`: ninguna empresa lo
     tiene. **Si cualquiera de las tres lecturas da error: 503** "No pudimos verificar el acceso al
     Presupuestador. Probá de nuevo en un rato." (corrección de Codex sobre el PR #33, hecha en el #34).
  2. `cfg_org_module_overrides` con `module_key = MODULE_KEY` e `org_id in (...)`.
  3. `cfg_plan_entitlements` con `module_key = MODULE_KEY` (todas las filas: son 4).
  4. Encendido = override de la empresa si existe, si no lo que trae su plan, si no apagado. (Misma regla que
     `get_org_effective_modules`; se replica en Python porque la RPC exige `auth.uid()` y el servidor lee con la
     llave de servicio.)
- La lista que devuelve `_fetch_orgs` tiene solo las empresas encendidas. Si el usuario tenía membresías pero
  ninguna encendida, `resolve_org` tiene que decir `NO_MODULE` (403), no `NO_MEMBERSHIP`. Para eso `_fetch_orgs`
  devuelve también si hubo membresías (por ejemplo, `load_orgs` devuelve `(orgs, tenia_membresias)` o una
  excepción propia; elegir lo más simple sin romper el caché de 60 s: el caché guarda la lista ya filtrada).
- `X-Org-Id` de una empresa sin el módulo: 403 `NOT_YOUR_ORG` como hoy (no está en la lista).
- Modo demo (`DEMO_ORG_ID`, sin token) no cambia.
- La FakeDB de tests y `scripts/serve_fake.py` no tienen `cfg_*`: sin filas → no se filtra → todo igual que hoy.
- Tests nuevos en `tests/test_auth.py`: sin fila en `cfg_modules` no se filtra; con módulo y override true para A y
  false para B → solo A; sin override, plan `pro` con entitlement true → encendida, plan `trial` false → apagada;
  `is_active false` → ninguna; usuario con membresías pero ninguna encendida → 403 con `NO_MODULE` en `/me`;
  `X-Org-Id` de una empresa apagada → 403. `python3 -m pytest -q` todo verde; `ruff check app/auth.py tests/test_auth.py`.

### 2.2 Pantalla
- `frontend/src/contexts/AuthContext.tsx`: el 403 con el texto `NO_MODULE` se muestra en el login como hoy se
  muestra `NO_MEMBERSHIP` (ya usa el `detail` del servidor; verificar que pase el texto).
- `frontend/src/pages/Login.tsx`: si la URL trae `?org=`, debajo del título: "Entrá con el mismo mail y clave de
  SOLÉ." (si ya lo dice, nada). Verificar que `?org=` sobreviva al login (el `AuthProvider` lo toma al montar).
- e2e: `scripts/e2e_login.cjs` suma: con `FAKE_DOS_EMPRESAS=1`, entrar a `/login?org=<id de Obra Demo>` (o la
  ruta que redirija al login) y verificar que después de entrar la barra muestra esa empresa sin pasar por el
  selector. Si el e2e de login no corre sin Supabase real, documentarlo y verificar a mano con el servidor falso.

## 3. PR B: SOLÉ (`casanchez71/eos-inthegrow-saas`, rama `claude/modulo-presupuestador`) — Vercel solo

Seguir las reglas del repo de SOLÉ (`CLAUDE.md`, `AGENTS.md`, `REGLAS.md`, `ESTANDAR_UI_SOLE.md`,
`CLAUDE_AUDIT_GUARDRAILS.md`): leerlas antes de tocar nada.

- Migración nueva `supabase/migrations/<fecha>_presupuestador_module_governance.sql`, calcada de la de Talento:
  `cfg_modules ('presupuestador', 'growth', 'Presupuestador', 'Presupuestos de obra con recetas y listas de
  precios (app aparte, misma clave)')`, `cfg_plan_entitlements` en false para trial/basic/pro/enterprise, todo con
  `ON CONFLICT DO NOTHING`. **Sin** encender ninguna empresa en la migración (eso se hace desde la administración).
- `src/platform/moduleCatalog.ts`: módulo `key: 'presupuestador'`, `suite: 'growth'`, `route: 'presupuestador'`,
  `featureKey: 'presupuestador'`, `roles: []`, `navSection: 'Crecer'`, `navOrder` después de Seguimiento Comercial,
  `label: 'Presupuestador'`, `icon: Calculator` (ya importado), `importFn: () => import('../pages/Presupuestador')`.
  Si `useModuleEntitlements` necesita el nombre en `ALL_MODULES` o en `FeaturesResult` para que `isEnabled` lo vea,
  sumarlo; si `isEnabled` ya es genérico, no tocar.
- `src/pages/Presupuestador.(tsx|jsx)` (seguir la extensión y el estilo de las páginas vecinas, `ESTANDAR_UI_SOLE.md`):
  título "Presupuestador", una línea "Presupuestos de obra con las recetas y la lista de precios de la empresa.
  Se abre en otra pestaña.", botón primario **Abrir el Presupuestador** = enlace `target="_blank" rel="noopener"` a
  `${import.meta.env.VITE_PRESUPUESTADOR_URL || 'https://presupuestador-sole.vercel.app'}/login?org=${org.id}`, y
  debajo, chico: "La primera vez entrás con el mismo mail y clave de SOLÉ." Sin abrir solo (los navegadores
  bloquean ventanas que no salen de un clic).
- Tests: los que tenga el repo para el catálogo de módulos (si hay uno que cuenta módulos o compara con
  `cfg_modules`, actualizarlo). Correr la suite de tests y el build del repo según su `CLAUDE.md`.

## 4. Puesta en marcha (Carlos, después de mergear los dos)

1. Render: Manual Deploy del PR A. (Sin la migración, el presupuestador no filtra: todo sigue igual.)
2. SOLÉ: la migración del PR B en el SQL Editor de SOLÉ (`yytuhddgqughemkevbni`), o como SOLÉ corra sus
   migraciones. Desde ese momento, **ninguna empresa** entra al presupuestador hasta encenderlo.
3. Enseguida: SOLÉ → Configuración → módulos de **Terrac SA** → encender **Presupuestador**. (O en SQL:
   `INSERT INTO cfg_org_module_overrides (org_id, module_key, enabled, reason) VALUES
   ('ea998891-d7cd-416c-a8cf-ca93a2962167', 'presupuestador', true, 'Alta del Presupuestador')
   ON CONFLICT (org_id, module_key) DO UPDATE SET enabled = true;`)
4. Probar: en SOLÉ, dentro de Terrac, aparece Presupuestador en Crecer; el botón abre el presupuestador en Terrac.
   En el presupuestador, Carlos ve solo Terrac en el selector.

## 5. Fuera de este plan
- Entrar sin volver a poner la clave (un clic desde SOLÉ). Necesita una función del servidor de SOLÉ que genere un
  enlace de ingreso de un solo uso (Supabase `generateLink`) y que Carlos la despliegue con la consola de Supabase.
  Compartir la sesión de SOLÉ por la URL no sirve: las dos apps se pisarían la renovación de la sesión y SOLÉ se
  cerraría sola.
- Paso 5c (leer las empresas con la clave del usuario en vez de la llave de servicio).
