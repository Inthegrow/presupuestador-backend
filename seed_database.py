"""
Seed script: carga Las Heras (real) + Torre Belgrano (inventado) en Supabase.
Uso: python3 seed_database.py

Requiere variables de entorno:
  DATA_SUPABASE_URL  o  SUPABASE_URL
  DATA_SUPABASE_KEY  o  SUPABASE_KEY
  ORG_ID  (el org_id de tu organización en Supabase)
"""

import json
import os
import sys
import random

from supabase import create_client
from app.calculations import fraction_to_pct

# --- Config ---
URL = os.environ.get("DATA_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
KEY = os.environ.get("DATA_SUPABASE_KEY") or os.environ.get("SUPABASE_KEY")
ORG_ID = os.environ.get("ORG_ID")

if not URL or not KEY:
    print("ERROR: Necesitás las variables DATA_SUPABASE_URL y DATA_SUPABASE_KEY")
    print("  export DATA_SUPABASE_URL=https://tu-proyecto.supabase.co")
    print("  export DATA_SUPABASE_KEY=tu-service-role-key")
    sys.exit(1)

if not ORG_ID:
    print("ERROR: Necesitás la variable ORG_ID")
    print("  export ORG_ID=tu-org-id-de-supabase")
    print("")
    print("Para encontrar tu org_id:")
    print("  1. Andá a tu Supabase AUTH project (EOS)")
    print("  2. Tabla 'memberships' → buscá tu user → copiá el org_id")
    sys.exit(1)

db = create_client(URL, KEY)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def seed_project(name, description, status, seed_dir, source_file, modify_prices=False):
    """Seed one complete project from JSON files."""
    print(f"\n{'='*50}")
    print(f"Cargando: {name}")
    print(f"{'='*50}")

    # 1. Create budget
    budget = db.table("budgets").insert({
        "org_id": ORG_ID,
        "name": name,
        "description": description,
        "source_file": source_file,
        "status": status,
    }).execute()
    budget_id = budget.data[0]["id"]
    print(f"  ✓ Budget creado: {budget_id}")

    # 2. Create price catalog
    catalog = db.table("price_catalogs").insert({
        "org_id": ORG_ID,
        "name": f"Catálogo {name} — Abr 2026",
        "source_file": source_file,
    }).execute()
    catalog_id = catalog.data[0]["id"]

    # 3. Load and insert catalog entries
    total_entries = 0
    for cat_file, tipo in [
        ("catalogo_materiales.json", "material"),
        ("catalogo_mano_obra.json", "mano_obra"),
        ("catalogo_equipos.json", "equipo"),
        ("catalogo_subcontratos.json", "subcontrato"),
    ]:
        filepath = os.path.join(seed_dir, cat_file)
        if not os.path.exists(filepath):
            continue
        entries = load_json(filepath)
        if not entries:
            continue

        to_insert = []
        for e in entries:
            precio_iva = e.get("precio_con_iva") or 0
            precio_sin = e.get("precio_sin_iva") or e.get("precio") or 0

            if modify_prices and precio_sin:
                # Vary prices ±15% for the invented project
                factor = 1 + random.uniform(-0.15, 0.15)
                precio_sin = round(precio_sin * factor, 2)
                precio_iva = round(precio_iva * factor, 2) if precio_iva else 0

            to_insert.append({
                "catalog_id": catalog_id,
                "org_id": ORG_ID,
                "tipo": tipo,
                "codigo": e.get("codigo"),
                "descripcion": e.get("descripcion"),
                "unidad": e.get("unidad"),
                "precio_con_iva": precio_iva,
                "precio_sin_iva": precio_sin,
            })

        # Batch insert
        for i in range(0, len(to_insert), 100):
            batch = to_insert[i:i+100]
            db.table("catalog_entries").insert(batch).execute()
            total_entries += len(batch)

    print(f"  ✓ Catálogo: {total_entries} entries")

    # 4. Load and insert budget items
    items_file = os.path.join(seed_dir, "items_presupuesto.json")
    if not os.path.exists(items_file):
        print("  ⚠ No items file found")
        return budget_id

    items_data = load_json(items_file)
    code_to_db_id = {}
    items_inserted = 0

    for idx, item in enumerate(items_data):
        code = item.get("code")
        is_section = item.get("is_section", False)

        # Find parent by code hierarchy
        parent_id = None
        if code and "." in code:
            parts = code.split(".")
            for depth in range(len(parts) - 1, 0, -1):
                candidate = ".".join(parts[:depth])
                if candidate in code_to_db_id:
                    parent_id = code_to_db_id[candidate]
                    break

        mat_total = item.get("mat_total") or 0
        mo_total = item.get("mo_total") or 0
        directo = item.get("directo_total") or 0
        indirecto = item.get("indirecto_total") or 0
        beneficio = item.get("beneficio_total") or 0
        neto = item.get("neto_total") or 0

        if modify_prices and directo:
            factor = 1 + random.uniform(-0.10, 0.10)
            mat_total = round(mat_total * factor, 2)
            mo_total = round(mo_total * factor, 2)
            directo = round(mat_total + mo_total, 2)
            indirecto = round(indirecto * factor, 2)
            beneficio = round(beneficio * factor, 2)
            neto = round(directo + indirecto + beneficio, 2)

        row = {
            "budget_id": budget_id,
            "org_id": ORG_ID,
            "parent_id": parent_id,
            "code": code,
            "description": item.get("description"),
            "unidad": item.get("unidad") if not is_section else None,
            "cantidad": item.get("cantidad"),
            "mat_unitario": item.get("mat_unitario") or 0,
            "mo_unitario": item.get("mo_unitario") or 0,
            "mat_total": mat_total,
            "mo_total": mo_total,
            "directo_total": directo,
            "indirecto_total": indirecto,
            "beneficio_total": beneficio,
            "neto_total": neto,
            "notas": "Sección" if is_section else "Seed data",
            "sort_order": idx,
        }

        result = db.table("budget_items").insert(row).execute()
        if result.data:
            db_id = result.data[0]["id"]
            if code:
                code_to_db_id[code] = db_id
            items_inserted += 1

    print(f"  ✓ Items: {items_inserted}")

    # 5. Load and insert resources
    resources_file = os.path.join(seed_dir, "recursos_por_item.json")
    if not os.path.exists(resources_file):
        print("  ⚠ No resources file")
        return budget_id

    resources_data = load_json(resources_file)
    resources_inserted = 0

    for item_code, resources in resources_data.items():
        item_db_id = code_to_db_id.get(item_code)
        if not item_db_id:
            continue

        to_insert = []
        for r in resources:
            precio = r.get("precio_unitario") or 0
            if modify_prices and precio:
                precio = round(precio * (1 + random.uniform(-0.15, 0.15)), 2)

            to_insert.append({
                "item_id": item_db_id,
                "org_id": ORG_ID,
                "tipo": r.get("tipo"),
                "codigo": r.get("codigo"),
                "descripcion": r.get("descripcion"),
                "unidad": r.get("unidad"),
                "cantidad": r.get("cantidad"),
                "desperdicio_pct": fraction_to_pct(r.get("desperdicio_pct")),
                "cantidad_efectiva": r.get("cantidad_efectiva"),
                "precio_unitario": precio,
                "subtotal": r.get("subtotal") or 0,
            })

        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i+50]
            db.table("item_resources").insert(batch).execute()
            resources_inserted += len(batch)

    print(f"  ✓ Recursos: {resources_inserted}")

    # 6. Create indirect config (if not exists)
    existing = db.table("indirect_config").select("id").eq("org_id", ORG_ID).execute()
    if not existing.data:
        db.table("indirect_config").insert({
            "org_id": ORG_ID,
            "estructura_pct": 0.15,
            "jefatura_pct": 0.08,
            "logistica_pct": 0.05,
            "herramientas_pct": 0.03,
        }).execute()
        print("  ✓ Indirect config creada (15% + 8% + 5% + 3%)")

    print(f"\n  LISTO: {name} cargado con {items_inserted} items y {resources_inserted} recursos")
    return budget_id


