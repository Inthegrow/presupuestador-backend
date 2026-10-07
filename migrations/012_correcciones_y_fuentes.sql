-- 012_correcciones_y_fuentes.sql
-- Entrega 8 (revisión de Ginkgo):
-- 1. De dónde salió cada precio: "fuente" (texto: "Excel de Sol, Ginkgo, hoja 00_Sub", "Internet: Easy · Cemento
--    Loma Negra 50 kg", "Cargado a mano", "Importado de lista.xlsx") y "fuente_url" (el link, si es de internet),
--    en la lista y en el historial. Los precios viejos quedan sin origen (NULL): no se inventa nada.
-- 2. correcciones_aplicadas: registro de cada corrección de la revisión aplicada desde la app (Fórmulas →
--    Correcciones), con la copia de lo que había ("antes") y de lo que se escribió ("despues"), para poder deshacerla.
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos existentes (todo idempotente). Sin esta migración la app sigue andando: la lista de
-- correcciones y el buscador funcionan, y aplicar una corrección responde "Falta la migración 012".

-- 1. Origen de cada precio
ALTER TABLE catalog_entries       ADD COLUMN IF NOT EXISTS fuente     text;
ALTER TABLE catalog_entries       ADD COLUMN IF NOT EXISTS fuente_url text;
ALTER TABLE catalog_price_history ADD COLUMN IF NOT EXISTS fuente     text;
ALTER TABLE catalog_price_history ADD COLUMN IF NOT EXISTS fuente_url text;
-- El proveedor de cada valor del historial (los valores viejos quedan en NULL)
ALTER TABLE catalog_price_history ADD COLUMN IF NOT EXISTS proveedor  text;

-- 2. Correcciones aplicadas
CREATE TABLE IF NOT EXISTS correcciones_aplicadas (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL,
    lote          text NOT NULL,              -- "ginkgo-2026-10"
    correccion_id text NOT NULL,              -- "A1"
    estado        text NOT NULL DEFAULT 'aplicada' CHECK (estado IN ('aplicada', 'deshecha')),
    aplicada_por  text,                       -- email (o id) de quien la aplicó
    aplicada_at   timestamptz NOT NULL DEFAULT now(),
    deshecha_at   timestamptz,
    antes         jsonb,                      -- recursos de cada fórmula tocada, precios tocados, fórmulas creadas
    despues       jsonb                       -- lo que se escribió
);

CREATE INDEX IF NOT EXISTS idx_correcciones_aplicadas_org
    ON correcciones_aplicadas(org_id, lote, correccion_id);

-- Solo el backend accede a esta tabla, con la service_role key (que saltea RLS).
-- RLS activado y SIN políticas = anon y authenticated no ven ni escriben nada (como catalog_price_history).
ALTER TABLE correcciones_aplicadas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON correcciones_aplicadas FROM anon, authenticated;

-- Verificación (correr después). Tiene que dar: columnas = 4, historial_proveedor = 1, tabla = 1, politicas = 0, rls = true,
-- anon_lee = false, auth_lee = false
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name IN ('catalog_entries', 'catalog_price_history')
--       AND column_name IN ('fuente', 'fuente_url')) AS columnas,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name = 'catalog_price_history' AND column_name = 'proveedor') AS historial_proveedor,
--   (SELECT count(*) FROM information_schema.tables WHERE table_name = 'correcciones_aplicadas') AS tabla,
--   (SELECT count(*) FROM pg_policies WHERE tablename = 'correcciones_aplicadas') AS politicas,
--   (SELECT relrowsecurity FROM pg_class WHERE relname = 'correcciones_aplicadas') AS rls,
--   has_table_privilege('anon', 'correcciones_aplicadas', 'SELECT') AS anon_lee,
--   has_table_privilege('authenticated', 'correcciones_aplicadas', 'SELECT') AS auth_lee;
