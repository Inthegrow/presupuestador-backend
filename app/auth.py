"""Who is asking and for which company.

Every request carries a Supabase JWT (Bearer) and, when the user belongs to more
than one company, the chosen one in the ``X-Org-Id`` header. Memberships and
companies live in the auth DB (SOLÉ: ``memberships`` + ``organizations``).

Company rule (PLAN_LOGIN_SOLE 2.3):
- header present → accepted only if the user is a member there (403 otherwise);
- no header and a single company → that one;
- no header and several companies → 428 "Elegí la empresa" (``GET /me`` is the
  only route that answers anyway, with ``org_id``/``role`` in null).

Module (PLAN_MODULO_SOLE 2.1): only companies with SOLÉ's "presupuestador"
module turned on count (override of the company > its plan > off). While SOLÉ
has no such module (row missing, tables missing or unreadable) nobody is
filtered, so this can ship before SOLÉ's migration.

Roles are SOLÉ's: ``admin`` (everything), ``leader`` (loads and edits),
``member`` (only looks). Routes declare the minimum with ``require_editor`` /
``require_admin``; a user without a known role is never let through.
"""

from __future__ import annotations

import copy
import logging
import os
import time

import jwt
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import get_settings
from app.db import get_auth_db

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)

_jwks_client: PyJWKClient | None = None

NO_MEMBERSHIP = "Tu usuario no pertenece a ninguna empresa. Pedile al administrador que te invite."
NOT_YOUR_ORG = "Tu usuario no pertenece a esa empresa. Elegí otra."
CHOOSE_ORG = "Elegí la empresa"
READ_ONLY = "Tu usuario solo puede mirar."
ADMIN_ONLY = "Esto lo puede hacer solo un administrador de la empresa."
NO_PERMISSION = "Tu usuario no tiene permiso para hacer esto."
NO_MODULE = "Tu empresa no tiene el Presupuestador habilitado. Pedíselo al administrador de SOLÉ."

# Key of this app in SOLÉ's module catalog (cfg_modules.key)
MODULE_KEY = "presupuestador"

ROLES = ("admin", "leader", "member")
DEMO_ORG_NAME = "Empresa demo"

# Memberships per user_id, kept 60 s so we don't hit SOLÉ on every request.
MEMBERSHIP_TTL_SECONDS = 60.0
_membership_cache: dict[str, tuple[float, list[dict]]] = {}


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        settings = get_settings()
        url = f"{settings.auth_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(url, cache_keys=True)
    return _jwks_client


def decode_token(token: str) -> dict:
    """Validate a Supabase JWT and return its payload (raises jwt errors)."""
    signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "HS256"],
        audience="authenticated",
    )


def clear_membership_cache() -> None:
    """Forget every cached membership list (tests, or after a role change)."""
    _membership_cache.clear()


def _module_enabled(auth_db, orgs: list[dict]) -> set[str] | None:
    """Ids of ``orgs`` with the module on, or None when nothing should be filtered.

    Same rule as SOLÉ's ``get_org_effective_modules`` (override > plan > off,
    only if the module ``is_active``), replicated here because that RPC needs
    ``auth.uid()`` and this server reads with the service key.
    None (no filter) when the module is not in ``cfg_modules`` yet or any
    ``cfg_*`` read fails: the transition must not lock anyone out.
    """
    try:
        modules = (
            auth_db.table("cfg_modules")
            .select("key, is_active")
            .eq("key", MODULE_KEY)
            .execute()
        ).data or []
        if not modules:
            logger.warning("cfg_modules has no '%s' row: companies are not filtered", MODULE_KEY)
            return None
        if not modules[0].get("is_active"):
            return set()
        ids = [str(o["id"]) for o in orgs]
        overrides = (
            auth_db.table("cfg_org_module_overrides")
            .select("org_id, enabled")
            .eq("module_key", MODULE_KEY)
            .in_("org_id", ids)
            .execute()
        ).data or []
        entitlements = (
            auth_db.table("cfg_plan_entitlements")
            .select("plan, enabled")
            .eq("module_key", MODULE_KEY)
            .execute()
        ).data or []
    except Exception:
        logger.warning("Could not read SOLÉ's cfg_* tables: companies are not filtered", exc_info=True)
        return None
    by_org = {str(o.get("org_id")): o.get("enabled") for o in overrides}
    by_plan = {str(e.get("plan")): e.get("enabled") for e in entitlements}
    enabled = set()
    for org in orgs:
        org_id = str(org["id"])
        value = by_org.get(org_id)
        if value is None:
            value = by_plan.get(str(org.get("plan")))
        if value:
            enabled.add(org_id)
    return enabled


