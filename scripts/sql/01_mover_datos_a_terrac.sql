-- PASO 1. Correr en la base del PRESUPUESTADOR (proyecto pwlhepzmdjmvascsgvkv):
--   https://supabase.com/dashboard/project/pwlhepzmdjmvascsgvkv/sql/new
-- Cambia la etiqueta de empresa de todas las filas: de IntherArq (462b39aa-efb8-44f5-b467-8ab59e2af81a) a Terrac SA (ea998891-d7cd-416c-a8cf-ca93a2962167).
-- Es una sola sentencia: o se mueve todo o nada. Devuelve una fila por tabla con las filas movidas
-- (esperado: budgets 6, budget_items 684, catalog_entries 1468, item_templates 73, price_catalogs 7, indirect_config 1).
WITH
u0  AS (UPDATE public.audit_logs             SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u1  AS (UPDATE public.budget_items           SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u2  AS (UPDATE public.budget_versions        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u3  AS (UPDATE public.budgets                SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u4  AS (UPDATE public.catalog_entries        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u5  AS (UPDATE public.catalog_price_history  SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u6  AS (UPDATE public.indirect_config        SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u7  AS (UPDATE public.item_audits            SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u8  AS (UPDATE public.item_resources         SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u9  AS (UPDATE public.item_templates         SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u10 AS (UPDATE public.obra_recetas_memoria   SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u11 AS (UPDATE public.price_catalogs         SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u12 AS (UPDATE public.standard_tree_nodes    SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1),
u13 AS (UPDATE public.standard_trees         SET org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' WHERE org_id = '462b39aa-efb8-44f5-b467-8ab59e2af81a' RETURNING 1)
SELECT 'audit_logs' AS tabla, (SELECT count(*) FROM u0) AS filas_movidas
UNION ALL SELECT 'budget_items' AS tabla, (SELECT count(*) FROM u1) AS filas_movidas
UNION ALL SELECT 'budget_versions' AS tabla, (SELECT count(*) FROM u2) AS filas_movidas
UNION ALL SELECT 'budgets' AS tabla, (SELECT count(*) FROM u3) AS filas_movidas
UNION ALL SELECT 'catalog_entries' AS tabla, (SELECT count(*) FROM u4) AS filas_movidas
UNION ALL SELECT 'catalog_price_history' AS tabla, (SELECT count(*) FROM u5) AS filas_movidas
UNION ALL SELECT 'indirect_config' AS tabla, (SELECT count(*) FROM u6) AS filas_movidas
UNION ALL SELECT 'item_audits' AS tabla, (SELECT count(*) FROM u7) AS filas_movidas
UNION ALL SELECT 'item_resources' AS tabla, (SELECT count(*) FROM u8) AS filas_movidas
UNION ALL SELECT 'item_templates' AS tabla, (SELECT count(*) FROM u9) AS filas_movidas
UNION ALL SELECT 'obra_recetas_memoria' AS tabla, (SELECT count(*) FROM u10) AS filas_movidas
UNION ALL SELECT 'price_catalogs' AS tabla, (SELECT count(*) FROM u11) AS filas_movidas
UNION ALL SELECT 'standard_tree_nodes' AS tabla, (SELECT count(*) FROM u12) AS filas_movidas
UNION ALL SELECT 'standard_trees' AS tabla, (SELECT count(*) FROM u13) AS filas_movidas;
