-- PASO 2. Correr en SOLÉ PRODUCCIÓN (proyecto yytuhddgqughemkevbni), después de verificar staging:
--   https://supabase.com/dashboard/project/yytuhddgqughemkevbni/sql/new
-- Registra el módulo y lo enciende para Terrac SA en la misma corrida, así nadie queda afuera ni un minuto.
BEGIN;

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

-- Encender para Terrac SA (lo mismo que hace Configuración > módulos), con su registro en el historial.
INSERT INTO cfg_org_module_overrides (org_id, module_key, enabled, applied_by, reason)
VALUES ('ea998891-d7cd-416c-a8cf-ca93a2962167', 'presupuestador', true,
        '02a8afe6-2a62-4954-a5ea-c8932e99b051', 'Alta del Presupuestador para Terrac SA')
ON CONFLICT (org_id, module_key) DO UPDATE SET enabled = true;

INSERT INTO cfg_org_module_override_events (org_id, module_key, enabled, applied_by, reason)
VALUES ('ea998891-d7cd-416c-a8cf-ca93a2962167', 'presupuestador', true,
        '02a8afe6-2a62-4954-a5ea-c8932e99b051', 'Alta del Presupuestador para Terrac SA');

COMMIT;

-- Verificación: tiene que mostrar una sola empresa, Terrac SA, con enabled = true.
SELECT o.name, ov.enabled
FROM cfg_org_module_overrides ov JOIN organizations o ON o.id = ov.org_id
WHERE ov.module_key = 'presupuestador';
