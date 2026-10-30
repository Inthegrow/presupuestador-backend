#!/usr/bin/env bash
# Cinta transportadora Claude Code -> Codex.
# Corre las pruebas y, si pasan, le pide a Codex (CLI, solo lectura) que audite
# el commit actual contra la rama base. Deja el veredicto en .auditoria/<sha>.json
# y .auditoria/<sha>.md (este último se pega tal cual como comentario del PR).
#
# Uso:  scripts/auditar_con_codex.sh [rama_base]        (por defecto: main)
#       scripts/auditar_con_codex.sh --reiniciar [base]  (vuelve a 0 las rondas de esta rama)
#
# Códigos de salida (Claude Code decide qué hacer con cada uno, ver CLAUDE.md):
#   0 verde            -> listo para abrir/actualizar el PR
#   1 amarillo o rojo  -> hay hallazgos: corregir y volver a correr
#   2 pruebas rojas    -> no se llamó a Codex
#   3 auditoría falló  -> Codex no está, no tiene sesión o no terminó bien
#   4 cambió el código -> el commit se movió durante la auditoría o hay cambios sin commitear
#   5 límite de rondas -> ya hubo 1 auditoría + 2 correcciones: parar y avisar a Carlos
#   6 nada que auditar -> el commit no tiene cambios contra la base (no es un verde)

set -uo pipefail

MAX_RONDAS=3   # auditoría inicial + 2 vueltas de corrección

if [[ "${1:-}" == "--reiniciar" ]]; then REINICIAR=1; shift; else REINICIAR=0; fi
BASE="${1:-main}"

RAIZ="$(git rev-parse --show-toplevel)" || exit 3
cd "$RAIZ"
DIR=".auditoria"
mkdir -p "$DIR"

RAMA="$(git branch --show-current)"
# Un archivo por nombre completo de rama (hash): "a/b" y "a_b" no comparten rondas.
RONDAS_ARCH="$DIR/rondas-$(printf '%s' "$RAMA" | git hash-object --stdin)"
[[ $REINICIAR == 1 ]] && rm -f "$RONDAS_ARCH"

# 1. El código auditado tiene que ser exactamente un commit: nada sin commitear ni archivos
#    nuevos sin agregar (las pruebas y Codex los leerían aunque no estén en el commit).
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  echo "▲ Hay cambios o archivos nuevos fuera del commit. Commitealos (o ignoralos) antes de auditar."; exit 4
fi
SHA="$(git rev-parse HEAD)"

git fetch -q origin "$BASE" || { echo "▲ No pude traer la versión actual de $BASE desde GitHub."; exit 3; }
REF_BASE="origin/$BASE"
DESDE="$(git merge-base "$REF_BASE" HEAD)" || { echo "▲ No encuentro la rama base $BASE."; exit 3; }
# Se comparan contenidos, no commits: un commit vacío o que revierte todo tampoco tiene nada que auditar.
if git diff --quiet "$DESDE" "$SHA"; then echo "○ No hay cambios contra $BASE: nada que auditar (no es un verde)."; exit 6; fi

# 2. Límite de rondas.
RONDA=$(( $(cat "$RONDAS_ARCH" 2>/dev/null || echo 0) + 1 ))
if (( RONDA > MAX_RONDAS )); then
  echo "▲ Límite: ya hubo $MAX_RONDAS auditorías en esta rama. Parar y mostrarle el problema a Carlos."
  exit 5
fi

# 3. Pruebas. Si fallan, Codex no se llama.
echo "● Ronda $RONDA de $MAX_RONDAS · commit ${SHA:0:7} contra $BASE"
echo "● Pruebas del servidor…"
python -m pytest -q -x >"$DIR/pruebas.log" 2>&1 || { tail -30 "$DIR/pruebas.log"; echo "▲ Pruebas del servidor en rojo."; exit 2; }
tail -1 "$DIR/pruebas.log"

if git diff --name-only "$DESDE" HEAD | grep -q '^frontend/'; then
  echo "● Armado de la pantalla (frontend)…"
  npm --prefix frontend ci --silent >>"$DIR/pruebas.log" 2>&1 || { tail -30 "$DIR/pruebas.log"; echo "▲ No se pudieron instalar las dependencias de la pantalla."; exit 2; }
  npm --prefix frontend run build >>"$DIR/pruebas.log" 2>&1 || { tail -30 "$DIR/pruebas.log"; echo "▲ La pantalla no arma."; exit 2; }
fi

