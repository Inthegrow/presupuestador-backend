# Plan: login con clave, con la estructura multiempresa de SOLÉ

> Fecha: 2026-10-03. Contrato para el PR que sigue al #25. Lo que no está acá, no se programa.
> Todo lo de SOLÉ salió de leer el repo `casanchez71/eos-inthegrow-saas` (rama main, commit 9430e35):
> `supabase/Varios SQL/supabase-schema.sql`, `supabase/migrations/*`, `src/context/AuthContext.jsx`,
> `src/pages/OrgSelector.jsx`, `src/pages/ForgotPassword.jsx`. No se supuso nada.

## 1. Qué tiene SOLÉ hoy (proyecto Supabase `yytuhddgqughemkevbni`, el mismo de `AUTH_SUPABASE_*`)

| Pieza | Cómo es |
|---|---|
| **`organizations`** | `id uuid`, `name`, `slug` (único), `sector`, `description`, `timezone` (default Buenos Aires), `plan` (`trial`/`basic`/`pro`/`enterprise`), `plan_expires_at`, `created_at`, `updated_at`. |
| **`memberships`** | `id`, `org_id` → organizations, `user_id` → `auth.users`, **`role`** `text` con check **`('admin', 'leader', 'member')`** (default `member`), `name`, `job_title`, `team`, `email` (sincronizado con `auth.users`), `n11_default`, `created_at`. `UNIQUE (org_id, user_id)`. |
| **`super_admins`** | `user_id`. Un trigger les crea membresía `admin` en **toda** empresa nueva. En el código también aparece `role = 'super_admin'`, pero el check de la tabla no lo admite: a efectos prácticos los roles son **admin, leader, member**. |
| **`invitations`** | `org_id`, `email`, `role`, `name`, `job_title`, `team`, `invited_by`, `status` (`pending`/`accepted`). La RPC **`accept_my_invitations()`** (la llama la app al entrar) convierte las invitaciones pendientes del mail del usuario en membresías. |
| **Funciones de permisos** (RLS) | `is_org_member(org)` y `is_org_admin(org)` (admin o super_admin). |
| **Crear empresa** | RPC `create_organization(org_name, org_slug)`, solo super_admins. Y un trigger `on_auth_user_created` que **a cada usuario nuevo le crea una empresa personal** con membresía admin (salvo super_admins). |
| **Usuario en varias empresas** | La app guarda la elegida en `localStorage['eos_org_<user_id>']`; si hay más de una y nada guardado, muestra la pantalla **"Elegí tu organización"** (`OrgSelector`); el enlace `?org=<uuid>` manda si el usuario es miembro. `switchOrg(orgId)` cambia en caliente. |
| **Olvidé mi clave** | `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + '/reset-password' })`; páginas `ForgotPassword` y `ResetPassword`. Invitar a alguien = crear la invitación + mandarle ese mismo mail de reseteo como enlace de activación (`?invite=1&email=…`). |

## 2. Decisiones para el presupuestador

1. **Mismas tablas, misma base.** No se crea nada nuevo en SOLÉ salvo la empresa TERRAC y sus invitaciones.
2. **Roles** (los de SOLÉ, sin inventar):
   - `admin`: todo. Único que puede borrar presupuestos y catálogos, marcar catálogo oficial, cambiar indirectos generales y configuración.
   - `leader`: carga obras, edita presupuestos, recetas y precios (Sol, Emilia).
   - `member`: solo mira (abre presupuestos, exporta). Ningún POST/PATCH/DELETE.
3. **La empresa activa viaja en cada pedido**: header `X-Org-Id`. El servidor la acepta solo si el usuario tiene membresía ahí; si no, 403. Sin header: si tiene una sola empresa, esa; si tiene varias, 428 `"Elegí la empresa"` (la pantalla lo resuelve antes de pedir nada).
4. **`DEMO_ORG_ID` se borra** de Render y `VITE_AUTH_ENABLED=true` en Vercel. Sin clave no se ve nada (ni la API).
5. **TERRAC entra a SOLÉ con el `org_id` que ya tiene en la base de datos del presupuestador**, así no se mueve ningún dato (sección 5).

