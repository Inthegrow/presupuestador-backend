"""
Fase 5: carga el cómputo de una obra real (hoja 01_C&P) como presupuesto nuevo,
tomando del Excel solo las cantidades y calculando los precios con las recetas del Maestro.

Uso:
  # 1. Solo el informe (no toca la base):
  python3 import_obra.py "EDIFICIO GINKGO_Computo y Presupuesto_V2.xlsx" \
      --maestro "MODELO DE PRESUPUESTACION RESUMEN.xlsx"

  # 2. Generar el SQL para pegar en el SQL Editor de Supabase (sin claves):
  python3 import_obra.py "EDIFICIO GINKGO_Computo y Presupuesto_V2.xlsx" \
      --maestro "MODELO DE PRESUPUESTACION RESUMEN.xlsx" --sql output/carga_obra_ginkgo.sql

Antes de correr el SQL tienen que estar cargados los catálogos (Fase 1, import_maestro.py),
las plantillas del Maestro (Fase 3, import_recetas.py) y migrations/008 (Fase 4).
El presupuesto arranca con los indirectos generales y precios al día de hoy, como uno nuevo en la app. Si falta alguna plantilla,
el SQL se frena sin escribir nada.

- Ítems con receta: los recursos salen de la plantilla con la cantidad del ítem;
  el precio se busca en el catálogo al correr el SQL.
- Ítems sin receta: se cargan con el precio unitario del Excel de la obra.
- El SQL es una sola transacción y no se puede correr dos veces: si el presupuesto
  ya existe, se frena. También se frena si hay recursos sin precio en el catálogo
  (se puede forzar con v_permitir_sin_precio := true al principio del SQL).
- Después de cargarlo: Cadena de Markups (desde el presupuesto) > "Recalcular obra". Ese paso aplica
  el redondeo de compra, los indirectos y el beneficio (el botón "Recalcular" de totales no).
  Comparar contra el Excel recién después de ese paso.
"""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import openpyxl

from app.budget_prices import INDIRECT_DEFAULTS
from app.obra_import import build_plan, item_notes, parse_obra, report_markdown


def load(path: str, data_only: bool = True):  # type: ignore[no-untyped-def]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(path, data_only=data_only)


def maestro_templates(path: str) -> dict[str, dict]:
    """Plantillas del Maestro, igual que las carga la Fase 3 (import_recetas.py)."""
    from app.maestro_import import parse_workbook
    from app.maestro_recipes import parse_maestro, template_payload

    wb_f, wb_v = load(path, data_only=False), load(path)
    entries_by_tipo, _ = parse_workbook(wb_v)
    parsed = parse_maestro(wb_f, wb_v, entries_by_tipo)
    return {t["codigo"]: template_payload(t) for t in parsed["plantillas"]}


def _lit(value: object) -> str:
    """SQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(float(value))
    return "'" + str(value).replace("'", "''") + "'"


def _jsonb(value: object) -> str:
    return _lit(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def sql_script(plan: dict, budget_name: str, source_file: str = "") -> str:
    """Budget, items and resources as one SQL transaction (Supabase SQL Editor)."""
    items = plan["items"]
    codes = sorted({c for i in items for c in (i.get("plantillas") or [])})

    item_rows = []
    for i in items:
        ex = i.get("excel") or {}
        sin = i["nivel"] == "item" and not i.get("plantilla")
        item_rows.append(
            f"    ({i['orden']}, {_lit(i['parent'])}::int, {_lit(i['codigo'])}, {_lit(i['descripcion'])}, "
            f"{_lit(i['unidad'])}, {_lit(i['cantidad'])}::numeric, {_lit(i.get('plantilla'))}, "
            f"{_jsonb(i.get('parametros') or {})}, "
            f"{_lit(ex.get('mat_unit', 0) if sin else None)}::numeric, "
            f"{_lit(ex.get('mo_unit', 0) if sin else None)}::numeric, {_lit(item_notes(i))})"
        )

    res_rows = []
    for i in items:
        for r in i.get("recursos") or []:
            res_rows.append(
                f"    ({i['orden']}, {_lit(r['plantilla'])}, {_lit(r['tipo'])}, {_lit(r['codigo'])}, "
                f"{_lit(r['descripcion'])}, {_lit(r['unidad'])}, {_lit(r.get('cantidad', 0))}::numeric, "
                f"{_lit(r.get('trabajadores', 0))}::numeric, {_lit(r.get('dias', 0))}::numeric, "
                f"{_lit(r['cargas_sociales_pct'])}::numeric, {_lit(r['desperdicio_pct'])}::numeric, "
                f"{_lit(r['formula'])}, {_lit(r['rendimiento'])}, {_lit(r['lo_compra_cliente'])}, "
                f"{_lit(r['redondear'])}, {_lit(r['unidad_compra'])}::numeric)"
            )

    n_items = sum(1 for i in items if i["nivel"] == "item")
    n_sin = len(plan["sin_receta"])
    items_values = ",\n".join(item_rows)
    res_values = ",\n".join(res_rows) or "    (NULL::int, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 25, NULL, NULL, NULL, false, false, 1)"
    indirect_pairs = ", ".join(
        f"'{k}', coalesce((x.c->>'{k}')::numeric, {v})" for k, v in INDIRECT_DEFAULTS.items()
    )
    codes_array = "ARRAY[" + ", ".join(_lit(c) for c in codes) + "]::text[]" if codes else "ARRAY[]::text[]"

    return f"""-- Fase 5: carga de {budget_name} ({n_items} items: {n_items - n_sin} con receta, {n_sin} sin receta).
