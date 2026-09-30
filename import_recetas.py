"""
Importa las recetas del Excel "Maestro" de TERRAC (una solapa por ítem:
4.1.1, 5.1.1, ...) como plantillas, y la hoja CYP como árbol estándar.

Uso:
  # 1. Solo el informe (no toca la base):
  python3 import_recetas.py "MODELO DE PRESUPUESTACION RESUMEN.xlsx"

  # 2. Cargar en Supabase:
  python3 import_recetas.py "MODELO DE PRESUPUESTACION RESUMEN.xlsx" --apply

Para --apply hacen falta las variables de entorno:
  DATA_SUPABASE_URL  o  SUPABASE_URL
  DATA_SUPABASE_KEY  o  SUPABASE_KEY
  ORG_ID

Antes de --apply hay que correr migrations/006_maestro_recipes.sql.
Se puede correr de nuevo: las plantillas se actualizan por código (los
presupuestos que las usan no pierden el enlace) y el árbol se reemplaza.

Siempre se escribe el informe ítem por ítem
(por defecto en output/informe_maestro_recetas.md).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings
from pathlib import Path

import openpyxl

from app.maestro_import import parse_workbook
from app.maestro_recipes import parse_maestro, report_markdown, template_payload

TREE_NAME = "TERRAC - Maestro"


def load_workbooks(path: str):  # type: ignore[no-untyped-def]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(path), openpyxl.load_workbook(path, data_only=True)


def parse_file(path: str) -> dict:
    wb_f, wb_v = load_workbooks(path)
    entries_by_tipo, _ = parse_workbook(wb_v)
    return parse_maestro(wb_f, wb_v, entries_by_tipo)


def apply_to_db(db, org_id: str, parsed: dict, source_file: str = "") -> dict:  # type: ignore[no-untyped-def]
    """Upsert templates by (org_id, codigo) and replace the standard tree."""
    template_ids: dict[str, str] = {}
    created = updated = 0
    for tmpl in parsed["plantillas"]:
        payload = {**template_payload(tmpl), "org_id": org_id}
        found = (
            db.table("item_templates").select("id")
            .eq("org_id", org_id).eq("codigo", payload["codigo"]).limit(1).execute()
        )
        if found.data:
            tid = found.data[0]["id"]
            db.table("item_templates").update(payload).eq("id", tid).eq("org_id", org_id).execute()
            updated += 1
        else:
            res = db.table("item_templates").insert(payload).execute()
            tid = res.data[0]["id"]
            created += 1
        template_ids[tmpl["codigo"]] = tid

    tree = db.table("standard_trees").select("id").eq("org_id", org_id).eq("nombre", TREE_NAME).limit(1).execute()
    if tree.data:
        tree_id = tree.data[0]["id"]
        db.table("standard_tree_nodes").delete().eq("tree_id", tree_id).eq("org_id", org_id).execute()
        db.table("standard_trees").update({"source_file": source_file}).eq("id", tree_id).execute()
    else:
        tree_id = db.table("standard_trees").insert({
            "org_id": org_id, "nombre": TREE_NAME, "source_file": source_file,
        }).execute().data[0]["id"]

    node_ids: dict[str, str] = {}
    for node in parsed["arbol"]:  # ordered: parents come first
        row = {
            "tree_id": tree_id,
            "org_id": org_id,
            "parent_id": node_ids.get(node["parent"]) if node["parent"] else None,
            "codigo": node["codigo"],
            "nombre": node["nombre"],
            "unidad": node["unidad"] or None,
            "nivel": node["nivel"],
            "orden": node["orden"],
            "template_id": template_ids.get(node.get("plantilla") or ""),
            "libre": bool(node.get("libre")),
        }
        node_ids[node["codigo"]] = db.table("standard_tree_nodes").insert(row).execute().data[0]["id"]

    return {"plantillas_creadas": created, "plantillas_actualizadas": updated,
            "arbol_id": tree_id, "nodos": len(node_ids)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Importar recetas y árbol del Maestro TERRAC")
    parser.add_argument("excel", help="Ruta al Excel Maestro (.xlsx)")
    parser.add_argument("--apply", action="store_true", help="Escribir en Supabase")
    parser.add_argument("--report", default="output/informe_maestro_recetas.md", help="Informe Markdown")
    parser.add_argument("--json", default=None, help="Guardar también el resultado en JSON")
    args = parser.parse_args()

    parsed = parse_file(args.excel)
    name = Path(args.excel).name
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(report_markdown(parsed, name), encoding="utf-8")
    if args.json:
        payload = {"plantillas": [template_payload(t) for t in parsed["plantillas"]], "arbol": parsed["arbol"]}
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    n_rev = sum(1 for t in parsed["plantillas"] for r in t["recursos"] if r.get("revisar"))
    n_rec = sum(len(t["recursos"]) for t in parsed["plantillas"])
    print(f"{len(parsed['plantillas'])} plantillas, {n_rec} recursos ({n_rev} para revisar), "
          f"{len(parsed['arbol'])} filas de árbol. Informe: {args.report}")

    if not args.apply:
        print("Modo informe: no se escribió nada en la base (usar --apply).")
        return

    from supabase import create_client

    url = os.environ.get("DATA_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("DATA_SUPABASE_KEY") or os.environ.get("SUPABASE_KEY")
    org_id = os.environ.get("ORG_ID")
    if not url or not key or not org_id:
        sys.exit("ERROR: faltan DATA_SUPABASE_URL, DATA_SUPABASE_KEY u ORG_ID")
    result = apply_to_db(create_client(url, key), org_id, parsed, name)
    print(f"Listo: {result}")


if __name__ == "__main__":
    main()
