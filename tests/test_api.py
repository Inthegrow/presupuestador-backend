"""API integration tests with mocked Supabase and auth."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

# Set required env vars before importing app
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

MOCK_USER = {"user_id": "test-user-uuid", "org_id": "test-org-uuid"}


class MockSupabaseResponse:
    """Mock for Supabase query responses."""
    def __init__(self, data=None):
        self.data = data or []


class MockTable:
    """Chain-friendly mock for Supabase table operations."""
    def __init__(self, data=None):
        self._data = data or []
        self._single = False

    def select(self, *args, **kwargs): return self
    def insert(self, data, **kwargs):
        if isinstance(data, list):
            self._data = [{**d, "id": f"new-{i}"} for i, d in enumerate(data)]
        else:
            self._data = [{**data, "id": "new-uuid"}]
        return self
    def update(self, data, **kwargs):
        if self._data:
            self._data = [{**self._data[0], **data}]
        return self
    def delete(self, **kwargs): return self
    def eq(self, *args, **kwargs): return self
    def order(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self
    def range(self, *args, **kwargs): return self
    def single(self, **kwargs):
        self._single = True
        return self
    def execute(self):
        if self._single:
            return MockSupabaseResponse(self._data[0] if self._data else None)
        return MockSupabaseResponse(self._data)


class MockDB:
    """Mock Supabase client."""
    def __init__(self, tables=None):
        self._tables = tables or {}

    def table(self, name):
        if name in self._tables:
            return MockTable(self._tables[name])
        return MockTable([])


def get_test_client(db_data=None):
    """Create test client with mocked auth and DB."""
    app = create_app()
    client = TestClient(app)

    mock_db = MockDB(db_data or {})

    # Override auth dependency
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER

    return client, mock_db


@pytest.fixture
def client():
    """Basic test client with auth override."""
    app = create_app()
    from app.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: MOCK_USER
    return TestClient(app)


class TestHealthEndpoints:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok" or "status" in data

    def test_landing(self, client):
        r = client.get("/")
        assert r.status_code == 200


class TestBudgetEndpoints:
    @patch("app.routers.budgets.get_data_db")
    def test_create_budget(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budgets": [{"id": "new-uuid", "org_id": "test-org-uuid", "name": "Test", "status": "draft"}]
        })
        r = client.post("/budgets", json={"name": "Test Budget"})
        assert r.status_code == 200

    @patch("app.routers.budgets.get_data_db")
    def test_list_budgets(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budgets": [
                {"id": "1", "name": "Budget 1", "org_id": "test-org-uuid"},
                {"id": "2", "name": "Budget 2", "org_id": "test-org-uuid"},
            ]
        })
        r = client.get("/budgets")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    @patch("app.routers.budgets.get_data_db")
    def test_get_budget(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budgets": [{"id": "abc", "name": "Test", "org_id": "test-org-uuid"}]
        })
        r = client.get("/budgets/00000000-0000-0000-0000-000000000001")
        assert r.status_code == 200

    @patch("app.routers.budgets.get_data_db")
    def test_delete_budget(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budgets": [{"id": "abc"}]
        })
        r = client.delete("/budgets/00000000-0000-0000-0000-000000000001")
        assert r.status_code == 200

    @patch("app.routers.budgets.get_data_db")
    def test_update_budget(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budgets": [{"id": "abc", "name": "Updated", "org_id": "test-org-uuid", "status": "active"}]
        })
        r = client.patch(
            "/budgets/00000000-0000-0000-0000-000000000001",
            json={"name": "Updated Name"}
        )
        assert r.status_code == 200


class TestItemEndpoints:
    @patch("app.routers.budgets.get_data_db")
    def test_create_items(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budget_items": [{"id": "new-item", "budget_id": "abc", "description": "Test"}]
        })
        r = client.post(
            "/budgets/00000000-0000-0000-0000-000000000001/items",
            json=[{"description": "Hormigón H-30", "unidad": "m3", "cantidad": 42.5, "mat_unitario": 85000}]
        )
        assert r.status_code == 200

    @patch("app.routers.budgets.get_data_db")
    def test_list_items(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budget_items": [
                {"id": "1", "code": "1.1", "description": "Col"},
                {"id": "2", "code": "1.2", "description": "Vigas"},
            ]
        })
        r = client.get("/budgets/00000000-0000-0000-0000-000000000001/items")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    @patch("app.routers.budgets.get_data_db")
    def test_delete_item(self, mock_db, client):
        mock_db.return_value = MockDB({
            "budget_items": [{"id": "x"}],
            "item_resources": [],
        })
        r = client.delete(
            "/budgets/00000000-0000-0000-0000-000000000001/items/00000000-0000-0000-0000-000000000002"
        )
        assert r.status_code == 200


BUDGET_ROW = {"id": "00000000-0000-0000-0000-000000000001", "org_id": "test-org-uuid", "indirectos": {}}


class TestAnalysisEndpoints:
    @patch("app.routers.analysis.get_data_db")
    def test_get_indirects_defaults(self, mock_db, client):
        mock_db.return_value = MockDB({"indirect_config": [], "budgets": [BUDGET_ROW]})
        r = client.get("/budgets/00000000-0000-0000-0000-000000000001/indirects")
        assert r.status_code == 200
        data = r.json()
        # Percentages are stored as whole numbers (15 = 15%)
        assert data["estructura_pct"] == 15
        assert data["jefatura_pct"] == 8

    @patch("app.routers.analysis.get_data_db")
    def test_update_indirects(self, mock_db, client):
        mock_db.return_value = MockDB({"indirect_config": [], "budgets": [BUDGET_ROW]})
        r = client.patch(
            "/budgets/00000000-0000-0000-0000-000000000001/indirects",
            json={"estructura_pct": 0.20}
        )
        assert r.status_code == 200


class TestCatalogEndpoints:
    @patch("app.routers.catalogs.get_data_db")
    def test_list_catalogs(self, mock_db, client):
        mock_db.return_value = MockDB({
            "price_catalogs": [{"id": "c1", "name": "Mat Mar-2026", "org_id": "test-org-uuid"}]
        })
        r = client.get("/catalogs")
        assert r.status_code == 200


class TestSchemaValidation:
    """Test new schemas."""

    def test_budget_update_partial(self):
        from app.schemas import BudgetUpdate
        u = BudgetUpdate(name="New Name")
        d = u.model_dump(exclude_unset=True)
        assert d == {"name": "New Name"}
        assert "description" not in d
        assert "status" not in d

    def test_indirect_config_update_partial(self):
        from app.schemas import IndirectConfigUpdate
        u = IndirectConfigUpdate(estructura_pct=0.20)
        d = u.model_dump(exclude_unset=True)
        assert d == {"estructura_pct": 0.20}
        assert "jefatura_pct" not in d

    def test_budget_update_all_fields(self):
        from app.schemas import BudgetUpdate
        u = BudgetUpdate(name="X", description="Y", status="active")
        d = u.model_dump(exclude_unset=True)
        assert len(d) == 3