## 3. Servidor

### 3.1 `app/auth.py`
```python
def get_current_user(credentials, x_org_id: str | None = Header(None, alias="X-Org-Id")) -> dict:
    # → {"user_id", "email", "org_id", "role", "orgs": [{"id", "name", "slug", "role"}]}
```
- Valida el JWT como hoy. Lee **todas** las membresías del usuario (`memberships` join `organizations`),
  ya no `limit(1)`. Si no tiene ninguna: 403 `"Tu usuario no pertenece a ninguna empresa. Pedile al administrador que te invite."`
- Elige la empresa según la regla 2.3. Devuelve también `role` de esa membresía.
- `require_role(*roles)`: dependencia para rutas. `require_editor = require_role("admin", "leader")`,
  `require_admin = require_role("admin")`. Un `member` que escribe recibe 403 `"Tu usuario solo puede mirar."`
- Cache de membresías por `user_id` durante 60 s (en memoria) para no pegarle a SOLÉ en cada pedido.
- Se mantiene `DEMO_ORG_ID` solo para los tests y el servidor falso (`scripts/serve_fake.py`); en producción se borra.

### 3.2 Endpoint nuevo `GET /me`
```json
{"user_id": "…", "email": "sol@terrac.com", "org_id": "…", "role": "leader",
 "orgs": [{"id": "…", "name": "TERRAC SA", "slug": "terrac", "role": "leader"}]}
```
Con varias empresas y sin header: 200 igual, con `org_id: null` y `role: null` (la pantalla muestra el selector).

### 3.3 Qué rutas exigen qué
| Rol mínimo | Rutas |
|---|---|
| `member` (mirar) | todos los `GET`; `POST /budgets/{id}/export/*` si existieran como POST |
| `leader` (editar) | `POST/PATCH` de budgets, items, resources, templates, obras (`/obras/analizar`, `/obras/cargar`), catalogs (crear/editar entradas, subir listas), indirectos **de la obra**, versiones, `actualizar-precios`, ai |
| `admin` | `DELETE /budgets/*`, `DELETE /catalogs/*` (catálogo entero), `PATCH /catalogs/{id}` (oficial), `PATCH /indirects/general`, standard-trees (crear/borrar) |
Se aplica con `Depends(require_editor)` / `Depends(require_admin)` ruta por ruta. Un test recorre todas las rutas de la app y verifica que cada una tenga la dependencia que dice esta tabla (lista explícita en el test: si alguien agrega una ruta sin rol, el test falla).

### 3.4 Filtro por empresa
Revisar que **toda** consulta use `user["org_id"]` (ya es así en casi todo). El test de 3.3 también verifica que ninguna ruta use `DEMO_ORG_ID` directo.

### 3.5 Tests
- `tests/test_auth.py` (nuevo): JWT válido con 1 membresía; con 2 y header correcto; con 2 y header de otra empresa → 403; con 2 y sin header → 428; sin membresías → 403; `member` en una ruta de escritura → 403; `leader` en `PATCH /catalogs/{id}` → 403; `admin` ok. Se simula el auth DB con la FakeDB de los tests y el JWT con `patch` sobre la validación.
- Test de cobertura de rutas (3.3).

## 4. Pantalla

### 4.1 `AuthContext.tsx`
- Después de `signInWithPassword` (y al cargar la sesión): llama `supabase.rpc('accept_my_invitations')`
  (igual que SOLÉ, con `Promise.resolve(...).catch(() => {})`), después `GET /me`.
- Estado: `user`, `orgs`, `org` (activa), `role`, `needsOrgSelect`. La elegida se guarda en
  `localStorage['presu_org_<user_id>']`; `?org=<uuid>` en la URL manda si es miembro.
- `switchOrg(orgId)`: guarda, recarga `/me` y vuelve al inicio (los datos en pantalla son de otra empresa).
- `api.ts`: manda `X-Org-Id` en todos los pedidos (de `localStorage`), además del Bearer.

