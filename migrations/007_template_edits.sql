-- 007_template_edits.sql
-- Marca las plantillas editadas a mano despues de importarlas del Maestro,
-- para que volver a importar no pise esas correcciones.
-- Correr a mano en el SQL Editor del proyecto DATA (idempotente, no borra datos).
-- output/carga_maestro_terrac.sql ya lo incluye.

ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS editado boolean NOT NULL DEFAULT false;
