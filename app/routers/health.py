from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    return """<!doctype html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Presupuestador Backend</title>
<style>body{font-family:system-ui;margin:40px;line-height:1.5}a{color:#0b5fff}</style>
</head><body>
<h1>Presupuestador Backend API</h1>
<p>Backend para estimacion de presupuestos de obra.</p>
<ul><li><a href="/health">Health check</a></li><li><a href="/docs">Documentacion API</a></li></ul>
</body></html>"""


@router.get("/health", tags=["Sistema"])
def health_check():
    return {"status": "OK", "timestamp": datetime.now(timezone.utc).isoformat()}

