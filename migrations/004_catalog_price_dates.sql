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

ALTER TABLE catalog_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalog_price_history_service_only" ON catalog_price_history;
CREATE POLICY "catalog_price_history_service_only" ON catalog_price_history FOR ALL
  USING (true);

-- 3. Punto de partida del historial: el precio actual de cada entrada.
--    Los precios existentes no tienen fecha, asi que fecha_precio queda NULL.
INSERT INTO catalog_price_history (entry_id, org_id, precio_sin_iva, fecha_precio)
SELECT e.id, e.org_id, e.precio_sin_iva, e.fecha_precio
FROM catalog_entries e
WHERE e.precio_sin_iva IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM catalog_price_history h WHERE h.entry_id = e.id);
