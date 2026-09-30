-- 004_catalog_price_dates.sql
-- Fase 1: precios con fecha e historial de precios de los catalogos

-- 1. Fecha y proveedor de cada precio
ALTER TABLE catalog_entries ADD COLUMN IF NOT EXISTS fecha_precio date;
ALTER TABLE catalog_entries ADD COLUMN IF NOT EXISTS proveedor text;

-- 2. Historial: una fila cada vez que se carga o cambia un precio
CREATE TABLE IF NOT EXISTS catalog_price_history (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id       uuid NOT NULL REFERENCES catalog_entries(id) ON DELETE CASCADE,
    org_id         uuid NOT NULL,
    precio_sin_iva numeric,
    fecha_precio   date,
    created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_entry ON catalog_price_history(entry_id, fecha_precio);
CREATE INDEX IF NOT EXISTS idx_price_history_org ON catalog_price_history(org_id);

-- Solo el backend accede a esta tabla, con la service_role key (que saltea RLS).
-- RLS activado y SIN politicas = anon y authenticated no ven ni escriben nada.
-- No usar USING (true): eso abre todas las filas de todas las organizaciones.
ALTER TABLE catalog_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalog_price_history_service_only" ON catalog_price_history;
REVOKE ALL ON catalog_price_history FROM anon, authenticated;

-- 3. Punto de partida del historial: el precio actual de cada entrada.
--    Los precios existentes no tienen fecha, asi que fecha_precio queda NULL.
INSERT INTO catalog_price_history (entry_id, org_id, precio_sin_iva, fecha_precio)
SELECT e.id, e.org_id, e.precio_sin_iva, e.fecha_precio
FROM catalog_entries e
WHERE e.precio_sin_iva IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM catalog_price_history h WHERE h.entry_id = e.id);

-- 4. Verificacion (correr despues de la migracion). Tiene que dar:
--    politicas = 0, anon_lee = false, anon_escribe = false,
--    auth_lee = false, auth_escribe = false, rls = true
-- SELECT
--   (SELECT count(*) FROM pg_policies WHERE tablename = 'catalog_price_history') AS politicas,
--   has_table_privilege('anon', 'catalog_price_history', 'SELECT') AS anon_lee,
--   has_table_privilege('anon', 'catalog_price_history', 'INSERT, UPDATE, DELETE') AS anon_escribe,
--   has_table_privilege('authenticated', 'catalog_price_history', 'SELECT') AS auth_lee,
--   has_table_privilege('authenticated', 'catalog_price_history', 'INSERT, UPDATE, DELETE') AS auth_escribe,
--   (SELECT relrowsecurity FROM pg_class WHERE relname = 'catalog_price_history') AS rls;
