from datetime import datetime, UTC
import os

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": "spectral-urbanism-api",
        "environment": os.getenv("APP_ENV", "development").lower(),
        "execution_mode": os.getenv("RUN_EXECUTION_MODE", "celery"),
        "inline_fallback": os.getenv("ALLOW_INLINE_FALLBACK", "false").lower()
        in {"1", "true", "yes", "on"},
        "timestamp": datetime.now(UTC).isoformat(),
    }
