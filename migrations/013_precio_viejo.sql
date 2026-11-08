-- 013_precio_viejo.sql
-- Entrega 11 (pruebas de Emilia, E13): cada empresa define cuándo un precio es viejo.
-- precio_viejo_dias: un recurso cuyo precio tiene más días que esto se marca en ámbar ("Precio de hace N días")
-- en el detalle del trabajo, en la lista de precios y como aviso en Exportar. No bloquea nada. Por defecto 90.
-- Se cambia en Lista de precios (PATCH /indirects/general {"precio_viejo_dias": N}).
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos existentes (todo idempotente). Sin esta migración la app sigue andando: usa 90 días
-- y guardar otro valor responde "Falta la migración 013".

ALTER TABLE indirect_config ADD COLUMN IF NOT EXISTS precio_viejo_dias integer DEFAULT 90;

-- Verificación (correr después). Tiene que dar 1:
-- SELECT count(*) FROM information_schema.columns
-- WHERE table_name = 'indirect_config' AND column_name = 'precio_viejo_dias';
