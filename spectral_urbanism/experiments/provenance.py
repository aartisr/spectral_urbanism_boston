from __future__ import annotations

import hashlib
from datetime import datetime, UTC
from pathlib import Path
from typing import Any


def _sha256_file(path: Path) -> str | None:
  if not path.exists() or not path.is_file():
    return None
  h = hashlib.sha256()
  with path.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
      h.update(chunk)
  return h.hexdigest()


def build_provenance_manifest(cfg: dict[str, Any], config_path: str) -> dict[str, Any]:
  data_paths = cfg.get("data_paths", {})
  data_assets: list[dict[str, Any]] = []

  for key, raw_path in data_paths.items():
    path = Path(str(raw_path))
    checksum = _sha256_file(path)
    data_assets.append(
      {
        "key": str(key),
        "path": str(path),
        "exists": path.exists(),
        "checksum_sha256": checksum,
        "last_modified_utc": datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()
        if path.exists()
        else None,
      }
    )

  return {
    "generated_at_utc": datetime.now(UTC).isoformat(),
    "run_id": cfg.get("run", {}).get("run_id"),
    "city": cfg.get("city", {}).get("name"),
    "config_path": str(config_path),
    "data_assets": data_assets,
  }
