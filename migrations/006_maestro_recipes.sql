-- 006_maestro_recipes.sql
-- Fase 3: recetas del Maestro TERRAC como plantillas, y el arbol CYP como arbol estandar.
-- Correr a mano en el SQL Editor del proyecto DATA, ANTES de import_recetas.py --apply.
-- No borra ni cambia datos existentes (todo idempotente).

-- 1. Plantillas: codigo del item (4.1.1) para volver a importar sin duplicar
ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS codigo text;
ALTER TABLE item_templates ADD COLUMN IF NOT EXISTS origen text;  -- 'maestro_terrac'
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_templates_org_codigo
  ON item_templates(org_id, codigo) WHERE codigo IS NOT NULL;

-- 2. Arbol estandar de la organizacion (rubros, subrubros e items)
CREATE TABLE IF NOT EXISTS standard_trees (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL,
    nombre      text NOT NULL,
    source_file text,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),
    UNIQUE (org_id, nombre)
);

CREATE TABLE IF NOT EXISTS standard_tree_nodes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tree_id     uuid NOT NULL REFERENCES standard_trees(id) ON DELETE CASCADE,
    org_id      uuid NOT NULL,
    parent_id   uuid REFERENCES standard_tree_nodes(id) ON DELETE CASCADE,
    codigo      text NOT NULL,
    nombre      text NOT NULL,
    unidad      text,
    nivel       text NOT NULL CHECK (nivel IN ('rubro', 'subrubro', 'item')),
    orden       integer NOT NULL DEFAULT 0,
    template_id uuid REFERENCES item_templates(id) ON DELETE SET NULL,
    libre       boolean NOT NULL DEFAULT false,  -- item libre, sin receta
    UNIQUE (tree_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_standard_tree_nodes_tree ON standard_tree_nodes(tree_id, orden);
CREATE INDEX IF NOT EXISTS idx_standard_tree_nodes_org ON standard_tree_nodes(org_id);

-- Solo el backend accede a estas tablas, con la service_role key (que saltea RLS).
-- RLS activado y SIN politicas = anon y authenticated no ven ni escriben nada.
ALTER TABLE standard_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_tree_nodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON standard_trees FROM anon, authenticated;
REVOKE ALL ON standard_tree_nodes FROM anon, authenticated;

-- 3. Verificacion (correr despues). Tiene que dar 2 columnas, 2 tablas y rls = true en las dos:
-- SELECT count(*) FROM information_schema.columns
--   WHERE (table_name, column_name) IN (('item_templates','codigo'), ('item_templates','origen'));
-- SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('standard_trees', 'standard_tree_nodes');
