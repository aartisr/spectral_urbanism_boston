from __future__ import annotations

from datetime import datetime, UTC
import json
from pathlib import Path
from uuid import uuid4

import yaml
from fastapi import APIRouter, HTTPException, Query
import numpy as np

from app.core.settings import ROOT
from app.core.store import list_run_records, load_run_record, run_config_path, run_log_path, save_run_record
from app.core.tasks import enqueue_run, reconcile_run_record
from app.schemas.run import RunCreateRequest, RunCreateResponse
from spectral_urbanism.city.plugins import apply_feature_plugins
from spectral_urbanism.city.grid import make_grid
from spectral_urbanism.data.catalog import DataPaths

router = APIRouter()

INTERVENTION_ICON_MAP: dict[str, str] = {
    "tree": "T",
    "cool_roof": "CR",
    "reflective_pavement": "RP",
    "shade_corridor": "SC",
}


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _parse_csv(raw: str) -> list[str]:
    return [x.strip() for x in raw.split(",") if x.strip()]


def _append_run_log(run_id: str, message: str) -> None:
    path = run_log_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{_iso_now()}] {message}\n"
    with path.open("a", encoding="utf-8") as f:
        f.write(line)


def _tail_lines(path: Path, tail: int) -> list[str]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if tail <= 0:
        return lines
    return lines[-tail:]


def _reconcile_and_persist(record: dict) -> dict:
    reconciled = reconcile_run_record(record)
    if reconciled != record:
        save_run_record(str(reconciled.get("run_id", record.get("run_id", ""))), reconciled)
    return reconciled


def _resolve_existing_path(raw_path: object) -> Path:
    """Resolve persisted paths that may have been written inside the Docker /app mount."""
    raw = str(raw_path or "").strip()
    path = Path(raw)
    if path.exists():
        return path

    candidates: list[Path] = []
    if raw.startswith("/app/"):
        candidates.append(ROOT / raw.removeprefix("/app/"))
    elif raw and not path.is_absolute():
        candidates.append(ROOT / raw)

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return path


def _kinds_to_icon(kinds: set[str]) -> str:
    if not kinds:
        return ""
    ordered = sorted(kinds)
    tokens = [_kind_to_icon(k) for k in ordered]
    return "+".join(tokens[:2])


def _kind_to_icon(kind: str) -> str:
    if kind in INTERVENTION_ICON_MAP:
        return INTERVENTION_ICON_MAP[kind]
    parts = [p for p in kind.split("_") if p]
    if len(parts) >= 2:
        return (parts[0][:1] + parts[1][:1]).upper()
    return kind[:2].upper() if kind else "NA"


def _empty_feature_collection() -> dict:
    return {"type": "FeatureCollection", "features": []}


def _read_geojson(path: Path) -> dict:
    if not path.exists():
        return _empty_feature_collection()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(parsed, dict) and parsed.get("type") == "FeatureCollection":
            return parsed
    except Exception:
        return _empty_feature_collection()
    return _empty_feature_collection()


def _read_json_dict(path: Path) -> dict:
    if not path.exists():
        return {"enabled": False, "reason": "artifact_missing"}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return {"enabled": False, "reason": "artifact_unreadable"}
    return {"enabled": False, "reason": "artifact_invalid"}


def _merge_diagnostic_properties(grid, diagnostics_geojson: dict) -> None:
    features = diagnostics_geojson.get("features")
    if not isinstance(features, list) or "cell_id" not in grid.columns:
        return

    props_by_cell: dict[int, dict] = {}
    for feature in features:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        try:
            cid = int(props.get("cell_id"))
        except (TypeError, ValueError):
            continue
        props_by_cell[cid] = props

    diagnostic_columns = [
        "cheeger_side",
        "cheeger_boundary",
        "cheeger_fiedler",
        "cheeger_rank",
        "cheeger_priority",
        "cheeger_priority_class",
        "cooling_sink",
        "cooling_access_score",
        "cooling_sink_resistance_proxy",
        "cooling_access_class",
        "low_cooling_access",
        "street_intervention_signal",
    ]
    defaults = {
        "cheeger_side": "",
        "cheeger_boundary": False,
        "cheeger_fiedler": 0.0,
        "cheeger_rank": -1,
        "cheeger_priority": 0.0,
        "cheeger_priority_class": "unavailable",
        "cooling_sink": False,
        "cooling_access_score": 0.0,
        "cooling_sink_resistance_proxy": 0.0,
        "cooling_access_class": "unavailable",
        "low_cooling_access": False,
        "street_intervention_signal": 0.0,
    }
    for column in diagnostic_columns:
        grid[column] = grid["cell_id"].map(
            lambda cid, col=column: props_by_cell.get(int(cid), {}).get(col, defaults[col])
        )


