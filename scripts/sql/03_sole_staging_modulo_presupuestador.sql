-- PASO 1. Correr en SOLÉ STAGING (proyecto exhwbxeccnpqprttddox):
--   https://supabase.com/dashboard/project/exhwbxeccnpqprttddox/sql/new
-- Registra el módulo Presupuestador apagado en todos los planes. No enciende ninguna empresa.
INSERT INTO cfg_modules (key, suite, label, description)
VALUES ('presupuestador', 'growth', 'Presupuestador', 'Presupuestos de obra con recetas y listas de precios (app aparte, misma clave)')
ON CONFLICT (key) DO NOTHING;

-- Plan entitlements: OFF en los 4 planes (nadie lo tiene por default).
INSERT INTO cfg_plan_entitlements (plan, module_key, enabled) VALUES
  ('trial',      'presupuestador', false),
  ('basic',      'presupuestador', false),
  ('pro',        'presupuestador', false),
  ('enterprise', 'presupuestador', false)
ON CONFLICT (plan, module_key) DO NOTHING;

-- Verificación: tiene que mostrar 1 módulo y 4 planes, los 4 en false.
SELECT m.key, m.is_active, pe.plan, pe.enabled
FROM cfg_modules m JOIN cfg_plan_entitlements pe ON pe.module_key = m.key
WHERE m.key = 'presupuestador' ORDER BY pe.plan;