### 4.2 Páginas
- **`Login.tsx`**: suma el enlace **"Olvidé mi clave"** → `/olvide-mi-clave`. Mensajes: "El mail o la clave no son correctos." / "Tu usuario no pertenece a ninguna empresa. Pedile al administrador que te invite."
- **`OlvideMiClave.tsx`** (`/olvide-mi-clave`): un campo, botón **"Enviarme el enlace"**, confirmación "Te mandamos un enlace a {email}. Fijate también en correo no deseado." Usa `resetPasswordForEmail(email, { redirectTo: origin + '/nueva-clave' })`.
- **`NuevaClave.tsx`** (`/nueva-clave`): dos campos (clave y repetir), botón **"Guardar la clave"**, `supabase.auth.updateUser({ password })`, después al inicio. Si viene `?invite=1`: título "Creá tu clave" (primer ingreso).
- **`ElegirEmpresa.tsx`** (pantalla completa cuando `needsOrgSelect`): "¿Con qué empresa entrás?", una tarjeta por empresa con nombre y rol en palabras ("Administra" / "Carga y edita" / "Solo mira"). Mismo estilo que `Login.tsx` (verde `#143D34`, dorado `#E0A33A`).
- **TopBar**: si hay más de una empresa, el nombre de la empresa es un desplegable para cambiar. Si hay una, texto. El nombre sale de `/me`, no de `user_metadata` como hoy.
- **Según el rol**: `member` no ve botones de crear/editar/borrar (se ocultan con `role`), y si igual pega al servidor recibe el 403 con el texto claro.

### 4.3 Comprobación
`npm run build`; prueba en el navegador con `scripts/serve_fake.py` extendido para simular `/me` con dos empresas.

## 5. Puesta en marcha (05/10, con lo que se encontró en las bases)

Hay **dos bases de datos**, las dos de producción (no hay staging):

- **SOLÉ** (`yytuhddgqughemkevbni`): usuarios, claves, empresas y membresías. La comparten SOLÉ y el presupuestador.
  SQL Editor: https://supabase.com/dashboard/project/yytuhddgqughemkevbni/sql/new
- **Presupuestador** (`pwlhepzmdjmvascsgvkv`, `DATA_SUPABASE_URL` en Render): presupuestos, catálogos, recetas.
  SQL Editor: https://supabase.com/dashboard/project/pwlhepzmdjmvascsgvkv/sql/new

Lo que se vio el 05/10: en SOLÉ **Terrac SA ya existe** (`ea998891-d7cd-416c-a8cf-ca93a2962167`) y Sol
(sardito@terrac.com.ar) ya es admin. Pero los datos del presupuestador están atados al id de **IntherArq**
(`462b39aa-efb8-44f5-b467-8ab59e2af81a`, el `DEMO_ORG_ID` de Render). Hay que moverlos a Terrac.

