# Reglas para Claude Code en este repositorio

Contexto completo del producto: `HANDOFF_COTIZADOR_AGENTICO.md`. A Carlos se le escribe corto, sin jerga.

## Circuito con Codex (auditoría por CLI)

Codex audita cada cambio antes de que Carlos lo vea. El pase se hace con un comando, sin copiar y pegar:

1. Desarrollar y commitear en la rama de trabajo.
2. Correr `scripts/auditar_con_codex.sh` (base `main`). Corre las pruebas y, si pasan, Codex audita el commit
   en modo solo lectura. Deja el veredicto en `.auditoria/<sha>.md`.
3. Según cómo termina:
   - **0 verde** → push, abrir o actualizar el PR y pegar `.auditoria/<sha>.md` como comentario.
   - **1 amarillo/rojo** → corregir cada hallazgo bloqueante e importante con su prueba, commitear, escribir en
     `.auditoria/ultima-respuesta.md` qué commit y qué prueba cierra cada uno, y volver al paso 2.
     Un hallazgo que no corresponde se responde ahí con el motivo, no se ignora.
   - **2 pruebas rojas** → arreglar y volver al paso 2.
   - **3 auditoría falló** o **5 límite de rondas** → parar. Decirle a Carlos en una línea qué falta (instalar
     Codex, iniciar sesión, la clave) o cuál es el hallazgo que no se pudo cerrar. Nunca presentar el PR
     como auditado.
   - **4 cambió el código** → commitear y volver al paso 2.
4. El límite es una auditoría inicial más dos vueltas de corrección. Para una tarea nueva en la misma rama:
   `scripts/auditar_con_codex.sh --reiniciar`.
5. Un verde vale solo para ese commit: si después cambia el código, se vuelve a auditar.
6. Carlos prueba y hace el merge. Después del merge, recordarle el "Manual Deploy" en Render.

La revisión de Codex en GitHub, si está activa, sigue funcionando como segunda mirada; sus comentarios en el PR
se atienden igual.
