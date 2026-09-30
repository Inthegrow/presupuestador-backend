"""
Importa las recetas del Excel "Maestro" de TERRAC (una solapa por ítem:
4.1.1, 5.1.1, ...) como plantillas, y la hoja CYP como árbol estándar.

Uso:
  # 1. Solo el informe (no toca la base):
  python3 import_recetas.py "MODELO DE PRESUPUESTACION RESUMEN.xlsx"

  # 2. Generar un SQL para pegar en el SQL Editor de Supabase (sin claves):
  python3 import_recetas.py "MODELO DE PRESUPUESTACION RESUMEN.xlsx" --sql output/carga_maestro_terrac.sql

El SQL es la única vía de carga: es una sola transacción, así que el árbol
se reemplaza completo o no se toca. Antes hay que correr
migrations/006_maestro_recipes.sql. Se puede correr de nuevo: las plantillas
se actualizan por código (los presupuestos no pierden el enlace) y no se
pisan las editadas a mano ni las de otro origen.

Siempre se escribe el informe ítem por ítem
(por defecto en output/informe_maestro_recetas.md).
"""

from __future__ import annotations

import argparse
import json
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


def _lit(value: object) -> str:
    """SQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def _jsonb(value: object) -> str:
    return _lit(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def sql_script(parsed: dict, source_file: str = "") -> str:
    """Load templates and the standard tree as one SQL script (Supabase SQL Editor).

    The org_id is detected when the database has a single organization;
    otherwise the script stops and asks to paste it in v_org.
    """
    tpl_rows = []
    for tmpl in parsed["plantillas"]:
        p = template_payload(tmpl)
        tpl_rows.append(
            f"    ({_lit(p['codigo'])}, {_lit(p['nombre'])}, {_lit(p['descripcion'])}, "
            f"{_lit(p['unidad'])}, {_lit(p['categoria'])}, {_jsonb(p['parametros'])}, "
            f"{_jsonb(p['recursos'])})"
        )
    node_rows = [
        f"    ({_lit(n['codigo'])}, {_lit(n['parent'])}, {_lit(n['nombre'])}, {_lit(n['unidad'] or None)}, "
        f"{_lit(n['nivel'])}, {n['orden']}, {_lit(n.get('plantilla'))}, {_lit(bool(n.get('libre')))})"
        for n in parsed["arbol"]
    ]
    nodes_values = ",\n".join(node_rows)
    tpl_values = ",\n".join(tpl_rows)
    return f"""-- Carga del Maestro TERRAC: {len(tpl_rows)} plantillas y el arbol CYP ({len(node_rows)} filas).
-- Generado por import_recetas.py a partir de {source_file or 'el Excel Maestro'}.
-- Pegar todo en el SQL Editor de Supabase (proyecto DATA) y apretar Run.
-- Antes: migrations/006_maestro_recipes.sql. Se puede correr de nuevo sin duplicar.

-- El bloque DO es una sola transaccion: si algo falla (o el texto se pego incompleto),
-- no se escribe nada.

-- Marca de "editada despues de importar" (igual que migrations/007_template_edits.sql)
ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS editado boolean NOT NULL DEFAULT false;

DO $maestro$
DECLARE
  v_org  uuid := NULL;  -- si hay mas de una organizacion, pegar aca el org_id de TERRAC entre comillas
  v_tree uuid;
  n_orgs int;
