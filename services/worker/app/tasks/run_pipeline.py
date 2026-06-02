from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, UTC
import json
from pathlib import Path
import sys
import traceback

from app.worker import celery_app


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _root() -> Path:
    return Path(__file__).resolve().parents[4]


def _record_path(run_id: str) -> Path:
    return _root() / "outputs" / "_meta" / "runs" / f"{run_id}.json"


def _log_path(run_id: str) -> Path:
    return _root() / "outputs" / "_meta" / "runs" / f"{run_id}.log"


def _load_record(run_id: str) -> dict | None:
    path = _record_path(run_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _save_record(run_id: str, record: dict) -> None:
    path = _record_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def _append_log(run_id: str, message: str) -> None:
    path = _log_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"[{_iso_now()}] {message}\n")


class _Tee:
    def __init__(self, *streams):
        self._streams = streams

    def write(self, data: str) -> int:
        for stream in self._streams:
            stream.write(data)
            stream.flush()
        return len(data)

    def flush(self) -> None:
        for stream in self._streams:
            stream.flush()


def _collect_artifacts(out_dir: str) -> list[dict[str, str | int]]:
    root = Path(out_dir)
    if not root.exists():
        return []
    artifacts: list[dict[str, str | int]] = []
    for path in sorted(root.glob("**/*")):
        if path.is_file():
            artifacts.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "size_bytes": path.stat().st_size,
                }
            )
    return artifacts


@celery_app.task
def run_pipeline_task(run_id: str, config_path: str) -> str:
    record = _load_record(run_id) or {
        "run_id": run_id,
        "status": "queued",
        "created_at": _iso_now(),
        "artifacts": [],
    }
    record["status"] = "running"
    record["started_at"] = _iso_now()
    _save_record(run_id, record)
    _append_log(run_id, f"Worker started run: config_path={config_path}")

    out_dir = ""
    try:
        from spectral_urbanism.pipelines.run_city import run as run_city

        log_file = _log_path(run_id)
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as lf:
            tee_out = _Tee(sys.stdout, lf)
            tee_err = _Tee(sys.stderr, lf)
            with redirect_stdout(tee_out), redirect_stderr(tee_err):
                out_dir = run_city(config_path)

        record["status"] = "succeeded"
        record["out_dir"] = out_dir
        record["artifacts"] = _collect_artifacts(out_dir)
        _append_log(run_id, f"Run succeeded: out_dir={out_dir}")
    except Exception as exc:  # noqa: BLE001
        record["status"] = "failed"
        record["error"] = str(exc)
        _append_log(run_id, f"Run failed: {exc}")
        _append_log(run_id, traceback.format_exc())
    finally:
        record["finished_at"] = _iso_now()
        _save_record(run_id, record)

    return out_dir
