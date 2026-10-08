"""Login with SOLÉ's companies and roles (PLAN_LOGIN_SOLE, sección 3).

Two parts:
- every route of the app declares the role the plan's table 3.3 asks for
  (an explicit list: a new route without a role makes the test fail);
- the company rule and the roles, end to end through the real dependencies,
  with the JWT check patched and the auth DB replaced by the in-memory FakeDB.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import jwt
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import auth
from app.auth import (
    CHOOSE_ORG,
    MODULE_KEY,
    NO_MEMBERSHIP,
    MODULE_CHECK_FAILED,
    NO_MODULE,
    NOT_YOUR_ORG,
    READ_ONLY,
    get_current_user,
    get_user_session,
    require_admin,
    require_editor,
)
from app.main import create_app
from tests.test_recipes_api import FakeDB

# ── Tabla 3.3: rol mínimo de cada ruta ───────────────────────────────────────
# member = cualquiera con empresa elegida (mirar); editor = admin o leader; admin = solo admin.

MEMBER, EDITOR, ADMIN = "member", "editor", "admin"

ROUTE_ROLES: dict[tuple[str, str], str] = {
    # Presupuestos
    ("GET", "/budgets"): MEMBER,
    ("POST", "/budgets"): EDITOR,
    ("POST", "/budgets/create-full"): EDITOR,
    ("GET", "/budgets/{budget_id}"): MEMBER,
    ("PATCH", "/budgets/{budget_id}"): EDITOR,
    ("DELETE", "/budgets/{budget_id}"): ADMIN,
    ("POST", "/budgets/{budget_id}/items"): EDITOR,
    ("GET", "/budgets/{budget_id}/items"): MEMBER,
    ("PATCH", "/budgets/{budget_id}/items/{item_id}"): EDITOR,
    ("DELETE", "/budgets/{budget_id}/items/{item_id}"): EDITOR,
    ("GET", "/budgets/{budget_id}/items/{item_id}/audits"): MEMBER,
    ("GET", "/budgets/{budget_id}/items/{item_id}/resources"): MEMBER,
    ("GET", "/budgets/{budget_id}/items/{item_id}/precios-faltantes"): MEMBER,
    ("POST", "/budgets/{budget_id}/trabajos"): EDITOR,
    ("GET", "/budgets/{budget_id}/precios-faltantes"): MEMBER,
    ("PATCH", "/budgets/{budget_id}/items/{item_id}/parametros"): EDITOR,
    ("POST", "/budgets/{budget_id}/items/{item_id}/resources"): EDITOR,
    ("PATCH", "/budgets/{budget_id}/items/{item_id}/resources/{resource_id}"): EDITOR,
    ("DELETE", "/budgets/{budget_id}/items/{item_id}/resources/{resource_id}"): EDITOR,
    ("POST", "/budgets/{budget_id}/items/{item_id}/resources/bulk"): EDITOR,
    ("POST", "/budgets/{budget_id}/sections"): EDITOR,
    ("POST", "/budgets/{budget_id}/assign-catalog/{catalog_id}"): EDITOR,
    ("GET", "/budgets/{budget_id}/tree"): MEMBER,
    ("GET", "/budgets/{budget_id}/full"): MEMBER,
    ("POST", "/budgets/{budget_id}/recalculate"): EDITOR,
    ("POST", "/budgets/{budget_id}/copy"): EDITOR,
    # Excel
    ("POST", "/budgets/import-excel"): EDITOR,
    ("GET", "/budgets/{budget_id}/export/excel"): MEMBER,
    ("GET", "/budgets/{budget_id}/export/pdf"): MEMBER,
    # IA
    ("POST", "/budgets/{budget_id}/analyze-plan"): EDITOR,
    ("POST", "/budgets/{budget_id}/items/from-ai"): EDITOR,
    # Análisis, indirectos de la obra, versiones, precios
    ("GET", "/budgets/{budget_id}/indirects"): MEMBER,
    ("PATCH", "/budgets/{budget_id}/indirects"): EDITOR,
    ("POST", "/budgets/{budget_id}/indirects"): EDITOR,
    ("POST", "/budgets/{budget_id}/cascade-recalculate"): EDITOR,
    ("POST", "/budgets/{budget_id}/actualizar-precios"): EDITOR,
    ("GET", "/budgets/{budget_id}/analysis"): MEMBER,
    ("POST", "/budgets/{budget_id}/versions"): EDITOR,
    ("GET", "/budgets/{budget_id}/versions"): MEMBER,
    ("GET", "/budgets/{budget_id}/versions/{version_id}"): MEMBER,
    # Indirectos generales (configuración de la empresa)
    ("GET", "/indirects/general"): MEMBER,
    ("PATCH", "/indirects/general"): ADMIN,
    ("POST", "/indirects/general/afectados"): ADMIN,
    # Catálogos
    ("POST", "/catalogs/upload-csv"): EDITOR,
    ("POST", "/catalogs/upload-excel"): EDITOR,
    ("GET", "/catalogs"): MEMBER,
    ("PATCH", "/catalogs/{catalog_id}"): ADMIN,
    ("GET", "/catalogs/{catalog_id}/entries"): MEMBER,
    ("GET", "/catalogs/{catalog_id}/search"): MEMBER,
    ("DELETE", "/catalogs/{catalog_id}"): ADMIN,
    ("POST", "/catalogs/{catalog_id}/entries"): EDITOR,
    ("PATCH", "/catalogs/{catalog_id}/entries/{entry_id}"): EDITOR,
    ("GET", "/catalogs/{catalog_id}/entries/{entry_id}/history"): MEMBER,
    ("DELETE", "/catalogs/{catalog_id}/entries/{entry_id}"): EDITOR,
    ("POST", "/catalogs/apply/{budget_id}/{catalog_id}"): EDITOR,
    # Recetas
    ("GET", "/templates"): MEMBER,
    ("GET", "/templates/categories"): MEMBER,
    ("GET", "/templates/sugerir"): MEMBER,
    ("GET", "/templates/{template_id}"): MEMBER,
    ("POST", "/templates"): EDITOR,
    ("PATCH", "/templates/{template_id}"): EDITOR,
    ("DELETE", "/templates/{template_id}"): EDITOR,
    ("POST", "/templates/preview"): EDITOR,
    ("POST", "/templates/{template_id}/apply/{budget_id}/items/{item_id}"): EDITOR,
    # Cargar obra
    ("POST", "/obras/analizar"): EDITOR,
    ("POST", "/obras/cargar"): EDITOR,
    ("GET", "/obras/{budget_id}/diferencias"): MEMBER,
    # Árbol estándar (hoy solo lectura; crear/borrar sería ADMIN)
    ("GET", "/standard-trees"): MEMBER,
    ("GET", "/standard-trees/{tree_id}"): MEMBER,
    # Arquitecto IA
    ("POST", "/architect/{budget_id}/classify"): EDITOR,
    ("POST", "/architect/{budget_id}/analyze-architecture"): EDITOR,
    ("POST", "/architect/{budget_id}/analyze-structure"): EDITOR,
    ("POST", "/architect/{budget_id}/analyze-sections"): EDITOR,
    ("POST", "/architect/{budget_id}/synthesize"): EDITOR,
    # Correcciones de la revisión de Ginkgo (entrega 8)
    ("GET", "/correcciones"): MEMBER,
    ("POST", "/correcciones/{correccion_id}/aplicar"): EDITOR,
    ("POST", "/correcciones/{correccion_id}/deshacer"): EDITOR,
    # Buscador de precios en internet (no guarda nada; consume la clave de OpenAI)
    ("POST", "/precios/buscar"): EDITOR,
    ("GET", "/precios/buscador"): MEMBER,
}

# Rutas sin empresa elegida: la portada, /health y /me (que muestra el selector).
NO_ORG_ROUTES = {("GET", "/"), ("GET", "/health"), ("GET", "/me")}


def _app_routes() -> dict[tuple[str, str], APIRoute]:
    out = {}
    for route in create_app().routes:
        if not isinstance(route, APIRoute):
            continue  # /docs, /openapi.json, /redoc
        for method in route.methods - {"HEAD", "OPTIONS"}:
            out[(method, route.path)] = route
    return out


def _dependency_calls(dependant) -> set:
    calls = set()
    for dep in dependant.dependencies:
        if dep.call is not None:
            calls.add(dep.call)
        calls |= _dependency_calls(dep)
    return calls


class TestRouteRoles:
    def test_every_route_is_in_the_table(self):
        routes = set(_app_routes()) - NO_ORG_ROUTES
        missing = sorted(routes - set(ROUTE_ROLES))
        stale = sorted(set(ROUTE_ROLES) - routes)
        assert not missing, (
            "Rutas sin rol en ROUTE_ROLES (tests/test_auth.py): agregalas con su rol según "
            f"PLAN_LOGIN_SOLE 3.3 y poneles Depends(require_editor/require_admin): {missing}"
        )
        assert not stale, f"ROUTE_ROLES nombra rutas que ya no existen: {stale}"

    def test_every_route_requires_a_chosen_company(self):
        sin_usuario = [
            key for key, route in _app_routes().items()
            if key not in NO_ORG_ROUTES and get_current_user not in _dependency_calls(route.dependant)
        ]
        assert not sin_usuario, f"Rutas que no piden usuario (Depends(get_current_user)): {sin_usuario}"

    @pytest.mark.parametrize("key", sorted(ROUTE_ROLES), ids=lambda k: f"{k[0]} {k[1]}")
    def test_route_has_the_role_of_the_table(self, key):
        route = _app_routes().get(key)
        if route is None:
            pytest.skip("la ruta ya no existe (lo marca test_every_route_is_in_the_table)")
        calls = _dependency_calls(route.dependant)
        expected = ROUTE_ROLES[key]
        has_editor, has_admin = require_editor in calls, require_admin in calls
        if expected == ADMIN:
            assert has_admin, f"{key} tiene que usar Depends(require_admin)"
        elif expected == EDITOR:
            assert has_editor and not has_admin, f"{key} tiene que usar Depends(require_editor)"
        else:
            assert key[0] == "GET", f"{key}: solo los GET pueden quedar abiertos a un member"
            assert not has_editor and not has_admin, f"{key} es para mirar: no lleva require_*"

    def test_writes_are_never_open_to_member(self):
        abiertas = [k for k, rol in ROUTE_ROLES.items() if k[0] != "GET" and rol == MEMBER]
        assert not abiertas, f"Un member no puede hacer POST/PATCH/DELETE: {abiertas}"

    def test_me_does_not_require_a_chosen_company(self):
        route = _app_routes()[("GET", "/me")]
        calls = _dependency_calls(route.dependant)
        assert get_user_session in calls
        assert get_current_user not in calls

    def test_no_route_reads_demo_org_directly(self):
        routers = Path(__file__).resolve().parent.parent / "app" / "routers"
        culpables = [p.name for p in routers.glob("*.py") if "DEMO_ORG_ID" in p.read_text()]
        assert not culpables, f"Usan DEMO_ORG_ID en vez de user['org_id']: {culpables}"


# ── La regla de empresa y los roles, de punta a punta ────────────────────────

ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a"
ORG_B = "bbbbbbbb-0000-0000-0000-00000000000b"
BUDGET_A = "00000000-0000-0000-0000-0000000000a1"
BUDGET_B = "00000000-0000-0000-0000-0000000000b1"
CATALOG_A = "00000000-0000-0000-0000-0000000000ca"

ORGS = [
    {"id": ORG_A, "name": "TERRAC SA", "slug": "terrac", "plan": "pro"},
    {"id": ORG_B, "name": "Obra Demo", "slug": "obra-demo", "plan": "trial"},
]


def _memberships(*pairs: tuple[str, str, str]) -> list[dict]:
    return [{"id": f"m{i}", "user_id": u, "org_id": o, "role": r} for i, (u, o, r) in enumerate(pairs)]


AUTH_TABLES = {
    "organizations": ORGS,
    "memberships": _memberships(
        ("sol", ORG_A, "leader"),
        ("carlos", ORG_A, "admin"),
        ("carlos", ORG_B, "admin"),
        ("emilia", ORG_A, "leader"),
        ("emilia", ORG_B, "member"),
        ("miron", ORG_A, "member"),
    ),
}

DATA_TABLES = {
    "budgets": [
        {"id": BUDGET_A, "org_id": ORG_A, "name": "Ginkgo", "created_at": "2026-10-01"},
        {"id": BUDGET_B, "org_id": ORG_B, "name": "Demo", "created_at": "2026-10-02"},
    ],
    "price_catalogs": [{"id": CATALOG_A, "org_id": ORG_A, "name": "Maestro", "oficial": False}],
    "indirect_config": [],
}


def _payload(token: str) -> dict:
    """Fake JWT check: the token is the user id; 'vencido' and 'roto' fail like PyJWT."""
    if token == "vencido":
        raise jwt.ExpiredSignatureError("expired")
    if token == "roto":
        raise jwt.InvalidTokenError("bad")
    return {"sub": token, "email": f"{token}@terrac.com", "aud": "authenticated"}


@pytest.fixture
def auth_db():
    return FakeDB(AUTH_TABLES)


@pytest.fixture
def client(auth_db, monkeypatch):
    monkeypatch.delenv("DEMO_ORG_ID", raising=False)
    auth.clear_membership_cache()
    data = FakeDB(DATA_TABLES)
    with patch("app.auth.decode_token", side_effect=_payload), \
         patch("app.auth.get_auth_db", return_value=auth_db), \
         patch("app.routers.budgets.get_data_db", return_value=data), \
         patch("app.routers.catalogs.get_data_db", return_value=data):
        yield TestClient(create_app())
    auth.clear_membership_cache()


def _h(user: str, org: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {user}"}
    if org:
        headers["X-Org-Id"] = org
    return headers


class TestCompanyRule:
    def test_one_membership_uses_that_company(self, client):
        r = client.get("/budgets", headers=_h("sol"))
        assert r.status_code == 200
        assert [b["id"] for b in r.json()] == [BUDGET_A]
        me = client.get("/me", headers=_h("sol")).json()
        assert me == {
            "user_id": "sol", "email": "sol@terrac.com", "org_id": ORG_A, "role": "leader",
            "orgs": [{"id": ORG_A, "name": "TERRAC SA", "slug": "terrac", "role": "leader"}],
        }

    def test_two_memberships_with_valid_header(self, client):
        r = client.get("/budgets", headers=_h("emilia", ORG_B))
        assert r.status_code == 200
        assert [b["id"] for b in r.json()] == [BUDGET_B]
        me = client.get("/me", headers=_h("emilia", ORG_B)).json()
        assert (me["org_id"], me["role"]) == (ORG_B, "member")

    def test_header_of_another_company_is_403(self, client):
        r = client.get("/budgets", headers=_h("sol", ORG_B))
        assert r.status_code == 403
        r = client.get("/budgets", headers=_h("emilia", "cccccccc-0000-0000-0000-00000000000c"))
        assert r.status_code == 403
        assert client.get("/me", headers=_h("sol", ORG_B)).status_code == 403

    def test_two_memberships_without_header_is_428(self, client):
        r = client.get("/budgets", headers=_h("emilia"))
        assert r.status_code == 428
        assert r.json()["detail"] == CHOOSE_ORG == "Elegí la empresa"

    def test_no_memberships_is_403(self, client):
        texto = "Tu usuario no pertenece a ninguna empresa. Pedile al administrador que te invite."
        assert NO_MEMBERSHIP == texto
        for path in ("/budgets", "/me"):
            r = client.get(path, headers=_h("nadie"))
            assert r.status_code == 403
            assert r.json()["detail"] == texto

    def test_me_with_two_companies_and_no_header(self, client):
        r = client.get("/me", headers=_h("emilia"))
        assert r.status_code == 200
        me = r.json()
        assert me["org_id"] is None and me["role"] is None
        assert me["email"] == "emilia@terrac.com"
        assert me["orgs"] == [
            {"id": ORG_B, "name": "Obra Demo", "slug": "obra-demo", "role": "member"},
            {"id": ORG_A, "name": "TERRAC SA", "slug": "terrac", "role": "leader"},
        ]


class TestTokenAndDemo:
    def test_no_token_is_401(self, client):
        assert client.get("/budgets").status_code == 401
        assert client.get("/me").status_code == 401

    def test_bad_or_expired_token_is_401(self, client):
        assert client.get("/budgets", headers=_h("roto")).status_code == 401
        assert client.get("/budgets", headers=_h("vencido")).status_code == 401

    def test_demo_org_is_an_admin_of_one_company(self, client, monkeypatch):
        monkeypatch.setenv("DEMO_ORG_ID", ORG_A)
        me = client.get("/me").json()
        assert me["org_id"] == ORG_A and me["role"] == "admin"
        assert me["orgs"] == [{"id": ORG_A, "name": "Empresa demo", "slug": "demo", "role": "admin"}]
        assert client.get("/budgets", headers={"X-Org-Id": ORG_B}).status_code == 403


class TestRoles:
    def test_member_can_look(self, client):
        assert client.get("/budgets", headers=_h("miron")).status_code == 200

    def test_member_cannot_write(self, client):
        for method, path, body in [
            ("POST", "/budgets", {"name": "Nueva"}),
            ("PATCH", f"/budgets/{BUDGET_A}", {"name": "Otra"}),
            ("DELETE", f"/budgets/{BUDGET_A}", None),
        ]:
            r = client.request(method, path, json=body, headers=_h("miron"))
            assert r.status_code == 403, (method, path)
            assert r.json()["detail"] == READ_ONLY == "Tu usuario solo puede mirar."

    def test_member_in_one_company_leader_in_other(self, client):
        r = client.post("/budgets", json={"name": "X"}, headers=_h("emilia", ORG_B))
        assert r.status_code == 403
        assert r.json()["detail"] == READ_ONLY
        r = client.post("/budgets", json={"name": "X"}, headers=_h("emilia", ORG_A))
        assert r.status_code == 200
        assert r.json()["org_id"] == ORG_A

    def test_leader_can_edit_but_not_mark_official(self, client):
        assert client.post("/budgets", json={"name": "Nueva"}, headers=_h("sol")).status_code == 200
        r = client.patch(f"/catalogs/{CATALOG_A}", json={"oficial": True}, headers=_h("sol"))
        assert r.status_code == 403
        assert "administrador" in r.json()["detail"]

    def test_admin_can_mark_official(self, client):
        r = client.patch(f"/catalogs/{CATALOG_A}", json={"oficial": True}, headers=_h("carlos", ORG_A))
        assert r.status_code == 200
        assert r.json()["oficial"] is True

    def test_user_without_role_is_never_let_through(self):
        app = create_app()
        app.dependency_overrides[get_current_user] = lambda: {"user_id": "x", "org_id": ORG_A}
        r = TestClient(app).post("/budgets", json={"name": "X"})
        assert r.status_code == 403

    def test_unknown_role_is_403(self):
        app = create_app()
        app.dependency_overrides[get_current_user] = lambda: {
            "user_id": "x", "org_id": ORG_A, "role": "super_admin", "orgs": [],
        }
        assert TestClient(app).post("/budgets", json={"name": "X"}).status_code == 403


class TestMembershipCache:
    def test_memberships_are_read_once_per_minute(self, client, auth_db):
        calls = []
        original = auth_db.table

        def counting(name):
            calls.append(name)
            return original(name)

        auth_db.table = counting
        client.get("/budgets", headers=_h("sol"))
        client.get("/budgets", headers=_h("sol"))
        assert calls.count("memberships") == 1
        with patch("app.auth.time.monotonic", return_value=auth.time.monotonic() + 61):
            client.get("/budgets", headers=_h("sol"))
        assert calls.count("memberships") == 2

    def test_empty_membership_is_not_cached(self, client, auth_db):
        assert client.get("/me", headers=_h("nueva")).status_code == 403
        # accept_my_invitations le dio una membresía: el pedido siguiente la ve
        auth_db.tables["memberships"].append({"id": "m-new", "user_id": "nueva", "org_id": ORG_A, "role": "leader"})
        r = client.get("/me", headers=_h("nueva"))
        assert r.status_code == 200
        assert r.json()["org_id"] == ORG_A


# ── Módulo "presupuestador" de SOLÉ (PLAN_MODULO_SOLE 2.1) ────────────────────


def _module(auth_db, *, is_active=True, overrides=None, plans=None):
    """Register the module in SOLÉ's cfg_* tables of the fake auth DB."""
    auth_db.tables["cfg_modules"] = [
        {"key": "talento", "suite": "sole-core", "is_active": True},
        {"key": MODULE_KEY, "suite": "growth", "is_active": is_active},
    ]
    auth_db.tables["cfg_org_module_overrides"] = [
        {"id": f"ov-{org}", "org_id": org, "module_key": MODULE_KEY, "enabled": on}
        for org, on in (overrides or {}).items()
    ]
    auth_db.tables["cfg_plan_entitlements"] = [
        {"plan": plan, "module_key": MODULE_KEY, "enabled": (plans or {}).get(plan, False)}
        for plan in ("trial", "basic", "pro", "enterprise")
    ] + [{"plan": "trial", "module_key": "talento", "enabled": True}]


