-- 005_template_recipes.sql
-- Fase 2: plantillas con formulas, parametros, desperdicio heredado,
-- material que compra el cliente, MO por rendimiento y redondeo a unidad de compra.
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos: solo agrega columnas (todo idempotente).

-- 1. Desperdicio por defecto de la organizacion (NULL = 0%)
ALTER TABLE indirect_config ADD COLUMN IF NOT EXISTS desperdicio_pct numeric;

-- 2. Plantillas: parametros con valor por defecto y desperdicio propio (NULL = hereda)
--    parametros = [{"clave": "espesor", "valor": 0.20, "unidad": "m"}, ...]
ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS parametros jsonb NOT NULL DEFAULT '[]';
ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS desperdicio_pct numeric;

-- 3. Presupuesto: desperdicio propio (NULL = hereda de plantilla / organizacion)
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS desperdicio_pct numeric;

-- 4. Item del presupuesto: de que plantilla salio y con que valores de parametros
--    parametros = {"espesor": 0.15, "ml_vigas": 12}
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS template_id uuid
  REFERENCES item_templates(id) ON DELETE SET NULL;
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS parametros jsonb NOT NULL DEFAULT '{}';

-- 5. Recursos del item
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS formula text;             -- ej. 'Q * espesor'
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS rendimiento text;         -- MO: dias = Q / rendimiento
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS desperdicio_origen text;  -- recurso/presupuesto/plantilla/organizacion
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS lo_compra_cliente boolean NOT NULL DEFAULT false;
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS redondear boolean NOT NULL DEFAULT false;
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS unidad_compra numeric NOT NULL DEFAULT 1;
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS cantidad_redondeo numeric NOT NULL DEFAULT 0;

ALTER TABLE item_resources DROP CONSTRAINT IF EXISTS item_resources_unidad_compra_check;
ALTER TABLE item_resources ADD CONSTRAINT item_resources_unidad_compra_check
  CHECK (unidad_compra > 0);

ALTER TABLE item_resources DROP CONSTRAINT IF EXISTS item_resources_desperdicio_origen_check;
ALTER TABLE item_resources ADD CONSTRAINT item_resources_desperdicio_origen_check
  CHECK (desperdicio_origen IS NULL
         OR desperdicio_origen IN ('recurso', 'presupuesto', 'plantilla', 'organizacion'));

CREATE INDEX IF NOT EXISTS idx_budget_items_template ON budget_items(template_id);

-- 6. Verificacion (correr despues). Tiene que dar 13:
-- SELECT count(*) FROM information_schema.columns
-- WHERE (table_name, column_name) IN (
--   ('indirect_config','desperdicio_pct'), ('item_templates','parametros'),
--   ('item_templates','desperdicio_pct'), ('budgets','desperdicio_pct'),
--   ('budget_items','template_id'), ('budget_items','parametros'),
--   ('item_resources','formula'), ('item_resources','rendimiento'),
--   ('item_resources','desperdicio_origen'), ('item_resources','lo_compra_cliente'),
--   ('item_resources','redondear'), ('item_resources','unidad_compra'),
--   ('item_resources','cantidad_redondeo'));