-- Generado por import_obra.py a partir de {source_file or 'el Excel de la obra'}.
-- Pegar todo en el SQL Editor de Supabase (proyecto DATA) y apretar Run.
-- Antes: catalogos (Fase 1), plantillas del Maestro (Fase 3) y migrations/008 (Fase 4).
-- Una sola transaccion: si algo falla, no se escribe nada. Se frena si el presupuesto ya existe
-- o si hay recursos sin precio en el catalogo.
-- DESPUES DE CARGAR: abrir el presupuesto > Cadena de Markups > "Recalcular obra".
-- Recien ahi se aplican el redondeo de compra, los indirectos y el beneficio. Comparar contra
-- el Excel despues de ese paso, no antes.

DO $obra$
DECLARE
  v_org     uuid := NULL;  -- si hay mas de una organizacion, pegar aca el org_id de TERRAC entre comillas
  v_budget  uuid;
  v_waste   numeric;
  v_ind     jsonb;
  v_permitir_sin_precio boolean := false;  -- true = cargar igual los recursos sin precio (quedan en $0)
  n_orgs    int;
  faltan    text;
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

  -- 0. Controles: plantillas del Maestro cargadas y presupuesto no cargado antes
  SELECT string_agg(c, ', ') INTO faltan FROM unnest({codes_array}) AS c
  WHERE NOT EXISTS (SELECT 1 FROM item_templates t WHERE t.org_id = v_org AND t.codigo = c);
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Faltan plantillas del Maestro: %. Cargar primero la Fase 3 (import_recetas.py)', faltan;
  END IF;
  IF EXISTS (SELECT 1 FROM budgets WHERE org_id = v_org AND name = {_lit(budget_name)}) THEN
    RAISE EXCEPTION 'El presupuesto "%" ya existe: borrarlo desde la app antes de volver a cargarlo', {_lit(budget_name)};
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'budgets' AND column_name = 'precios_al') THEN
    RAISE EXCEPTION 'Falta correr migrations/008_budget_prices_date.sql (Fase 4)';
  END IF;
  SELECT desperdicio_pct INTO v_waste FROM indirect_config WHERE org_id = v_org;
  -- Indirectos de la obra: copia de los generales, igual que un presupuesto nuevo en la app (Fase 4)
  SELECT jsonb_build_object({indirect_pairs}) INTO v_ind
  FROM (SELECT (SELECT to_jsonb(ic) FROM indirect_config ic WHERE ic.org_id = v_org LIMIT 1) AS c) x;

  -- 1. Presupuesto
  INSERT INTO budgets (org_id, name, description, source_file, status, indirectos, precios_al)
  VALUES (v_org, {_lit(budget_name)},
          'Fase 5: cantidades del Excel de la obra, precios con las recetas del Maestro',
          {_lit(source_file)}, 'draft', v_ind,
          (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
  RETURNING id INTO v_budget;

  -- 2. Rubros, pisos e items (sort_order = orden del Excel)
  CREATE TEMP TABLE obra_items ON COMMIT DROP AS
  SELECT * FROM (VALUES
{items_values}
  ) AS t(orden, parent, codigo, descripcion, unidad, cantidad, plantilla, parametros,
         mat_excel, mo_excel, notas);

  INSERT INTO budget_items (budget_id, org_id, code, description, unidad, cantidad,
                            mat_unitario, mo_unitario, mat_total, mo_total, directo_total,
                            indirecto_total, beneficio_total, neto_total,
                            notas, sort_order, template_id, parametros)
  SELECT v_budget, v_org, o.codigo, o.descripcion, o.unidad, o.cantidad,
         coalesce(o.mat_excel, 0), coalesce(o.mo_excel, 0),
         round(coalesce(o.mat_excel, 0) * coalesce(o.cantidad, 0), 2),
         round(coalesce(o.mo_excel, 0) * coalesce(o.cantidad, 0), 2),
         round(coalesce(o.mat_excel, 0) * coalesce(o.cantidad, 0), 2)
           + round(coalesce(o.mo_excel, 0) * coalesce(o.cantidad, 0), 2),
         0, 0,
         round(coalesce(o.mat_excel, 0) * coalesce(o.cantidad, 0), 2)
           + round(coalesce(o.mo_excel, 0) * coalesce(o.cantidad, 0), 2),
         o.notas, o.orden,
         (SELECT t.id FROM item_templates t WHERE t.org_id = v_org AND t.codigo = o.plantilla),
         o.parametros
  FROM obra_items o;

  UPDATE budget_items c SET parent_id = p.id
  FROM obra_items o
  JOIN budget_items p ON p.budget_id = v_budget AND p.sort_order = o.parent
  WHERE c.budget_id = v_budget AND c.sort_order = o.orden;

  -- 3. Recursos de los items con receta. Precio: catalogo del Maestro por codigo
  --    (sin distinguir mayusculas: gana la fecha mas reciente). Desperdicio: recurso > plantilla > organizacion.
  CREATE TEMP TABLE obra_recursos ON COMMIT DROP AS
  SELECT * FROM (VALUES
{res_values}
  ) AS t(orden, plantilla, tipo, codigo, descripcion, unidad, cantidad, trabajadores, dias,
         cargas, desperdicio, formula, rendimiento, lo_compra_cliente, redondear, unidad_compra)
  WHERE orden IS NOT NULL;

  -- Control: recursos con un codigo que no esta en el catalogo o no tiene precio
  SELECT string_agg(DISTINCT r.codigo, ', ' ORDER BY r.codigo) INTO faltan
  FROM obra_recursos r
  WHERE NOT r.lo_compra_cliente AND NOT EXISTS (
    SELECT 1 FROM catalog_entries e
    WHERE e.org_id = v_org AND upper(e.codigo) = upper(r.codigo) AND coalesce(e.precio_sin_iva, 0) > 0);
  IF faltan IS NOT NULL AND NOT v_permitir_sin_precio THEN
    RAISE EXCEPTION 'Recursos sin precio en el catalogo: %. Cargar esos precios (o poner v_permitir_sin_precio := true para cargarlos en $0)', faltan;
  END IF;

  INSERT INTO item_resources (item_id, org_id, tipo, codigo, descripcion, unidad, cantidad,
                              trabajadores, dias, cargas_sociales_pct, desperdicio_pct,
                              desperdicio_origen, cantidad_efectiva, precio_unitario, subtotal,
                              catalog_entry_id, formula, rendimiento, lo_compra_cliente,
                              redondear, unidad_compra, cantidad_redondeo, precio_fecha)
  SELECT bi.id, v_org, r.tipo, r.codigo, r.descripcion, r.unidad, r.cantidad,
         r.trabajadores, r.dias, r.cargas, w.pct, w.origen,
         q.efectiva, coalesce(ce.precio_sin_iva, 0),
         CASE WHEN r.lo_compra_cliente THEN 0
              ELSE round(q.efectiva * coalesce(ce.precio_sin_iva, 0), 2) END,
         ce.id, r.formula, r.rendimiento, r.lo_compra_cliente, r.redondear, r.unidad_compra, 0,
         ce.fecha_precio
  FROM obra_recursos r
  JOIN budget_items bi ON bi.budget_id = v_budget AND bi.sort_order = r.orden
  JOIN item_templates t ON t.org_id = v_org AND t.codigo = r.plantilla
  LEFT JOIN LATERAL (
    SELECT e.id, e.precio_sin_iva, e.fecha_precio FROM catalog_entries e
    JOIN price_catalogs pc ON pc.id = e.catalog_id
    WHERE e.org_id = v_org AND upper(e.codigo) = upper(r.codigo)
    ORDER BY e.fecha_precio DESC NULLS LAST, pc.created_at DESC, (e.codigo = r.codigo) DESC, e.id
    LIMIT 1
  ) ce ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.tipo = 'mano_obra' THEN 0
                ELSE coalesce(r.desperdicio, t.desperdicio_pct, v_waste, 0) END AS pct,
           CASE WHEN r.tipo = 'mano_obra' THEN NULL
                WHEN r.desperdicio IS NOT NULL THEN 'recurso'
                WHEN t.desperdicio_pct IS NOT NULL THEN 'plantilla'
                ELSE 'organizacion' END AS origen
  ) w
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.tipo = 'mano_obra'
                THEN round(r.trabajadores * r.dias * (1 + r.cargas / 100), 2)
                ELSE round(r.cantidad * (1 + w.pct / 100), 2) END AS efectiva
  ) q;

  -- 4. Precio de los items con receta, desde sus recursos (como "Aplicar plantilla")
  UPDATE budget_items bi SET
    mat_unitario  = s.mat_u,
    mo_unitario   = s.mo_u,
    mat_total     = round(s.mat_u * bi.cantidad, 2),
    mo_total      = round(s.mo_u * bi.cantidad, 2),
    directo_total = round(s.mat_u * bi.cantidad, 2) + round(s.mo_u * bi.cantidad, 2),
    neto_total    = round(s.mat_u * bi.cantidad, 2) + round(s.mo_u * bi.cantidad, 2)
  FROM (
    SELECT r.item_id,
           round(coalesce(sum(r.subtotal) FILTER (WHERE r.tipo = 'material'), 0) / max(coalesce(nullif(b.cantidad, 0), 1)), 2) AS mat_u,
           round(coalesce(sum(r.subtotal) FILTER (WHERE r.tipo <> 'material'), 0) / max(coalesce(nullif(b.cantidad, 0), 1)), 2) AS mo_u
    FROM item_resources r JOIN budget_items b ON b.id = r.item_id
    WHERE b.budget_id = v_budget AND NOT r.lo_compra_cliente
    GROUP BY r.item_id
  ) s
  WHERE bi.id = s.item_id;

  RAISE NOTICE 'Presupuesto cargado: %. Falta: Cadena de Markups > Recalcular obra', v_budget;