@router.post("/runs", response_model=RunCreateResponse)
def create_run(req: RunCreateRequest) -> RunCreateResponse:
    run_id = str(uuid4())
    cfg_path = run_config_path(run_id)
    cfg_path.write_text(yaml.safe_dump(req.config, sort_keys=False), encoding="utf-8")

    record = {
        "run_id": run_id,
        "run_name": req.run_name,
        "status": "queued",
        "created_at": _iso_now(),
        "config_path": str(cfg_path),
        "execution_backend": "pending",
        "job_mode": "pending",
        "job_id": "pending",
        "artifacts": [],
    }
    save_run_record(run_id, record)
    _append_run_log(run_id, f"Run created: run_name={req.run_name}")

    try:
        enqueue_result = enqueue_run(run_id, str(cfg_path))
    except Exception as exc:  # noqa: BLE001
        current = load_run_record(run_id) or record
        current["status"] = "failed"
        current["execution_backend"] = "celery-error"
        current["job_mode"] = "celery-error"
        current["job_id"] = "failed"
        current["error"] = str(exc)
        save_run_record(run_id, current)
        _append_run_log(run_id, f"Enqueue failed: {exc}")
        raise HTTPException(status_code=503, detail="Failed to enqueue run") from exc

    current = load_run_record(run_id) or record
    current["execution_backend"] = enqueue_result["mode"]
    current["job_mode"] = enqueue_result["mode"]
    current["job_id"] = enqueue_result["job_id"]
    save_run_record(run_id, current)
    _append_run_log(
        run_id,
        f"Enqueued: mode={enqueue_result['mode']} job_id={enqueue_result['job_id']}",
    )

    return RunCreateResponse(run_id=run_id, status="queued")


