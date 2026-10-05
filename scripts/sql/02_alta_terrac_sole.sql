-- PASO 2. Correr en la base de SOLÉ (proyecto yytuhddgqughemkevbni):
--   https://supabase.com/dashboard/project/yytuhddgqughemkevbni/sql/new
-- Suma a Carlos (admin) y a Emilia (líder) como miembros de Terrac SA. Sol ya es admin.
INSERT INTO public.memberships (org_id, user_id, role, name, email)
VALUES ('ea998891-d7cd-416c-a8cf-ca93a2962167', '02a8afe6-2a62-4954-a5ea-c8932e99b051', 'admin',  'Carlos Sanchez',        'csanchez@inspiring.com.ar'),
       ('ea998891-d7cd-416c-a8cf-ca93a2962167', 'ea065e27-fae2-4470-8db4-4bc835c0ea95', 'leader', 'María Emilia Gerlero', 'megerlero@inspiring.com.ar')
ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email;

-- Verificación: tiene que listar a Sol, Carlos y Emilia entre los miembros de Terrac.
SELECT m.role, m.name, m.email FROM public.memberships m WHERE m.org_id = 'ea998891-d7cd-416c-a8cf-ca93a2962167' ORDER BY m.role, m.email;
