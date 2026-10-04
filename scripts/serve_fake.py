"""Levanta la app con una base en memoria: recetas del Maestro + 4 catálogos (Maestro, Las Heras, Lugones, El Encuentro).

Uso (desde la raíz del repo):
  EXCEL_DIR=<carpeta con ginkgo.xlsx y maestro.xlsx> python3 scripts/serve_fake.py   (puerto 8000)
  cd frontend && VITE_AUTH_ENABLED=false npx vite --port 5179
  EXCEL_DIR=<la misma carpeta> NODE_PATH=<node_modules con playwright> node scripts/e2e_ginkgo.cjs
Los dos Excel se bajan de Drive (ver HANDOFF, sección 7). La primera corrida tarda ~30 s y deja un caché JSON en EXCEL_DIR.
"""
from __future__ import annotations

import json
import os
import sys
import uuid
import warnings
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5179,http://127.0.0.1:5179")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import openpyxl  # noqa: E402

from app.maestro_import import TIPO_LABELS, parse_workbook  # noqa: E402
from app.maestro_recipes import template_payload  # noqa: E402
from tests.test_recipes_api import ORG, FakeDB, Query  # noqa: E402

HERE = Path(__file__).resolve().parent
EXCEL = Path(os.environ.get("EXCEL_DIR") or HERE / "excel")
CACHE = EXCEL / "fake_db_cache.json"
LAS_HERAS = str(Path(__file__).resolve().parent.parent / "branding") + "/MODELOS DE EXCELS/EDIFICIO LAS HERAS-OBRA GRIS_Computo y Presupuesto.xlsx"
LUGONES = str(Path(__file__).resolve().parent.parent / "branding") + "/MODELOS DE EXCELS/Copia de CASA LUGONES_Computo y Presupuesto_v1.xlsx"
ENCUENTRO = str(Path(__file__).resolve().parent.parent / "branding") + "/MODELOS DE EXCELS/Copia de El ENCUENTRO_Computo y Presupuesto.xlsx"


def _ilike(self, col, pattern):
    self._ilike = (col, pattern.strip("%").lower())
    return self


_orig_match = Query._match


def _match(self, row):
    if not _orig_match(self, row):
        return False
    il = getattr(self, "_ilike", None)
    if il:
        return il[1] in str(row.get(il[0]) or "").lower()
    return True


Query.ilike = _ilike
Query._match = _match


def catalogs_from(path: str, prefix: str, created: str, oficial: bool) -> tuple[list[dict], list[dict]]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    by_tipo, _ = parse_workbook(wb)
    cats, entries = [], []
    for tipo, rows in by_tipo.items():
        if not rows:
            continue
        cid = str(uuid.uuid4())
        cats.append({"id": cid, "org_id": ORG, "name": f"{prefix} - {TIPO_LABELS[tipo]}", "source_file": Path(path).name,
                     "created_at": created, "oficial": oficial})
        for r in rows:
            entries.append({"id": str(uuid.uuid4()), "catalog_id": cid, "org_id": ORG, "tipo": tipo,
                            "codigo": r["codigo"], "descripcion": r["descripcion"], "unidad": r["unidad"],
                            "precio_sin_iva": r["precio_sin_iva"], "precio_con_iva": r.get("precio_con_iva"),
                            "fecha_precio": r["fecha_precio"], "proveedor": r.get("proveedor")})
    return cats, entries


def build_tables() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text())
    from import_recetas import parse_file
    parsed = parse_file(str(EXCEL / "maestro.xlsx"))
    templates = []
    for t in parsed["plantillas"]:
        p = template_payload(t)
        templates.append({**p, "id": str(uuid.uuid4()), "org_id": ORG, "desperdicio_pct": None, "editado": False})
    cats, entries = [], []
    for path, prefix, created, oficial in [
        (str(EXCEL / "maestro.xlsx"), "Maestro TERRAC", "2026-09-29T10:00:00+00:00", False),
        (LAS_HERAS, "Las Heras", "2026-06-01T10:00:00+00:00", False),
        (LUGONES, "Lugones", "2026-05-01T10:00:00+00:00", False),
        (ENCUENTRO, "El Encuentro", "2026-04-01T10:00:00+00:00", False),
    ]:
        c, e = catalogs_from(path, prefix, created, oficial)
        cats += c
        entries += e
    tables = {
        "budgets": [], "budget_items": [], "item_resources": [], "budget_versions": [], "audit_logs": [],
        "item_templates": templates,
        "indirect_config": [{"id": "cfg", "org_id": ORG, "desperdicio_pct": 5}],
        "price_catalogs": cats, "catalog_entries": entries, "catalog_price_history": [],
        "obra_recetas_memoria": [], "standard_trees": [], "standard_tree_nodes": [],
    }
    CACHE.write_text(json.dumps(tables, ensure_ascii=False, default=str))
    return tables


def main() -> None:
    tables = build_tables()
    print({k: len(v) for k, v in tables.items()})
    fake = FakeDB(tables)
    import app.db as dbmod
    from app import routers
    dbmod.get_data_db = lambda: fake  # type: ignore[assignment]
    import importlib
    import pkgutil
    for m in pkgutil.iter_modules(routers.__path__):
        mod = importlib.import_module(f"app.routers.{m.name}")
        if hasattr(mod, "get_data_db"):
            mod.get_data_db = lambda: fake  # type: ignore[attr-defined]
    from app.auth import get_current_user
    from app.main import create_app
    application = create_app()
    application.dependency_overrides[get_current_user] = lambda: {"user_id": "sol", "org_id": ORG}
    import uvicorn
    uvicorn.run(application, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
