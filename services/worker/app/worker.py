import os

from celery import Celery


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "spectral_urbanism_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.task_routes = {
    "app.tasks.run_pipeline.run_pipeline_task": {"queue": "runs"},
}

# Explicit import registration is more reliable in containerized workers than
# autodiscovery with nested package names.
celery_app.conf.imports = ("app.tasks.run_pipeline",)