### Paso 1: mover los datos a Terrac (base del **presupuestador**)
Pegar entero en el SQL Editor de `pwlhepzmdjmvascsgvkv`. Es una sola sentencia: o se mueve todo o nada. Devuelve
una fila por tabla con las filas movidas (budgets 6, budget_items 684, catalog_entries 1468, item_templates 73,
price_catalogs 7, indirect_config 1; las demás lo que haya).
```sql
WITH
u0  AS (UPDATE public.audit_logs            SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u1  AS (UPDATE public.budget_items          SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u2  AS (UPDATE public.budget_versions       SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u3  AS (UPDATE public.budgets               SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u4  AS (UPDATE public.catalog_entries       SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u5  AS (UPDATE public.catalog_price_history SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u6  AS (UPDATE public.indirect_config       SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u7  AS (UPDATE public.item_audits           SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u8  AS (UPDATE public.item_resources        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u9  AS (UPDATE public.item_templates        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u10 AS (UPDATE public.obra_recetas_memoria  SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u11 AS (UPDATE public.price_catalogs        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u12 AS (UPDATE public.standard_tree_nodes   SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u13 AS (UPDATE public.standard_trees        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1)
SELECT 'audit_logs' AS tabla, (SELECT count(*) FROM u0) AS filas_movidas
UNION ALL SELECT 'budget_items',          (SELECT count(*) FROM u1)
UNION ALL SELECT 'budget_versions',       (SELECT count(*) FROM u2)
UNION ALL SELECT 'budgets',               (SELECT count(*) FROM u3)
UNION ALL SELECT 'catalog_entries',       (SELECT count(*) FROM u4)
UNION ALL SELECT 'catalog_price_history', (SELECT count(*) FROM u5)
UNION ALL SELECT 'indirect_config',       (SELECT count(*) FROM u6)
UNION ALL SELECT 'item_audits',           (SELECT count(*) FROM u7)
UNION ALL SELECT 'item_resources',        (SELECT count(*) FROM u8)
UNION ALL SELECT 'item_templates',        (SELECT count(*) FROM u9)
UNION ALL SELECT 'obra_recetas_memoria',  (SELECT count(*) FROM u10)
UNION ALL SELECT 'price_catalogs',        (SELECT count(*) FROM u11)
UNION ALL SELECT 'standard_tree_nodes',   (SELECT count(*) FROM u12)
UNION ALL SELECT 'standard_trees',        (SELECT count(*) FROM u13);
```
Mientras la clave siga apagada, la app muestra lo de `DEMO_ORG_ID`: después de este paso **la app se ve
vacía hasta cambiar `DEMO_ORG_ID` a `ea998891-d7cd-416c-a8cf-ca93a2962167` o encender la clave** (paso 3).

### Paso 2: Emilia y Carlos entran a Terrac (base de **SOLÉ**)
Pegar en el SQL Editor de `yytuhddgqughemkevbni`. Sol ya está; esto suma a los dos de Inthegrow. También los
verán como equipo de Terrac dentro de SOLÉ; la marca de consultor (`hidden_from_team`) se pone después.
```sql
INSERT INTO public.memberships (org_id, user_id, role, name, email)
VALUES ('ea998891-d7cd-416c-a8cf-ca93a2962167', '02a8afe6-2a62-4954-a5ea-c8932e99b051', 'admin',  'Carlos Sanchez',        'csanchez@inspiring.com.ar'),
       ('ea998891-d7cd-416c-a8cf-ca93a2962167', 'ea065e27-fae2-4470-8db4-4bc835c0ea95', 'leader', 'María Emilia Gerlero', 'megerlero@inspiring.com.ar')
ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email;
```

### Paso 3: encender
1. **Vercel** → proyecto del frontend → Settings → Environment Variables → `VITE_AUTH_ENABLED` = `true` →
   Deployments → Redeploy del último.
2. **Render** → presupuestador-backend → Environment → borrar `DEMO_ORG_ID` → Save → Manual Deploy.

### Paso 4: probar
- Sin clave: la app manda al login. Con la clave de SOLÉ de Carlos: entra, elige Terrac SA (va a ver varias
  empresas, Terrac entre ellas), ve los 6 presupuestos y los catálogos de siempre.
- Sol entra con su clave de SOLÉ y ve solo Terrac SA. Quién puede entrar: todos los miembros de Terrac en SOLÉ;
  los `member` (Guillermina, Camila, Nicolás López) solo miran.

### Paso 5 (después): módulo "Presupuestador" en SOLÉ
SOLÉ ya tiene módulos por empresa (`organizations.features`, `get_org_effective_modules`). Un módulo
`presupuestador` encendido solo para Terrac, un botón en el menú de SOLÉ que abre la app ya logueada (misma
clave), y el presupuestador exige que la empresa tenga el módulo. Dos PR chicos, uno por repo.

## 6. Fuera de este PR
- Pantalla de equipo (invitar, cambiar rol) dentro del presupuestador: se hace desde SOLÉ por ahora.
- Permisos finos por obra (un `member` que solo ve una obra).
