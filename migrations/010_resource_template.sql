-- 010_resource_template.sql
-- Cargar obra: de que receta salio cada recurso. Un trabajo puede combinar dos recetas
-- (ej. placas EPS + contrapiso) y el desperdicio heredado de cada recurso tiene que
-- resolverse con SU receta, tambien al recalcular (presupuesto > receta > organizacion).
-- NULL = la receta del item (budget_items.template_id), como hasta ahora.
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de desplegar el backend.
-- No borra ni cambia datos existentes (todo idempotente).

ALTER TABLE item_resources ADD COLUMN IF NOT EXISTS template_id uuid
  REFERENCES item_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_item_resources_template ON item_resources(template_id);

-- Verificacion (correr despues). Tiene que dar 1:
-- SELECT count(*) FROM information_schema.columns
-- WHERE table_name = 'item_resources' AND column_name = 'template_id';