# 4. Codex disponible y con sesión.
command -v codex >/dev/null || { echo "▲ Codex no está instalado (npm install -g @openai/codex)."; exit 3; }
if ! codex login status >/dev/null 2>&1; then
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    printenv OPENAI_API_KEY | codex login --with-api-key >/dev/null 2>&1 || { echo "▲ Codex rechazó la clave OPENAI_API_KEY."; exit 3; }
  else
    echo "▲ Codex no tiene sesión: correr 'codex login' (compu) o cargar OPENAI_API_KEY (nube)."; exit 3
  fi
fi

# 5. Auditoría independiente, en modo solo lectura.
SALIDA="$DIR/$SHA.json"
rm -f "$SALIDA"
PEDIDO="Sos el auditor de este repositorio. Seguí las reglas de AGENTS.md.
Auditá SOLO los cambios entre el commit $DESDE (base $BASE) y el commit $SHA (git diff $DESDE $SHA).
No modifiques archivos. Podés leer código y correr comandos de solo lectura.
En commit_auditado poné exactamente: $SHA"
[[ -f "$DIR/ultima-respuesta.md" ]] && PEDIDO+="
Esta es una re-auditoría. Lo que Claude respondió a tus hallazgos anteriores:
$(cat "$DIR/ultima-respuesta.md")"

echo "● Codex auditando…"
codex exec --sandbox read-only --ephemeral --color never \
  --output-schema scripts/codex_veredicto.schema.json \
  -o "$SALIDA" "$PEDIDO" >"$DIR/codex.log" 2>&1
CODEX_RC=$?

if [[ $CODEX_RC -ne 0 || ! -s "$SALIDA" ]]; then
  tail -20 "$DIR/codex.log"; echo "▲ La auditoría no terminó bien (código $CODEX_RC)."; exit 3
fi
if [[ "$(git rev-parse HEAD)" != "$SHA" || -n "$(git status --porcelain)" ]]; then
  echo "▲ El código cambió durante la auditoría. Hay que volver a auditar."; exit 4
fi

# 6. Semáforo. Sale de la gravedad de los hallazgos y nunca es más benigno que el que declaró
#    Codex: un "verde" con un hallazgo bloqueante o importante no aprueba nada.
SEMAFORO="$(python3 - "$SALIDA" "$SHA" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
if v.get("commit_auditado") != sys.argv[2]:
    sys.exit(1)
orden = ["verde", "amarillo", "rojo"]
gravedades = {h["gravedad"] for h in v["hallazgos"]}
calculado = "rojo" if "bloqueante" in gravedades else "amarillo" if "importante" in gravedades else "verde"
print(max(v["semaforo"], calculado, key=orden.index))
PY
)" || { echo "▲ Codex auditó otro commit o devolvió un veredicto ilegible."; exit 3; }

# 7. Veredicto legible para el PR. Si el JSON está incompleto, falla acá sin consumir ronda.
rm -f "$DIR/$SHA.md"
python3 - "$SALIDA" "$DIR/$SHA.md" "$SHA" "$RONDA" "$MAX_RONDAS" "$SEMAFORO" <<'PY' || { echo "▲ El veredicto de Codex vino incompleto."; exit 3; }
import json, sys
src, dst, sha, ronda, maxr, semaforo = sys.argv[1:]
v = json.load(open(src))
icono = {"verde": "🟢", "amarillo": "🟡", "rojo": "🔴"}[semaforo]
forma = {"bloqueante": "▲", "importante": "◆", "menor": "●"}
lineas = [f"## {icono} Auditoría Codex (CLI) · commit `{sha[:7]}` · ronda {ronda} de {maxr}", "", v["resumen"], ""]
if v["hallazgos"]:
    lineas += ["| Gravedad | Dónde | Problema | Cómo se reproduce | Sugerencia |", "|---|---|---|---|---|"]
    for h in v["hallazgos"]:
        donde = h["archivo"] + (f":{h['linea']}" if h["linea"] else "")
        celdas = [f"{forma[h['gravedad']]} {h['gravedad']}", f"`{donde}`", h["problema"], h["como_reproducir"], h["sugerencia"]]
        lineas.append("| " + " | ".join(c.replace("|", "\\|").replace("\n", " ") for c in celdas) + " |")
    lineas.append("")
if v["que_probar"]:
    lineas += ["**Qué probar a mano:**"] + [f"- {p}" for p in v["que_probar"]]
open(dst, "w").write("\n".join(lineas) + "\n")
print("\n".join(lineas))
PY

# Recién con el informe armado del commit actual se cuenta la ronda.
echo "${RONDA}" >"$RONDAS_ARCH"

case "$SEMAFORO" in
  verde) rm -f "$DIR/ultima-respuesta.md"; exit 0 ;;
  *) exit 1 ;;
esac
