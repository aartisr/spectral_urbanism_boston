from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[4]
OUTPUT_META_DIR = ROOT / "outputs" / "_meta" / "runs"
OUTPUT_META_DIR.mkdir(parents=True, exist_ok=True)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RUN_EXECUTION_MODE = os.getenv("RUN_EXECUTION_MODE", "celery")
APP_ENV = os.getenv("APP_ENV", "development").lower()
ALLOW_INLINE_FALLBACK = os.getenv(
	"ALLOW_INLINE_FALLBACK",
	"false" if APP_ENV == "production" else "true",
).lower() in {"1", "true", "yes", "on"}
