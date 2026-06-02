"""Reproducibility regression tests.

Running the pipeline twice with the same seed and configuration must produce
byte-identical output files for all deterministic artifacts.  This catches any
accidental introduction of randomness (non-seeded numpy calls, dict iteration
order changes, non-deterministic graph construction, etc.).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from spectral_urbanism.pipelines.run_city import run


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_min_config(tmp_path: Path, run_id: str = "repro_run") -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    cfg_path = tmp_path / f"{run_id}.yaml"
    cfg = {
        "run": {"run_id": run_id, "seed": 42, "out_dir": str(tmp_path / "outputs" / run_id)},
        "city": {
            "name": "ReproCity",
            "bbox": [-71.0, 42.0, -70.99, 42.01],
            "crs": "EPSG:4326",
            "grid_resolution_m": 2000,
        },
        "data_paths": {"root": str(tmp_path / "data")},
        "features": {
            "auto_discover_plugins": False,
            "plugins": ["defaults", "equity_placeholder"],
            "defaults": {"lst": 36.0, "ndvi": 0.25, "albedo": 0.12, "impervious": 0.55},
            "required_capabilities": ["equity"],
        },
        "graph": {"edge_mode": "adjacency", "wind_k": 0, "weight_model": {}},
        "gmrf": {"tau": 1.0, "epsilon": 1e-3, "obs_noise": 0.5},
        "interventions": {
            "budget_k": 3,
            "types": ["tree"],
            "costs": {"tree": 1.0},
            "effects": {"tree": {"edge_weight_multiplier": 1.05}},
        },
        "objective": {
            "alpha_lambda2": 1.0,
            "beta_reliability": 1.0,
            "gamma_equity": 1.0,
            "equity": {"svi_column": "SVI", "top_quantile": 0.8},
        },
        "experiments": {
            "monte_carlo_draws": 10,
            "reliability_p_keep": 0.9,
            "confidence_alpha": 0.05,
            "ablations": [],
        },
        "optimization": {"eval_top_k": 10, "stop_if_nonpositive_gain": True},
        "baselines": {"enabled": ["random", "hottest", "population"]},
    }
    cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    return cfg_path


def _load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Deterministic artifact names that must be identical across runs
# ---------------------------------------------------------------------------
DETERMINISTIC_ARTIFACTS = [
    "selected_interventions.json",
    "greedy_history.csv",
    "fairness_audit.json",
]

# Artifacts that may differ in timestamps / wall-clock fields but whose
# *structural* keys must be identical.
STRUCTURAL_ARTIFACTS = [
    "provenance_manifest.json",
    "data_quality_report.json",
    "decision_log.json",
]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.timeout(120)
def test_pipeline_is_deterministic(tmp_path: Path) -> None:
    """Two runs with identical config + seed must produce identical outputs."""
    cfg_a = _write_min_config(tmp_path / "a", run_id="run_a")
    cfg_b = _write_min_config(tmp_path / "b", run_id="run_a")  # same run_id for same paths

    # Ensure out_dirs are separate so outputs don't overwrite each other.
    # Patch out_dir in each config independently.
    out_a = tmp_path / "out_a"
    out_b = tmp_path / "out_b"

    def _patch_out(cfg_path: Path, out_dir: Path) -> Path:
        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
        data["run"]["out_dir"] = str(out_dir)
        data["run"]["run_id"] = "repro"
        cfg_path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        return cfg_path

    _patch_out(cfg_a, out_a)
    _patch_out(cfg_b, out_b)

    run_out_a = Path(run(str(cfg_a)))
    run_out_b = Path(run(str(cfg_b)))

    # 1. Deterministic artifacts must be byte-identical
    for artifact in DETERMINISTIC_ARTIFACTS:
        file_a = run_out_a / artifact
        file_b = run_out_b / artifact
        assert file_a.exists(), f"Run A missing {artifact}"
        assert file_b.exists(), f"Run B missing {artifact}"
        content_a = file_a.read_text(encoding="utf-8").strip()
        content_b = file_b.read_text(encoding="utf-8").strip()
        assert content_a == content_b, (
            f"Non-deterministic output in {artifact}.\n"
            f"Run A:\n{content_a[:500]}\n\nRun B:\n{content_b[:500]}"
        )

    # 2. Structural artifacts: same top-level keys, same quality_gate_passed value
    dq_a = _load_json(run_out_a / "data_quality_report.json")
    dq_b = _load_json(run_out_b / "data_quality_report.json")
    assert isinstance(dq_a, dict) and isinstance(dq_b, dict)
    assert dq_a.keys() == dq_b.keys(), "data_quality_report.json keys differ between runs"
    assert dq_a["quality_gate_passed"] == dq_b["quality_gate_passed"]

    prov_a = _load_json(run_out_a / "provenance_manifest.json")
    prov_b = _load_json(run_out_b / "provenance_manifest.json")
    assert isinstance(prov_a, dict) and isinstance(prov_b, dict)
    assert prov_a.keys() == prov_b.keys(), "provenance_manifest.json keys differ between runs"

    # Seed must be recorded identically
    assert prov_a.get("seed") == prov_b.get("seed"), "Seed mismatch in provenance manifests"


@pytest.mark.timeout(120)
def test_selected_interventions_stable_across_seeds(tmp_path: Path) -> None:
    """With the same seed, selected interventions must be the same set (order-insensitive)."""
    cfg_a = _write_min_config(tmp_path / "s1", run_id="seed_run")
    cfg_b = _write_min_config(tmp_path / "s2", run_id="seed_run")

    out_a = tmp_path / "out_s1"
    out_b = tmp_path / "out_s2"

    def _patch(p: Path, out: Path) -> None:
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
        data["run"]["out_dir"] = str(out)
        data["run"]["run_id"] = "seedcheck"
        p.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    _patch(cfg_a, out_a)
    _patch(cfg_b, out_b)

    run_out_a = Path(run(str(cfg_a)))
    run_out_b = Path(run(str(cfg_b)))

    sel_a = _load_json(run_out_a / "selected_interventions.json")
    sel_b = _load_json(run_out_b / "selected_interventions.json")

    # Node IDs selected must be identical sets
    nodes_a = {item["node"] for item in sel_a} if isinstance(sel_a, list) else set()
    nodes_b = {item["node"] for item in sel_b} if isinstance(sel_b, list) else set()
    assert nodes_a == nodes_b, (
        f"Selected nodes differ across identical-seed runs: {nodes_a} vs {nodes_b}"
    )