@router.get("/runs")
def list_runs(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
) -> dict:
    allowed_sort_keys = {"created_at", "status", "run_name", "run_id", "execution_backend"}

    sort_keys = _parse_csv(sort_by)
    if not sort_keys:
        sort_keys = ["created_at"]
    invalid_sort_keys = [k for k in sort_keys if k not in allowed_sort_keys]
    if invalid_sort_keys:
        raise HTTPException(status_code=400, detail="Invalid sort_by")

    sort_dirs = _parse_csv(sort_dir)
    if not sort_dirs:
        sort_dirs = ["desc"]
    if any(d not in {"asc", "desc"} for d in sort_dirs):
        raise HTTPException(status_code=400, detail="Invalid sort_dir")

    if len(sort_dirs) < len(sort_keys):
        sort_dirs.extend([sort_dirs[-1]] * (len(sort_keys) - len(sort_dirs)))
    elif len(sort_dirs) > len(sort_keys):
        sort_dirs = sort_dirs[: len(sort_keys)]

    records = [_reconcile_and_persist(r) for r in list_run_records()]

    filtered = records
    if status is not None:
        status_norm = status.strip().lower()
        filtered = [r for r in filtered if str(r.get("status", "")).lower() == status_norm]

    if q is not None and q.strip():
        q_norm = q.strip().lower()
        filtered = [
            r
            for r in filtered
            if q_norm in str(r.get("run_id", "")).lower()
            or q_norm in str(r.get("run_name", "")).lower()
        ]

    # Apply stable multi-key sort from least to most significant key.
    for key, direction in reversed(list(zip(sort_keys, sort_dirs))):
        filtered = sorted(
            filtered,
            key=lambda x: str(x.get(key, "")).lower(),
            reverse=(direction == "desc"),
        )

    total = len(filtered)
    page = filtered[offset : offset + limit]
    return {
        "runs": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "sort_by": ",".join(sort_keys),
        "sort_dir": ",".join(sort_dirs),
        "has_next": (offset + limit) < total,
    }


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    record = load_run_record(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return _reconcile_and_persist(record)


@router.get("/runs/{run_id}/artifacts")
def get_artifacts(run_id: str) -> dict:
    record = load_run_record(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    record = _reconcile_and_persist(record)
    return {"run_id": run_id, "artifacts": record.get("artifacts", [])}


@router.get("/runs/{run_id}/logs")
def get_run_logs(run_id: str, tail: int = Query(default=200, ge=1, le=2000)) -> dict:
    record = load_run_record(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    _reconcile_and_persist(record)

    path = run_log_path(run_id)
    lines = _tail_lines(path, tail)
    updated_at = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat() if path.exists() else None
    return {
        "run_id": run_id,
        "available": path.exists(),
        "updated_at": updated_at,
        "lines": lines,
    }


@router.get("/thermal-sources")
def list_thermal_sources() -> dict:
    """List available thermal data sources."""
    metadata_path = Path("data/metadata/thermal_sources.json")
    sources = {}
    if metadata_path.exists():
        import json as json_module
        sources = json_module.loads(metadata_path.read_text())
    
    return {
        "available_sources": list(sources.keys()),
        "sources": sources,
        "note": "Real-time fetch capability coming soon (NASA/USGS APIs)"
    }


@router.post("/thermal-sources/set")
def set_thermal_source(source: str = Query(..., description="Source: landsat, ecostress, or realtime")) -> dict:
    """Switch thermal data source for new runs."""
    valid_sources = ["landsat", "ecostress", "realtime"]
    if source not in valid_sources:
        raise HTTPException(status_code=400, detail=f"Invalid source. Must be one of: {valid_sources}")
    
    # Update default config
    config_path = Path("configs/boston.yaml")
    if config_path.exists():
        import yaml as yaml_module
        cfg = yaml_module.safe_load(config_path.read_text())
        cfg.setdefault("features", {})["thermal_source"] = source
        cfg.setdefault("features", {})["thermal_source_timestamp"] = _iso_now() if source == "realtime" else None
        config_path.write_text(yaml_module.safe_dump(cfg, sort_keys=False))
    
    return {
        "status": "set",
        "thermal_source": source,
        "timestamp": _iso_now()
    }


@router.get("/runs/{run_id}/map")
def get_run_map(run_id: str, source: str | None = Query(None, description="Optional thermal source override: landsat or ecostress")) -> dict:
    record = load_run_record(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    record = _reconcile_and_persist(record)

    config_path = _resolve_existing_path(record.get("config_path", ""))
    out_dir = _resolve_existing_path(record.get("out_dir", ""))
    if not config_path.exists():
        raise HTTPException(status_code=404, detail="run config not found")
    if not out_dir.exists():
        raise HTTPException(status_code=409, detail="run outputs not ready")

    selected_path = out_dir / "selected_interventions.json"
    eligibility_path = out_dir / "eligibility_summary.json"
    impact_summary_path = out_dir / "intervention_impact_summary.json"
    diagnostics_cells_path = out_dir / "cooling_access_cells.geojson"
    cheeger_bottleneck_path = out_dir / "cheeger_bottleneck.geojson"
    low_cooling_access_path = out_dir / "low_cooling_access_zones.geojson"
    cheeger_summary_path = out_dir / "cheeger_resistance_summary.json"
    if not selected_path.exists():
        raise HTTPException(status_code=409, detail="selected interventions not ready")

    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    if source:
        normalized_source = source.lower().strip()
        if normalized_source not in {"landsat", "ecostress"}:
            raise HTTPException(status_code=400, detail="source must be landsat or ecostress")
        features_cfg = cfg.setdefault("features", {})
        features_cfg["thermal_source"] = normalized_source
        features_cfg.setdefault("rasters", {})["lst"] = {"path_key": f"lst_{normalized_source}"}
    city_cfg = cfg.get("city", {})
    bbox = city_cfg.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise HTTPException(status_code=422, detail="invalid city bbox in run config")

    grid = make_grid(
        bbox_lonlat=[float(v) for v in bbox],
        resolution_m=float(city_cfg.get("grid_resolution_m", 1000)),
        crs=str(city_cfg.get("crs", "EPSG:4326")),
    )
    dp = DataPaths.from_cfg(cfg)
    grid_feat = apply_feature_plugins(grid.copy(), cfg, dp)

    selected_raw = json.loads(selected_path.read_text(encoding="utf-8"))
    impact_summary_raw: dict | None = None
    if impact_summary_path.exists():
        try:
            parsed_impact_summary = json.loads(impact_summary_path.read_text(encoding="utf-8"))
            if isinstance(parsed_impact_summary, dict):
                impact_summary_raw = parsed_impact_summary
        except Exception:
            impact_summary_raw = None

    selected_counts: dict[int, int] = {}
    selected_kinds: dict[int, set[str]] = {}
    selected_explanations: dict[int, list[str]] = {}
    selected_score_delta_by_cell: dict[int, float] = {}
    for row in selected_raw if isinstance(selected_raw, list) else []:
        if not isinstance(row, dict):
            continue
        target = row.get("target", row.get("node"))
        kind = str(row.get("kind", ""))
        try:
            target_id = int(target)
        except (TypeError, ValueError):
            continue
        if target_id >= 0:
            selected_counts[target_id] = selected_counts.get(target_id, 0) + 1
            selected_kinds.setdefault(target_id, set())
            if kind:
                selected_kinds[target_id].add(kind)
            explanation = row.get("explanation")
            if isinstance(explanation, str) and explanation.strip():
                selected_explanations.setdefault(target_id, []).append(explanation.strip())
            impact = row.get("impact")
            if isinstance(impact, dict):
                score_delta = impact.get("score_delta")
                if isinstance(score_delta, (int, float)):
                    selected_score_delta_by_cell[target_id] = (
                        selected_score_delta_by_cell.get(target_id, 0.0) + float(score_delta)
                    )

    grid["selected_count"] = grid["cell_id"].map(selected_counts).fillna(0).astype(int)
    grid["selected"] = grid["selected_count"] > 0
    grid["selected_kinds"] = grid["cell_id"].map(
        lambda cid: ",".join(sorted(selected_kinds.get(int(cid), set())))
    )
    grid["selected_icon"] = grid["cell_id"].map(
        lambda cid: _kinds_to_icon(selected_kinds.get(int(cid), set()))
    )
    grid["selected_score_delta"] = grid["cell_id"].map(
        lambda cid: float(selected_score_delta_by_cell.get(int(cid), 0.0))
    )
    grid["selected_explanations"] = grid["cell_id"].map(
        lambda cid: " | ".join(selected_explanations.get(int(cid), []))
    )

    diagnostics_cells_geojson = _read_geojson(diagnostics_cells_path)
    _merge_diagnostic_properties(grid, diagnostics_cells_geojson)

    # Heat corridors: high observed temperature cells based on configured observed temp column.
    lst_column = str(cfg.get("features", {}).get("observed_temp_column", "lst"))
    heat_corridor_threshold: float | None = None
    heat_corridor_quantile = 0.85
    heat_corridor_status = "unavailable"
    heat_corridor_reason = "observed_temperature_column_missing"
    thermal_variation_std: float | None = None
    thermal_variation_unique_values = 0
    
    # Initialize columns with proper types for GeoJSON serialization
    grid["observed_temp"] = np.nan
    grid["heat_corridor"] = False
    
    if lst_column in grid_feat.columns:
        vals = np.asarray(grid_feat[lst_column].values, dtype=float)
        finite = vals[np.isfinite(vals)]
        unique_vals = int(np.unique(finite).size) if finite.size > 0 else 0
        std_val = float(np.std(finite)) if finite.size > 0 else 0.0
        thermal_variation_std = std_val if finite.size > 0 else None
        thermal_variation_unique_values = unique_vals
        if finite.size > 0 and unique_vals >= 5 and std_val >= 0.1:
            heat_corridor_threshold = float(np.quantile(finite, heat_corridor_quantile))
            by_cell = dict(zip(grid_feat["cell_id"].astype(int).tolist(), vals.tolist()))
            grid["observed_temp"] = grid["cell_id"].map(lambda cid: float(by_cell.get(int(cid), np.nan)))
            grid["heat_corridor"] = grid["observed_temp"].map(
                lambda v: bool(np.isfinite(v) and float(v) >= float(heat_corridor_threshold))
            )
            heat_corridor_status = "ready"
            heat_corridor_reason = "observed_temperature_quantile"
        elif finite.size > 0:
            grid["observed_temp"] = grid["cell_id"].map(
                lambda cid: float(grid_feat[grid_feat["cell_id"] == cid][lst_column].iloc[0] if len(grid_feat[grid_feat["cell_id"] == cid]) > 0 else np.nan)
            )
            grid["heat_corridor"] = [False] * len(grid)
            heat_corridor_status = "unavailable"
            heat_corridor_reason = "observed_temperature_uniform_or_low_variance"
        else:
            grid["observed_temp"] = [np.nan] * len(grid)
            grid["heat_corridor"] = [False] * len(grid)
            heat_corridor_status = "unavailable"
            heat_corridor_reason = "observed_temperature_all_missing"
    else:
        grid["observed_temp"] = [np.nan] * len(grid)
        grid["heat_corridor"] = [False] * len(grid)
        heat_corridor_status = "unavailable"
        heat_corridor_reason = "observed_temperature_column_missing"

    eligibility_source: str | None = None
    eligible_cells: int | None = None
    if eligibility_path.exists():
        try:
            eligibility_raw = json.loads(eligibility_path.read_text(encoding="utf-8"))
            if isinstance(eligibility_raw, dict):
                source_value = eligibility_raw.get("source")
                cells_value = eligibility_raw.get("eligible_cells")
                if isinstance(source_value, str):
                    eligibility_source = source_value
                if isinstance(cells_value, int):
                    eligible_cells = cells_value
        except Exception:
            eligibility_source = None
            eligible_cells = None

    # Determine thermal data source and provider info
    thermal_data_source = "Unknown"
    thermal_data_provider = "Unknown"
    thermal_data_timestamp = "Unknown"
    
    if lst_column in {"lst", "lst_landsat"}:
        thermal_data_source = "Landsat Collection 2 Surface Temperature"
        thermal_data_provider = "USGS/NASA"
    elif lst_column == "lst_ecostress":
        thermal_data_source = "ECOSTRESS Land Surface Temperature"
        thermal_data_provider = "NASA JPL"
    elif lst_column == "lst_landsat":
        thermal_data_source = "Landsat LST (Land Surface Temperature)"
        thermal_data_provider = "USGS/NASA"
    else:
        thermal_data_source = lst_column
        thermal_data_provider = "Data Catalog"
    
    # Try to get timestamp from config or use current time
    thermal_timestamp_value = cfg.get("features", {}).get("observed_temp_timestamp")
    if thermal_timestamp_value:
        thermal_data_timestamp = str(thermal_timestamp_value)
    else:
        thermal_data_timestamp = datetime.now(UTC).isoformat()

    cheeger_bottleneck_geojson = _read_geojson(cheeger_bottleneck_path)
    low_cooling_access_geojson = _read_geojson(low_cooling_access_path)
    cheeger_resistance_summary = _read_json_dict(cheeger_summary_path)

    return {
        "run_id": run_id,
        "city": str(city_cfg.get("name", "city")),
        "bbox": [float(v) for v in bbox],
        "feature_count": int(len(grid)),
        "selected_cells": int(sum(1 for v in selected_counts.values() if v > 0)),
        "eligible_cells": eligible_cells,
        "eligibility_source": eligibility_source,
        "heat_corridor_method": {
            "status": heat_corridor_status,
            "reason": heat_corridor_reason,
            "metric": lst_column,
            "quantile": heat_corridor_quantile,
            "threshold": heat_corridor_threshold,
            "cells": int(grid["heat_corridor"].sum()) if "heat_corridor" in grid.columns else 0,
            "source": thermal_data_source,
            "provider": thermal_data_provider,
            "timestamp": thermal_data_timestamp,
        },
        "thermal_variation": {
            "metric": lst_column,
            "std": thermal_variation_std,
            "unique_values": thermal_variation_unique_values,
            "gate_passed": heat_corridor_status == "ready",
        },
        "accuracy_note": "Heat corridors are derived from available observed temperature data and are not guaranteed to be 100% ground truth.",
        "available_interventions": [str(v) for v in cfg.get("interventions", {}).get("types", [])],
        "intervention_costs": {
            str(k): float(v)
            for k, v in dict(cfg.get("interventions", {}).get("costs", {})).items()
        },
        "intervention_icon_legend": {
            k: _kind_to_icon(k)
            for k in {str(x) for x in cfg.get("interventions", {}).get("types", [])}
        },
        "selected_intervention_kinds": sorted({k for kinds in selected_kinds.values() for k in kinds}),
        "intervention_impact_summary": impact_summary_raw,
        "cheeger_bottleneck_geojson": cheeger_bottleneck_geojson,
        "low_cooling_access_geojson": low_cooling_access_geojson,
        "cheeger_resistance_summary": cheeger_resistance_summary,
        "geojson": json.loads(grid.to_json()),
    }
