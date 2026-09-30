-- 008_budget_prices_date.sql
-- Fase 4: cada obra con sus numeros.
--   * Indirectos propios de cada presupuesto (arrancan con los generales).
--   * "Precios al [fecha]" del presupuesto y fecha del precio de cada recurso.
--   * Versiones con fecha de precios y nota.
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos: solo agrega columnas (todo idempotente).

-- 1. Indirectos de la obra: {"estructura_pct": 15, "jefatura_pct": 8, ...}
--    '{}' = la obra todavia usa los valores generales (indirect_config).
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS indirectos jsonb NOT NULL DEFAULT '{}';

-- 2. Fecha de los precios del presupuesto (NULL = sin fecha, presupuestos viejos)
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS precios_al date;

-- 3. Fecha del precio con el que se calculo cada recurso
ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS precio_fecha date;

-- 4. Versiones: a que fecha de precios corresponde y por que se guardo
ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS precios_al date;
ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS notas text;

-- 5. Verificacion (correr despues). Tiene que dar 5:
-- SELECT count(*) FROM information_schema.columns
-- WHERE (table_name, column_name) IN (
--   ('budgets','indirectos'), ('budgets','precios_al'),
--   ('item_resources','precio_fecha'),
--   ('budget_versions','precios_al'), ('budget_versions','notas'));