if __name__ == "__main__":
    print("SEED DATABASE — Presupuestador SOLE v3")
    print("=" * 50)
    print(f"Supabase: {URL[:40]}...")
    print(f"Org ID: {ORG_ID}")
    print()

    # 1. Las Heras (datos reales)
    seed_project(
        name="Edificio Las Heras — Obra Gris",
        description="Edificio 8 pisos + subsuelo. 2.663 m². 16 meses. Datos reales Terrac.",
        status="active",
        seed_dir="seed_data/las_heras",
        source_file="EDIFICIO LAS HERAS-OBRA GRIS_Computo y Presupuesto.xlsx",
        modify_prices=False,
    )

    # 2. Torre Belgrano (inventado, basado en Lugones con precios modificados)
    seed_project(
        name="Torre Belgrano Centro",
        description="Refacción integral edificio céntrico. 3 pisos. 12 meses. Proyecto demo.",
        status="draft",
        seed_dir="seed_data/lugones",
        source_file="demo_torre_belgrano.xlsx",
        modify_prices=True,  # Varía precios ±15% para que sea diferente
    )

    print("\n" + "=" * 50)
    print("SEED COMPLETO")
    print("=" * 50)
    print("Las Heras: datos reales del Excel")
    print("Torre Belgrano: inventado (basado en Lugones, precios ±15%)")
    print()
    print("Ahora podés cargar Lugones y El Encuentro a mano desde la app.")
