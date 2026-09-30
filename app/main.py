from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    ai,
    analysis,
    architect,
    budgets,
    catalogs,
    excel,
    health,
    indirects,
    standard_trees,
    templates,
)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="Presupuestador Backend", version="2.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(budgets.router, prefix="/budgets", tags=["Presupuestos"])
    app.include_router(excel.router, prefix="/budgets", tags=["Excel"])
    app.include_router(ai.router, prefix="/budgets", tags=["IA"])
    app.include_router(analysis.router, prefix="/budgets", tags=["Analisis"])
    app.include_router(indirects.router, prefix="/indirects", tags=["Indirectos"])
    app.include_router(catalogs.router, prefix="/catalogs", tags=["Catalogos"])
    app.include_router(templates.router, prefix="/templates", tags=["Templates"])
    app.include_router(standard_trees.router, prefix="/standard-trees", tags=["Arbol estandar"])
    app.include_router(architect.router, prefix="/architect", tags=["ArquitectoAI"])

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(app, host="0.0.0.0", port=settings.PORT)
