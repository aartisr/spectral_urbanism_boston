from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

import yaml
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
API_DIR = ROOT / "services" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from app.main import app
from app.core.store import save_run_record


MIN_CONFIG = {
    "run": {"run_id": "integration", "seed": 42, "out_dir": "outputs"},
    "city": {"bbox": [-71.0, 42.0, -70.9, 42.1], "crs": "EPSG:4326", "grid_resolution_m": 1000},
    "data_paths": {
        "root": "data",
        "osm": "data/osm/boston.osm.pbf",
        "lst_landsat": "data/thermal/landsat_lst.tif",
        "ndvi_s2": "data/ndvi/sentinel2_ndvi.tif",
        "albedo": "data/albedo/albedo.tif",
        "impervious": "data/landcover/impervious.tif",
        "wind": "data/wind/noaa_wind.csv",
        "svi": "data/equity/cdc_svi.csv",
        "buildings": "data/buildings/buildings.gpkg",
        "canopy": "data/canopy/canopy.gpkg",
    },
    "graph": {"edge_mode": "adjacency_plus_wind", "wind_k": 1, "weight_model": {}},
    "gmrf": {"tau": 1.0, "epsilon": 0.001, "obs_noise": 0.5},
    "interventions": {
        "budget_k": 2,
        "types": ["tree"],
        "costs": {"tree": 1.0},
        "effects": {"tree": {}},
    },
    "objective": {
        "alpha_lambda2": 1.0,
        "beta_reliability": 1.0,
        "gamma_equity": 1.0,
        "equity": {"svi_column": "SVI"},
    },
}


def test_config_validate_happy_path() -> None:
    client = TestClient(app)
    res = client.post("/api/v1/configs/validate", json={"config": MIN_CONFIG})
    assert res.status_code == 200
    payload = res.json()
    assert payload["valid"] is True
    assert "defaults" in payload["plugin_health"]


def test_config_validate_reports_strict_schema_errors() -> None:
    client = TestClient(app)

    bad_config = dict(MIN_CONFIG)
    bad_config["city"] = dict(MIN_CONFIG["city"])
    bad_config["city"]["grid_resolution_m"] = 0

    res = client.post("/api/v1/configs/validate", json={"config": bad_config})
    assert res.status_code == 200
    payload = res.json()
    assert payload["valid"] is False
    assert any("city.grid_resolution_m" in err for err in payload["errors"])


def test_config_validate_reports_plugin_capability_gaps() -> None:
    client = TestClient(app)

    cfg = dict(MIN_CONFIG)
    cfg["features"] = {
        "plugins": ["defaults"],
        "required_capabilities": ["equity"],
        "auto_discover_plugins": False,
    }

    res = client.post("/api/v1/configs/validate", json={"config": cfg})
    assert res.status_code == 200
    payload = res.json()
    assert payload["valid"] is False
    assert any("Required plugin capabilities not satisfied" in err for err in payload["errors"])


def test_run_create_and_list(monkeypatch) -> None:
    client = TestClient(app)

    def _fake_enqueue(run_id: str, config_path: str) -> dict[str, str]:
        return {"mode": "test", "job_id": f"job-{run_id[:8]}"}

    import app.routes.runs as runs_module

    monkeypatch.setattr(runs_module, "enqueue_run", _fake_enqueue)

    run_name = f"integration-{uuid4()}"
    create_res = client.post(
        "/api/v1/runs",
        json={"run_name": run_name, "config": MIN_CONFIG},
    )
    assert create_res.status_code == 200
    run_id = create_res.json()["run_id"]

    get_res = client.get(f"/api/v1/runs/{run_id}")
    assert get_res.status_code == 200
    run_payload = get_res.json()
    assert run_payload["run_name"] == run_name
    assert run_payload["status"] in {"queued", "running", "succeeded", "failed"}

    list_res = client.get("/api/v1/runs")
    assert list_res.status_code == 200
    runs = list_res.json()["runs"]
    assert any(x.get("run_id") == run_id for x in runs)


def test_artifacts_endpoint_for_completed_run() -> None:
    client = TestClient(app)
    run_id = str(uuid4())
    artifacts = [
        {
            "name": "greedy_history.csv",
            "path": "outputs/test_run/greedy_history.csv",
            "size_bytes": 123,
        },
        {
            "name": "selected_interventions.json",
            "path": "outputs/test_run/selected_interventions.json",
            "size_bytes": 456,
        },
    ]
    save_run_record(
        run_id,
        {
            "run_id": run_id,
            "run_name": "synthetic-completed",
            "status": "succeeded",
            "created_at": "2026-01-01T00:00:00+00:00",
            "finished_at": "2026-01-01T00:01:00+00:00",
            "artifacts": artifacts,
        },
    )

    res = client.get(f"/api/v1/runs/{run_id}/artifacts")
    assert res.status_code == 200
    payload = res.json()
    assert payload["run_id"] == run_id
    assert payload["artifacts"] == artifacts


