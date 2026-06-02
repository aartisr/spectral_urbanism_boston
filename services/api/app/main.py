from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.health import router as health_router
from app.routes.configs import router as configs_router
from app.routes.runs import router as runs_router

app = FastAPI(title="Spectral Urbanism API", version="0.1.0")

app.add_middleware(
	CORSMiddleware,
	allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+",
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

app.include_router(health_router, prefix="/api/v1", tags=["health"])
app.include_router(configs_router, prefix="/api/v1", tags=["configs"])
app.include_router(runs_router, prefix="/api/v1", tags=["runs"])
