"""Static checks on SQL migrations (they are run by hand in Supabase)."""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION_004 = Path(__file__).resolve().parent.parent / "migrations" / "004_catalog_price_dates.sql"


def _sql() -> str:
    """Migration text without comments."""
    text = MIGRATION_004.read_text(encoding="utf-8")
    return "\n".join(line.split("--", 1)[0] for line in text.splitlines())


class TestPriceHistorySecurity:
    """catalog_price_history holds prices of every org: only the backend may touch it."""

    def test_rls_enabled(self):
        assert re.search(r"ALTER TABLE catalog_price_history ENABLE ROW LEVEL SECURITY", _sql())

    def test_no_policy_is_created(self):
        # RLS without policies denies anon/authenticated; service_role bypasses RLS.
        assert not re.search(r"CREATE POLICY", _sql(), re.IGNORECASE)

    def test_no_open_using_true(self):
        assert not re.search(r"USING\s*\(\s*true\s*\)", _sql(), re.IGNORECASE)

    def test_old_open_policy_is_dropped(self):
        assert 'DROP POLICY IF EXISTS "catalog_price_history_service_only"' in _sql()

    def test_client_roles_revoked(self):
        assert re.search(r"REVOKE ALL ON catalog_price_history FROM anon, authenticated", _sql())


MIGRATION_005 = MIGRATION_004.parent / "005_template_recipes.sql"


class TestRecipesMigration:
    """005 only adds columns: safe to run twice, never drops data."""

    def _sql(self) -> str:
        text = MIGRATION_005.read_text(encoding="utf-8")
        return "\n".join(line.split("--", 1)[0] for line in text.splitlines())

    def test_only_idempotent_adds(self):
        sql = self._sql()
        for line in re.findall(r"ADD COLUMN[^\n]*", sql):
            assert "IF NOT EXISTS" in line
        assert not re.search(r"DROP\s+(TABLE|COLUMN)", sql, re.IGNORECASE)
        assert not re.search(r"DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET", sql, re.IGNORECASE)

    def test_columns_used_by_the_code(self):
        sql = self._sql()
        for table, column in [
            ("indirect_config", "desperdicio_pct"),
            ("item_templates", "parametros"),
            ("item_templates", "desperdicio_pct"),
            ("budgets", "desperdicio_pct"),
            ("budget_items", "template_id"),
            ("budget_items", "parametros"),
            ("item_resources", "formula"),
            ("item_resources", "rendimiento"),
            ("item_resources", "desperdicio_origen"),
            ("item_resources", "lo_compra_cliente"),
            ("item_resources", "redondear"),
            ("item_resources", "unidad_compra"),
            ("item_resources", "cantidad_redondeo"),
        ]:
            assert re.search(
                rf"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column}\b", sql
            ), f"{table}.{column}"

    def test_no_open_policies(self):
        assert not re.search(r"USING\s*\(\s*true\s*\)", self._sql(), re.IGNORECASE)


MIGRATION_008 = MIGRATION_004.parent / "008_budget_prices_date.sql"


class TestBudgetPricesMigration:
    """008 only adds columns: safe to run twice, never drops data."""

    def _sql(self) -> str:
        text = MIGRATION_008.read_text(encoding="utf-8")
        return "\n".join(line.split("--", 1)[0] for line in text.splitlines())

    def test_only_idempotent_adds(self):
        sql = self._sql()
        for line in re.findall(r"ADD COLUMN[^\n]*", sql):
            assert "IF NOT EXISTS" in line
        assert not re.search(r"DROP\s+|DELETE\s+FROM|TRUNCATE|UPDATE\s+\w+\s+SET", sql, re.IGNORECASE)

    def test_columns_used_by_the_code(self):
        sql = self._sql()
        for table, column in [
            ("budgets", "indirectos"),
            ("budgets", "precios_al"),
            ("item_resources", "precio_fecha"),
            ("budget_versions", "precios_al"),
            ("budget_versions", "notas"),
        ]:
            assert re.search(
                rf"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column}\b", sql
            ), f"{table}.{column}"
