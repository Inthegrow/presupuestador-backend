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