BEGIN
  IF v_org IS NULL THEN
    SELECT count(DISTINCT org_id) INTO n_orgs FROM (
      SELECT org_id FROM budgets UNION SELECT org_id FROM catalog_entries
      UNION SELECT org_id FROM item_templates) o;
    IF n_orgs <> 1 THEN
      RAISE EXCEPTION 'Hay % organizaciones: pegar el org_id de TERRAC en v_org, al principio del script', n_orgs;
    END IF;
    SELECT org_id INTO v_org FROM (
      SELECT org_id FROM budgets UNION SELECT org_id FROM catalog_entries
      UNION SELECT org_id FROM item_templates) o LIMIT 1;
  END IF;

  -- 1. Plantillas (se actualizan por codigo: los presupuestos no pierden el enlace)
  INSERT INTO item_templates (org_id, codigo, nombre, descripcion, unidad, categoria,
                              parametros, recursos, origen)
  SELECT v_org, t.* , 'maestro_terrac' FROM (VALUES
{tpl_values}
  ) AS t(codigo, nombre, descripcion, unidad, categoria, parametros, recursos)
  ON CONFLICT (org_id, codigo) WHERE codigo IS NOT NULL DO UPDATE SET
    nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, unidad = EXCLUDED.unidad,
    categoria = EXCLUDED.categoria, parametros = EXCLUDED.parametros,
    recursos = EXCLUDED.recursos, updated_at = now()
  -- No pisa plantillas de otro origen ni las editadas despues de importar
  WHERE item_templates.origen = 'maestro_terrac' AND NOT item_templates.editado;

  -- 2. Arbol estandar (se reemplaza entero)
  INSERT INTO standard_trees (org_id, nombre, source_file)
  VALUES (v_org, {_lit(TREE_NAME)}, {_lit(source_file)})
  ON CONFLICT (org_id, nombre) DO UPDATE SET source_file = EXCLUDED.source_file, updated_at = now()
  RETURNING id INTO v_tree;

  DELETE FROM standard_tree_nodes WHERE tree_id = v_tree;

  INSERT INTO standard_tree_nodes (tree_id, org_id, codigo, nombre, unidad, nivel, orden,
                                   template_id, libre)
  SELECT v_tree, v_org, n.codigo, n.nombre, n.unidad, n.nivel, n.orden,
         (SELECT id FROM item_templates it WHERE it.org_id = v_org AND it.codigo = n.plantilla),
         n.libre
  FROM (VALUES
{nodes_values}
  ) AS n(codigo, parent, nombre, unidad, nivel, orden, plantilla, libre);

  UPDATE standard_tree_nodes c SET parent_id = p.id
  FROM (VALUES
{nodes_values}
  ) AS n(codigo, parent, nombre, unidad, nivel, orden, plantilla, libre)
  JOIN standard_tree_nodes p ON p.tree_id = v_tree AND p.codigo = n.parent
  WHERE c.tree_id = v_tree AND c.codigo = n.codigo;
END
$maestro$;

-- Verificacion: tiene que dar plantillas = {len(tpl_rows)} y filas_arbol = {len(node_rows)}
-- (editadas_conservadas: plantillas editadas a mano que no se pisaron)
SELECT
  (SELECT count(*) FROM item_templates WHERE origen = 'maestro_terrac') AS plantillas,
  (SELECT count(*) FROM item_templates WHERE origen = 'maestro_terrac' AND editado) AS editadas_conservadas,
  (SELECT count(*) FROM standard_tree_nodes n JOIN standard_trees t ON t.id = n.tree_id
    WHERE t.nombre = {_lit(TREE_NAME)}) AS filas_arbol;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Importar recetas y árbol del Maestro TERRAC")
    parser.add_argument("excel", help="Ruta al Excel Maestro (.xlsx)")
    parser.add_argument("--report", default="output/informe_maestro_recetas.md", help="Informe Markdown")
    parser.add_argument("--json", default=None, help="Guardar también el resultado en JSON")
    parser.add_argument("--sql", default=None,
                        help="Guardar la carga como SQL para pegar en el SQL Editor de Supabase")
    args = parser.parse_args()

    parsed = parse_file(args.excel)
    name = Path(args.excel).name
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(report_markdown(parsed, name), encoding="utf-8")
    if args.json:
        payload = {"plantillas": [template_payload(t) for t in parsed["plantillas"]], "arbol": parsed["arbol"]}
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    if args.sql:
        Path(args.sql).write_text(sql_script(parsed, name), encoding="utf-8")
        print(f"SQL para el SQL Editor de Supabase: {args.sql}")

    n_rev = sum(1 for t in parsed["plantillas"] for r in t["recursos"] if r.get("revisar"))
    n_rec = sum(len(t["recursos"]) for t in parsed["plantillas"])
    print(f"{len(parsed['plantillas'])} plantillas, {n_rec} recursos ({n_rev} para revisar), "
          f"{len(parsed['arbol'])} filas de árbol. Informe: {args.report}")

    if not args.sql:
        print("Solo informe: no se generó el SQL de carga (usar --sql).")

if __name__ == "__main__":
    main()
