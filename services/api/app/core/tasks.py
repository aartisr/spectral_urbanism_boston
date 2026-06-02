from __future__ import annotations

from datetime import datetime, UTC

from celery import Celery

from app.core.runner import execute_pipeline
from app.core.settings import ALLOW_INLINE_FALLBACK, APP_ENV, REDIS_URL, RUN_EXECUTION_MODE

_task_client = Celery("spectral_urbanism_api", broker=REDIS_URL, backend=REDIS_URL)


def reconcile_run_record(record: dict) -> dict:
    """Reconcile stale queued/running records with authoritative Celery state."""
    status = str(record.get("status", "")).lower()
    if status not in {"queued", "running"}:
        return record

    mode = str(record.get("job_mode") or record.get("execution_backend") or "").lower()
    job_id = str(record.get("job_id", "")).strip()
    if mode != "celery" or not job_id or job_id in {"pending", "failed"}:
        return record

    try:
        result = _task_client.AsyncResult(job_id)
        state = str(result.state or "").upper()
    except Exception:
        return record

    if state in {"PENDING", "RECEIVED", "STARTED", "RETRY"}:
        return record

    updated = dict(record)
    if state == "SUCCESS":
        updated["status"] = "succeeded"
        updated.pop("error", None)
        updated.setdefault("finished_at", datetime.now(UTC).isoformat())
        return updated

    if state in {"FAILURE", "REVOKED"}:
        updated["status"] = "failed"
        updated["error"] = str(result.result)
        updated.setdefault("finished_at", datetime.now(UTC).isoformat())
        return updated

    return record


def enqueue_run(run_id: str, config_path: str) -> dict[str, str]:
    mode = "celery" if APP_ENV == "production" else RUN_EXECUTION_MODE

    if mode == "inline":
        execute_pipeline(run_id, config_path)
        return {"mode": "inline", "job_id": "inline"}

    try:
        result = _task_client.send_task(
            "app.tasks.run_pipeline.run_pipeline_task",
            kwargs={"run_id": run_id, "config_path": config_path},
            queue="runs",
        )
        return {"mode": "celery", "job_id": str(result.id)}
    except Exception as exc:
        # Production stays queue-only for strict execution semantics.
        if APP_ENV == "production" or not ALLOW_INLINE_FALLBACK:
            raise RuntimeError("Celery enqueue failed and inline fallback is disabled") from exc

        # Development fallback keeps local iteration resilient.
        execute_pipeline(run_id, config_path)
        return {"mode": "inline-fallback", "job_id": "inline-fallback"}