def _org_ids(client, user: str) -> list[str]:
    r = client.get("/me", headers=_h(user))
    assert r.status_code == 200, r.text
    return [o["id"] for o in r.json()["orgs"]]


class TestModule:
    def test_text_of_no_module(self):
        assert NO_MODULE == "Tu empresa no tiene el Presupuestador habilitado. Pedíselo al administrador de SOLÉ."

    def test_without_module_row_nothing_is_filtered(self, client, auth_db):
        assert _org_ids(client, "carlos") == [ORG_B, ORG_A]
        # Other modules registered, ours not yet (SOLÉ's migration still to run)
        auth_db.tables["cfg_modules"] = [{"key": "talento", "is_active": True}]
        auth_db.tables["cfg_org_module_overrides"] = [
            {"org_id": ORG_A, "module_key": "talento", "enabled": False},
        ]
        auth.clear_membership_cache()
        assert _org_ids(client, "carlos") == [ORG_B, ORG_A]

    @pytest.mark.parametrize("tabla", ["cfg_modules", "cfg_org_module_overrides", "cfg_plan_entitlements"])
    def test_unreadable_cfg_tables_fail_closed(self, client, auth_db, tabla):
        # Codex (PR #33): an outage must never open access to every company
        _module(auth_db, overrides={ORG_A: True, ORG_B: False})
        original = auth_db.table

        def broken(name):
            if name == tabla:
                raise RuntimeError("connection reset")
            return original(name)

        auth_db.table = broken
        r = client.get("/me", headers=_h("carlos"))
        assert r.status_code == 503
        assert r.json()["detail"] == MODULE_CHECK_FAILED
        assert client.get("/budgets", headers=_h("carlos", ORG_B)).status_code == 503
        # Not cached: when SOLÉ answers again, the filter is back
        auth_db.table = original
        assert _org_ids(client, "carlos") == [ORG_A]

    def test_override_per_company(self, client, auth_db):
        _module(auth_db, overrides={ORG_A: True, ORG_B: False}, plans={"trial": True})
        me = client.get("/me", headers=_h("carlos")).json()
        # Only TERRAC is left, so it is chosen without the picker
        assert [o["id"] for o in me["orgs"]] == [ORG_A]
        assert (me["org_id"], me["role"]) == (ORG_A, "admin")

    def test_plan_entitlement_when_no_override(self, client, auth_db):
        _module(auth_db, plans={"pro": True, "trial": False})
        assert _org_ids(client, "carlos") == [ORG_A]  # TERRAC is pro, Obra Demo is trial

    def test_override_beats_plan(self, client, auth_db):
        _module(auth_db, overrides={ORG_A: False, ORG_B: True}, plans={"pro": True})
        assert _org_ids(client, "carlos") == [ORG_B]

    def test_company_without_plan_or_override_is_off(self, client, auth_db):
        _module(auth_db, overrides={ORG_A: True})
        auth_db.tables["organizations"][1]["plan"] = None
        assert _org_ids(client, "carlos") == [ORG_A]

    def test_inactive_module_leaves_no_company(self, client, auth_db):
        _module(auth_db, is_active=False, overrides={ORG_A: True, ORG_B: True}, plans={"pro": True})
        r = client.get("/me", headers=_h("carlos"))
        assert r.status_code == 403
        assert r.json()["detail"] == NO_MODULE

    def test_memberships_but_no_company_with_module_is_no_module(self, client, auth_db):
        _module(auth_db, overrides={ORG_B: True})
        for path in ("/me", "/budgets"):
            r = client.get(path, headers=_h("sol"))  # sol is only in TERRAC
            assert r.status_code == 403, path
            assert r.json()["detail"] == NO_MODULE
        # Without memberships it is still the old text
        r = client.get("/me", headers=_h("nadie"))
        assert r.status_code == 403
        assert r.json()["detail"] == NO_MEMBERSHIP

    def test_header_of_a_company_without_module_is_403(self, client, auth_db):
        _module(auth_db, overrides={ORG_A: True})
        for path in ("/me", "/budgets"):
            r = client.get(path, headers=_h("carlos", ORG_B))
            assert r.status_code == 403, path
            assert r.json()["detail"] == NOT_YOUR_ORG
        assert client.get("/budgets", headers=_h("carlos", ORG_A)).status_code == 200

    def test_no_module_is_not_cached(self, client, auth_db):
        _module(auth_db)
        assert client.get("/me", headers=_h("sol")).status_code == 403
        # Turned on from SOLÉ's admin: the next request sees it
        auth_db.tables["cfg_org_module_overrides"].append(
            {"id": "ov-new", "org_id": ORG_A, "module_key": MODULE_KEY, "enabled": True},
        )
        assert _org_ids(client, "sol") == [ORG_A]

    def test_filtered_list_is_cached(self, client, auth_db):
        _module(auth_db, overrides={ORG_A: True})
        assert _org_ids(client, "carlos") == [ORG_A]
        auth_db.tables["cfg_org_module_overrides"].append(
            {"id": "ov-b", "org_id": ORG_B, "module_key": MODULE_KEY, "enabled": True},
        )
        assert _org_ids(client, "carlos") == [ORG_A]
        with patch("app.auth.time.monotonic", return_value=auth.time.monotonic() + 61):
            assert _org_ids(client, "carlos") == [ORG_B, ORG_A]

    def test_demo_mode_ignores_the_module(self, client, auth_db, monkeypatch):
        _module(auth_db, is_active=False)
        monkeypatch.setenv("DEMO_ORG_ID", ORG_A)
        me = client.get("/me").json()
        assert me["org_id"] == ORG_A and me["role"] == "admin"
