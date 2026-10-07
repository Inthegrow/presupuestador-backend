from __future__ import annotations

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ── Legacy (fallback) ────────────────────────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_KEY: str

    # ── Modelo C: Auth compartida + Data separada ────────────────────────────
    # Auth client → EOS Supabase (JWT, memberships, organizations)
    AUTH_SUPABASE_URL: str | None = None
    AUTH_SUPABASE_KEY: str | None = None

    # Data client → Presupuestador Supabase (budgets, items, catalogs, etc.)
    DATA_SUPABASE_URL: str | None = None
    DATA_SUPABASE_KEY: str | None = None

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    # OpenAI (optional — AI endpoints return 503 if missing)
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL_VISION: str = "gpt-4o"
    # Buscador de precios en internet (app/price_search.py): Responses API + búsqueda web
    OPENAI_MODEL_PRECIOS: str = "gpt-4.1"

    # Server
    PORT: int = 8000

    @cached_property
    def auth_url(self) -> str:
        """Supabase URL for auth (EOS). Falls back to SUPABASE_URL."""
        return self.AUTH_SUPABASE_URL or self.SUPABASE_URL

    @cached_property
    def auth_key(self) -> str:
        """Supabase key for auth (EOS). Falls back to SUPABASE_KEY."""
        return self.AUTH_SUPABASE_KEY or self.SUPABASE_KEY

    @cached_property
    def data_url(self) -> str:
        """Supabase URL for data (presupuestador). Falls back to SUPABASE_URL."""
        return self.DATA_SUPABASE_URL or self.SUPABASE_URL

    @cached_property
    def data_key(self) -> str:
        """Supabase key for data (presupuestador). Falls back to SUPABASE_KEY."""
        return self.DATA_SUPABASE_KEY or self.SUPABASE_KEY

    @cached_property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @cached_property
    def openai_client(self):
        if not self.OPENAI_API_KEY:
            return None
        from openai import AsyncOpenAI

        return AsyncOpenAI(api_key=self.OPENAI_API_KEY)


def get_settings() -> Settings:
    return Settings()
