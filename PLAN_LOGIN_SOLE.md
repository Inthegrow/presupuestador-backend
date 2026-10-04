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

## 5. Puesta en marcha (Carlos, en este orden; cada paso es un SQL para pegar)

1. **Leer el `org_id` de TERRAC en la base del presupuestador** (SQL Editor del proyecto DATA):
   ```sql
   SELECT org_id, count(*) AS presupuestos FROM budgets GROUP BY org_id;
   ```
   Tiene que dar **una** fila. Ese `org_id` es el de `DEMO_ORG_ID` en Render.
2. **Crear TERRAC en SOLÉ con ese mismo id** (SQL Editor del proyecto `yytuhddgqughemkevbni`), pegando el id:
   ```sql
   INSERT INTO public.organizations (id, name, slug, sector, plan)
   VALUES ('<ORG_ID>', 'TERRAC SA', 'terrac', 'Construcción', 'pro')
   ON CONFLICT (id) DO NOTHING;
   -- El trigger de SOLÉ ya suma a los super_admins como admin de TERRAC.
   INSERT INTO public.invitations (org_id, email, role, name, status)
   VALUES ('<ORG_ID>', 'sol@…',    'leader', 'Sol',    'pending'),
          ('<ORG_ID>', 'emilia@…', 'leader', 'Emilia', 'pending'),
          ('<ORG_ID>', 'carlos@…', 'admin',  'Carlos', 'pending');
   ```
3. **Invitar**: en Supabase Auth → Users → "Invite user" con cada mail (o desde SOLÉ, Equipo → Invitar). El mail
   que les llega los lleva a crear la clave. Al entrar, `accept_my_invitations` les da la membresía en TERRAC.
   Ojo: el trigger de SOLÉ también les crea una empresa personal ("sol-a1b2c3"); van a ver el selector con dos.
   Si molesta, borrar esa empresa personal desde SOLÉ (super admin).
4. **Encender**: Vercel `VITE_AUTH_ENABLED=true` (y redeploy del frontend); Render **borrar `DEMO_ORG_ID`** y Manual Deploy.
5. **Probar**: sin clave, `/app` manda al login y la API responde 401. Con Sol: entra, ve TERRAC, carga Ginkgo.

## 6. Fuera de este PR
- Pantalla de equipo (invitar, cambiar rol) dentro del presupuestador: se hace desde SOLÉ por ahora.
- Permisos finos por obra (un `member` que solo ve una obra).
