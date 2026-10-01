-- 009_obra_recetas_memoria.sql
-- Cargar obra: la app recuerda que receta eligio cada trabajo del Excel de la obra,
-- para proponerla sola la proxima vez que aparezca el mismo trabajo.
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos existentes (todo idempotente).

-- 1. Memoria de recetas por trabajo (misma descripcion + misma unidad)
CREATE TABLE IF NOT EXISTS obra_recetas_memoria (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL,
    clave       text NOT NULL,                -- descripcion normalizada + unidad ("MURO ... | m2")
    descripcion text,
    unidad      text,
    plantillas  jsonb NOT NULL DEFAULT '[]',  -- [["5.1.4", 1.0], ...]; [] = sin receta (precio del Excel)
    veces       integer NOT NULL DEFAULT 1,   -- cuantas cargas la usaron
    updated_at  timestamptz DEFAULT now(),
    UNIQUE (org_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_obra_recetas_memoria_org ON obra_recetas_memoria(org_id);

-- Solo el backend accede a esta tabla, con la service_role key (que saltea RLS).
-- RLS activado y SIN politicas = anon y authenticated no ven ni escriben nada.
ALTER TABLE obra_recetas_memoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON obra_recetas_memoria FROM anon, authenticated;

-- 2. Verificacion (correr despues). Tiene que dar 1 tabla con rls = true:
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'obra_recetas_memoria';
