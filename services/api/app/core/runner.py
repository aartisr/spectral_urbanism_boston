from __future__ import annotations

from datetime import datetime, UTC
from pathlib import Path

from app.core.store import load_run_record, save_run_record


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def execute_pipeline(run_id: str, config_path: str) -> None:
    record = load_run_record(run_id)
    if record is None:
        return

    record["status"] = "running"
    record["started_at"] = _iso_now()
    save_run_record(run_id, record)

    try:
        from spectral_urbanism.pipelines.run_city import run as run_city

        out_dir = run_city(config_path)
        record["status"] = "succeeded"
        record["out_dir"] = out_dir
        record["artifacts"] = _collect_artifacts(Path(out_dir))
    except Exception as exc:  # noqa: BLE001
        record["status"] = "failed"
        record["error"] = str(exc)
    finally:
        record["finished_at"] = _iso_now()
        save_run_record(run_id, record)


def _collect_artifacts(out_dir: Path) -> list[dict[str, str | int]]:
    if not out_dir.exists():
        return []
    artifacts: list[dict[str, str | int]] = []
    for path in sorted(out_dir.glob("**/*")):
        if path.is_file():
            artifacts.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "size_bytes": path.stat().st_size,
                }
            )
    return artifacts
