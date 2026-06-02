from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.settings import OUTPUT_META_DIR


def run_record_path(run_id: str) -> Path:
    return OUTPUT_META_DIR / f"{run_id}.json"


def run_config_path(run_id: str) -> Path:
    return OUTPUT_META_DIR / f"{run_id}.yaml"


def run_log_path(run_id: str) -> Path:
    return OUTPUT_META_DIR / f"{run_id}.log"


def save_run_record(run_id: str, data: dict[str, Any]) -> None:
    path = run_record_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def load_run_record(run_id: str) -> dict[str, Any] | None:
    path = run_record_path(run_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        # Another process may be replacing this file; treat as temporarily unavailable.
        return None


def list_run_records() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path in sorted(OUTPUT_META_DIR.glob("*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return out