def test_run_map_resolves_docker_app_paths() -> None:
    client = TestClient(app)
    run_id = str(uuid4())
    run_name = f"map-path-{run_id}"
    cfg_path = ROOT / "outputs" / "_meta" / "runs" / f"{run_id}.yaml"
    out_dir = ROOT / "outputs" / run_name
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = dict(MIN_CONFIG)
    cfg["run"] = dict(MIN_CONFIG["run"])
    cfg["run"]["run_id"] = run_name
    cfg["run"]["out_dir"] = "outputs"
    cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    (out_dir / "selected_interventions.json").write_text("[]", encoding="utf-8")
    (out_dir / "eligibility_summary.json").write_text(
        '{"source": "test", "eligible_cells": 0}',
        encoding="utf-8",
    )

    save_run_record(
        run_id,
        {
            "run_id": run_id,
            "run_name": run_name,
            "status": "succeeded",
            "created_at": "2026-01-01T00:00:00+00:00",
            "config_path": f"/app/outputs/_meta/runs/{run_id}.yaml",
            "out_dir": f"/app/outputs/{run_name}",
            "artifacts": [],
        },
    )

    res = client.get(f"/api/v1/runs/{run_id}/map")
    assert res.status_code == 200
    payload = res.json()
    assert payload["run_id"] == run_id
    assert payload["feature_count"] > 0
    assert payload["heat_corridor_method"]["status"] == "ready"


def test_runs_list_filters_and_pagination() -> None:
    client = TestClient(app)

    run_a = str(uuid4())
    run_b = str(uuid4())
    run_c = str(uuid4())

    save_run_record(
        run_a,
        {
            "run_id": run_a,
            "run_name": "alpha-test",
            "status": "succeeded",
            "created_at": "2026-01-01T00:00:00+00:00",
            "artifacts": [],
        },
    )
    save_run_record(
        run_b,
        {
            "run_id": run_b,
            "run_name": "beta-test",
            "status": "failed",
            "created_at": "2026-01-01T00:01:00+00:00",
            "artifacts": [],
        },
    )
    save_run_record(
        run_c,
        {
            "run_id": run_c,
            "run_name": "alpha-runner",
            "status": "running",
            "created_at": "2026-01-01T00:02:00+00:00",
            "artifacts": [],
        },
    )

    res_status = client.get("/api/v1/runs", params={"status": "failed"})
    assert res_status.status_code == 200
    status_payload = res_status.json()
    assert status_payload["total"] >= 1
    assert all(x.get("status") == "failed" for x in status_payload["runs"])

    res_search = client.get("/api/v1/runs", params={"q": "alpha"})
    assert res_search.status_code == 200
    search_payload = res_search.json()
    assert all(
        "alpha" in (str(x.get("run_name", "")).lower() + str(x.get("run_id", "")).lower())
        for x in search_payload["runs"]
    )

    res_page = client.get("/api/v1/runs", params={"limit": 1, "offset": 0})
    assert res_page.status_code == 200
    page_payload = res_page.json()
    assert page_payload["limit"] == 1
    assert page_payload["offset"] == 0
    assert len(page_payload["runs"]) <= 1

    res_sorted = client.get(
        "/api/v1/runs",
        params={"sort_by": "run_name", "sort_dir": "asc", "limit": 200, "offset": 0},
    )
    assert res_sorted.status_code == 200
    sorted_payload = res_sorted.json()
    names = [str(x.get("run_name", "")).lower() for x in sorted_payload["runs"]]
    assert names == sorted(names)

    res_multi_sorted = client.get(
        "/api/v1/runs",
        params={
            "sort_by": "status,run_name",
            "sort_dir": "asc,desc",
            "limit": 200,
            "offset": 0,
        },
    )
    assert res_multi_sorted.status_code == 200
    multi_payload = res_multi_sorted.json()
    assert multi_payload["sort_by"] == "status,run_name"
    assert multi_payload["sort_dir"] == "asc,desc"

    res_invalid = client.get("/api/v1/runs", params={"sort_by": "bad_key"})
    assert res_invalid.status_code == 400
