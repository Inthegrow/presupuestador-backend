-- 011_catalogo_oficial_excel_neto.sql
-- Cerrar la Etapa A de "Cargar una obra":
-- 1. Catalogo oficial: si la empresa marca uno o mas catalogos como oficiales, la app
--    calcula solo con esos; los demas quedan para consulta (se muestran como referencia
--    cuando falta un precio). Si ninguno es oficial, todo sigue como antes.
-- 2. Lo que daba el Excel de la obra por item, para "Ver diferencias con el Excel":
--    excel_directo = columna N del 01_C&P (directo total), excel_neto = columna Z (total neto).
--    Los presupuestos cargados antes de esta migracion quedan en NULL (no se inventa nada).
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos existentes (todo idempotente).

ALTER TABLE price_catalogs ADD COLUMN IF NOT EXISTS oficial boolean NOT NULL DEFAULT false;
ALTER TABLE budget_items   ADD COLUMN IF NOT EXISTS excel_directo numeric;  -- columna N del 01_C&P (directo total)
ALTER TABLE budget_items   ADD COLUMN IF NOT EXISTS excel_neto    numeric;  -- columna Z del 01_C&P (total neto)
CREATE INDEX IF NOT EXISTS idx_price_catalogs_oficial ON price_catalogs(org_id, oficial);

-- Verificacion (correr despues). Tiene que dar 3:
-- SELECT count(*) FROM information_schema.columns
-- WHERE (table_name = 'price_catalogs' AND column_name = 'oficial')
--    OR (table_name = 'budget_items' AND column_name IN ('excel_directo', 'excel_neto'));