END
$obra$;

-- Verificacion: items = {n_items}, con_receta = {n_items - n_sin}.
-- recursos_sin_precio: codigos que no estan en el catalogo o sin precio (quedan en $0).
SELECT
  b.id AS presupuesto,
  (SELECT count(*) FROM budget_items i WHERE i.budget_id = b.id AND i.cantidad IS NOT NULL) AS items,
  (SELECT count(*) FROM budget_items i WHERE i.budget_id = b.id AND i.template_id IS NOT NULL) AS con_receta,
  (SELECT count(*) FROM item_resources r JOIN budget_items i ON i.id = r.item_id
     WHERE i.budget_id = b.id AND NOT r.lo_compra_cliente
       AND (r.catalog_entry_id IS NULL OR r.precio_unitario = 0)) AS recursos_sin_precio,
  (SELECT round(sum(directo_total)) FROM budget_items i WHERE i.budget_id = b.id) AS directo_total
FROM budgets b WHERE b.name = {_lit(budget_name)};
"""


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Cargar el cómputo de una obra con las recetas del Maestro")
    parser.add_argument("excel", help="Excel de la obra (.xlsx con la hoja 01_C&P)")
    parser.add_argument("--maestro", required=True, help="Excel Maestro de TERRAC (recetas)")
    parser.add_argument("--nombre", default=None, help="Nombre del presupuesto (por defecto, el del archivo)")
    parser.add_argument("--report", default="output/informe_obra.md", help="Informe Markdown")
    parser.add_argument("--sql", default=None, help="Guardar la carga como SQL para el SQL Editor de Supabase")
    args = parser.parse_args(argv)

    parsed = parse_obra(load(args.excel))
    plan = build_plan(parsed, maestro_templates(args.maestro))
    name = Path(args.excel).name
    budget_name = args.nombre or f"{Path(args.excel).stem} (Fase 5)"

    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(report_markdown(parsed, plan, name), encoding="utf-8")

    n_items = sum(1 for i in plan["items"] if i["nivel"] == "item")
    print(f"{n_items} ítems: {n_items - len(plan['sin_receta'])} con receta, "
          f"{len(plan['sin_receta'])} sin receta. Informe: {args.report}")
    if plan["plantillas_faltantes"]:
        print("Faltan plantillas en el Maestro: " + ", ".join(plan["plantillas_faltantes"]))

    if args.sql:
        Path(args.sql).parent.mkdir(parents=True, exist_ok=True)
        Path(args.sql).write_text(sql_script(plan, budget_name, name), encoding="utf-8")
        print(f"SQL para el SQL Editor de Supabase: {args.sql} (presupuesto '{budget_name}')")
    else:
        print("Solo informe: no se generó el SQL de carga (usar --sql).")


if __name__ == "__main__":
    main()
