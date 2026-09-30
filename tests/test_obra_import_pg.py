"""SQL de import_obra.py contra un Postgres real: elección de precios (Fase 4) y controles.

Se saltea si no hay Postgres. Para correrlo:
    OBRA_TEST_PG="host=localhost port=5432 user=postgres" python3 -m pytest tests/test_obra_import_pg.py
Crea y borra la base obra_import_test (hace falta psql).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

from app.budget_prices import find_entry, pick_price
from import_obra import sql_script

DSN = os.environ.get("OBRA_TEST_PG")
DB = "obra_import_test"
ORG = "11111111-1111-1111-1111-111111111111"
MIGRATIONS = sorted(Path(__file__).resolve().parent.parent.joinpath("migrations").glob("0*.sql"))

pytestmark = pytest.mark.skipif(not DSN or not shutil.which("psql"), reason="sin OBRA_TEST_PG / psql")


def psql(sql: str, db: str = DB, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["psql", f"{DSN} dbname={db}", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-c", sql],
        capture_output=True, text=True, check=check,
    )


@pytest.fixture()
def db():  # type: ignore[no-untyped-def]
    psql(f"DROP DATABASE IF EXISTS {DB}", db="postgres")
    psql(f"CREATE DATABASE {DB}", db="postgres")
    psql("DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END$$;"
         "DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END$$;")
    for m in MIGRATIONS:
        subprocess.run(["psql", f"{DSN} dbname={DB}", "-v", "ON_ERROR_STOP=1", "-q", "-f", str(m)],
                       capture_output=True, text=True, check=True)
    psql(f"""
      INSERT INTO price_catalogs (id, org_id, name) VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001', '{ORG}', 'Maestro TERRAC - Materiales');
      INSERT INTO item_templates (org_id, nombre, codigo, origen, unidad, recursos)
      VALUES ('{ORG}', 'Prueba', 'T1', 'maestro_terrac', 'm2', '[]');
    """)
    yield
    psql(f"DROP DATABASE IF EXISTS {DB}", db="postgres")


def entry(codigo: str, precio: float | None, fecha: str | None, tipo: str = "material",
          historial: list[tuple[float | None, str | None, str]] = ()) -> str:
    """Insert a catalog entry (and its history) and return its id."""
    eid = psql(f"""INSERT INTO catalog_entries (catalog_id, org_id, tipo, codigo, precio_sin_iva, fecha_precio)
        VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '{ORG}', '{tipo}', '{codigo}',
                {'NULL' if precio is None else precio}, {'NULL' if fecha is None else repr(fecha)})
        RETURNING id""").stdout.split()[0]
    for p, f, created in historial:
        psql(f"""INSERT INTO catalog_price_history (entry_id, org_id, precio_sin_iva, fecha_precio, created_at)
            VALUES ('{eid}', '{ORG}', {'NULL' if p is None else p}, {'NULL' if f is None else repr(f)},
                    '{created}')""")
    return eid


def plan_with(codigos: list[str]) -> dict:
    recursos = [{"tipo": "material", "codigo": c, "descripcion": c, "unidad": "u", "cantidad": 1.0,
                 "trabajadores": 0, "dias": 0, "cargas_sociales_pct": 25, "desperdicio_pct": 0,
                 "formula": "Q", "rendimiento": None, "lo_compra_cliente": False, "redondear": False,
                 "unidad_compra": 1, "plantilla": "T1"} for c in codigos]
    item = {"orden": 0, "nivel": "item", "codigo": "1.1", "parent": None, "descripcion": "Ítem",
            "unidad": "m2", "cantidad": 1.0, "excel": {"mat_unit": 0, "mo_unit": 0, "directo": 0, "neto": 0},
            "fila": 8, "notas": [], "plantilla": "T1", "plantillas": ["T1"], "parametros": {},
            "recursos": recursos, "revisar": []}
    return {"items": [item], "sin_receta": [], "plantillas_faltantes": []}


def run(plan: dict, permitir: bool = False) -> subprocess.CompletedProcess:
    sql = sql_script(plan, "OBRA TEST", "obra.xlsx")
    if permitir:
        sql = sql.replace("v_permitir_sin_precio boolean := false", "v_permitir_sin_precio boolean := true")
    return subprocess.run(["psql", f"{DSN} dbname={DB}", "-v", "ON_ERROR_STOP=1", "-q"],
                          input=sql, capture_output=True, text=True)


def loaded_prices() -> dict[str, tuple[float, str]]:
    rows = psql("SELECT codigo, precio_unitario, coalesce(precio_fecha::text, '') FROM item_resources").stdout
    return {c: (float(p), f) for c, p, f in (line.split("|") for line in rows.splitlines())}


def test_old_positive_price_and_newest_without_price_stops(db) -> None:  # type: ignore[no-untyped-def]
    # Última carga sin precio (actual 0), historial viejo a $100: el precio vigente es 0 → se frena
    entry("AAA", 0, "2026-06-01", historial=[(100, "2026-01-01", "2026-01-01")])
    res = run(plan_with(["AAA"]))
    assert res.returncode != 0
    assert "AAA (sin precio al" in res.stderr
    assert psql("SELECT count(*) FROM budgets").stdout.strip() == "0"


def test_duplicated_code_stops(db) -> None:  # type: ignore[no-untyped-def]
    # Entrada vieja a $100 y otra nueva sin precio con el mismo código: es duplicado (como la Fase 4)
    entry("BBB", 100, "2026-01-01")
    entry("bbb", None, "2026-06-01")
    res = run(plan_with(["BBB"]))
    assert res.returncode != 0
    assert "BBB (codigo duplicado en el catalogo)" in res.stderr


def test_future_price_is_ignored_and_history_is_used(db) -> None:  # type: ignore[no-untyped-def]
    entry("CCC", 500, "2099-01-01", historial=[(200, "2026-01-01", "2026-01-01"),
                                               (500, "2099-01-01", "2026-09-01")])
    res = run(plan_with(["CCC"]))
    assert res.returncode == 0, res.stderr
    assert loaded_prices()["CCC"] == (200.0, "2026-01-01")


def test_forced_load_keeps_missing_at_zero(db) -> None:  # type: ignore[no-untyped-def]
    entry("DDD", 50, None)
    res = run(plan_with(["DDD", "NOEXISTE"]), permitir=True)
    assert res.returncode == 0, res.stderr
    prices = loaded_prices()
    assert prices["DDD"] == (50.0, "")
    assert prices["NOEXISTE"] == (0.0, "")


CASES = [
    # (precio actual, fecha actual, historial)
    (100, None, []),
    (None, "2026-03-01", [(80, "2026-02-01", "2026-02-01")]),
    (120, "2026-03-01", [(90, "2026-03-01", "2026-03-02")]),        # misma fecha: gana el actual
    (150, None, [(70, "2026-01-01", "2026-01-01")]),               # con fecha gana a sin fecha
    (300, "2099-01-01", [(60, None, "2026-01-01"), (65, None, "2026-02-01")]),  # sin fecha: el más nuevo
    (10, "2026-01-01", [(20, "2026-05-01", "2026-05-01"), (30, "2099-01-01", "2026-05-02")]),
]


@pytest.mark.parametrize("precio,fecha,historial", CASES)
def test_same_price_as_fase4(db, precio, fecha, historial) -> None:  # type: ignore[no-untyped-def]
    """The SQL picks the same entry and price as app/budget_prices.py."""
    eid = entry("EEE", precio, fecha, historial=historial)
    res = run(plan_with(["EEE"]))
    e = {"id": eid, "codigo": "EEE", "tipo": "material", "precio_sin_iva": precio, "fecha_precio": fecha}
    found, problem = find_entry({"codigo": "eee", "tipo": "material"}, {eid: e}, {"EEE": [e]})
    assert problem is None and found is e
    hist = [{"precio_sin_iva": p, "fecha_precio": f, "created_at": c} for p, f, c in historial]
    expected = pick_price(e, hist, date.today())
    assert res.returncode == 0, res.stderr
    assert loaded_prices()["EEE"] == (expected[0], expected[1] or "")