def _fetch_orgs(user_id: str) -> tuple[list[dict], bool]:
    """Read the user's memberships and their companies from the auth DB.

    Two queries (memberships by user, organizations by id) instead of a join, so
    the same code runs against PostgREST and the in-memory test DB.
    Returns ``([{"id", "name", "slug", "role"}], had_memberships)``: the list has
    only the companies with the module on, sorted by company name.
    """
    auth_db = get_auth_db()
    memberships = (
        auth_db.table("memberships")
        .select("org_id, role")
        .eq("user_id", user_id)
        .execute()
    ).data or []
    roles: dict[str, str | None] = {}
    for m in memberships:
        org_id = m.get("org_id")
        if org_id:
            roles[str(org_id)] = m.get("role")
    if not roles:
        return [], False
    orgs = (
        auth_db.table("organizations")
        .select("id, name, slug, plan")
        .in_("id", list(roles))
        .execute()
    ).data or []
    by_id = {str(o.get("id")): o for o in orgs}
    enabled = _module_enabled(
        auth_db, [{"id": org_id, "plan": (by_id.get(org_id) or {}).get("plan")} for org_id in roles],
    )
    out = []
    for org_id, role in roles.items():
        if enabled is not None and org_id not in enabled:
            continue
        org = by_id.get(org_id) or {}
        out.append({
            "id": org_id,
            "name": org.get("name") or "Empresa sin nombre",
            "slug": org.get("slug"),
            "role": role,
        })
    out.sort(key=lambda o: (str(o["name"]).lower(), o["id"]))
    return out, True


def load_orgs(user_id: str) -> list[dict]:
    """Companies of ``user_id`` with the module on, cached for ``MEMBERSHIP_TTL_SECONDS``.

    An empty list is not cached: right after ``accept_my_invitations`` (or after
    turning the module on in SOLÉ) the next request has to see the company.
    403 ``NO_MODULE`` when the user has memberships but none with the module.
    """
    now = time.monotonic()
    hit = _membership_cache.get(user_id)
    if hit and now - hit[0] < MEMBERSHIP_TTL_SECONDS:
        return copy.deepcopy(hit[1])
    orgs, had_memberships = _fetch_orgs(user_id)
    if orgs:
        _membership_cache[user_id] = (now, orgs)
    elif had_memberships:
        raise HTTPException(403, NO_MODULE)
    return copy.deepcopy(orgs)


def resolve_org(user_id: str, email: str | None, orgs: list[dict], x_org_id: str | None) -> dict:
    """Apply the company rule and build the user dict.

    ``org_id``/``role`` stay None when the user has several companies and sent
    no header; ``get_current_user`` turns that into a 428.
    """
    if not orgs:
        raise HTTPException(403, NO_MEMBERSHIP)
    chosen: dict | None = None
    wanted = (x_org_id or "").strip()
    if wanted:
        chosen = next((o for o in orgs if o["id"] == wanted), None)
        if chosen is None:
            raise HTTPException(403, NOT_YOUR_ORG)
    elif len(orgs) == 1:
        chosen = orgs[0]
    return {
        "user_id": user_id,
        "email": email,
        "org_id": chosen["id"] if chosen else None,
        "role": chosen["role"] if chosen else None,
        "orgs": orgs,
    }


def get_user_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    x_org_id: str | None = Header(None, alias="X-Org-Id"),
) -> dict:
    """Validate the JWT and return the user with all their companies.

    Unlike ``get_current_user`` it does not fail when the company is still to
    be chosen (only ``GET /me`` uses it directly).
    If DEMO_ORG_ID is set and no token is sent, the user is an admin of that
    single company (tests and ``scripts/serve_fake.py`` only; never in production).
    """
    if credentials is None or not credentials.credentials:
        demo_org = os.environ.get("DEMO_ORG_ID")
        if demo_org:
            orgs = [{"id": demo_org, "name": DEMO_ORG_NAME, "slug": "demo", "role": "admin"}]
            return resolve_org("demo-user", None, orgs, x_org_id)
        raise HTTPException(401, "Token requerido")

    try:
        payload = decode_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expirado")
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, f"Token invalido: {e}")
    except Exception as e:
        raise HTTPException(500, f"Error de autenticacion: {e}")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Token sin sub")

    try:
        orgs = load_orgs(user_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("No se pudieron leer las membresías de %s", user_id)
        raise HTTPException(500, "No pudimos leer tus empresas. Probá de nuevo en un rato.")

    return resolve_org(user_id, payload.get("email"), orgs, x_org_id)


def get_current_user(session: dict = Depends(get_user_session)) -> dict:
    """The user with the company of this request already chosen.

    Returns ``{"user_id", "email", "org_id", "role", "orgs": [{"id", "name", "slug", "role"}]}``.
    428 "Elegí la empresa" when the user has several companies and sent no ``X-Org-Id``.
    """
    if not session.get("org_id"):
        raise HTTPException(428, CHOOSE_ORG)
    return session


def require_role(*roles: str):
    """Dependency that lets through only users whose role is in ``roles``.

    Returns the user dict, so routes use it in place of ``get_current_user``.
    A user without a role (or with an unknown one) gets 403: never open by default.
    """
    allowed = frozenset(roles)

    def checker(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("role")
        if role in allowed:
            return user
        if role == "member":
            raise HTTPException(403, READ_ONLY)
        if role in ROLES and allowed == {"admin"}:
            raise HTTPException(403, ADMIN_ONLY)
        raise HTTPException(403, NO_PERMISSION)

    checker.__name__ = f"require_role_{'_'.join(roles)}"
    checker.roles = allowed  # type: ignore[attr-defined]
    return checker


require_editor = require_role("admin", "leader")
require_admin = require_role("admin")
