from __future__ import annotations

import json
from pathlib import Path

from spectral_urbanism.experiments.benchmark import run_ablations, run_benchmark
from spectral_urbanism.pipelines.run_city import run



def _write_min_config(tmp_path: Path) -> Path:
  cfg_path = tmp_path / "city.yaml"
  cfg = {
    "run": {"run_id": "unit_run", "seed": 7, "out_dir": str(tmp_path / "outputs")},
    "city": {
      "name": "UnitCity",
      "bbox": [-71.0, 42.0, -70.99, 42.01],
      "crs": "EPSG:4326",
      "grid_resolution_m": 2000,
    },
    "data_paths": {"root": str(tmp_path / "data")},
    "features": {
      "auto_discover_plugins": False,
      "plugins": ["defaults", "equity_placeholder"],
      "defaults": {"lst": 35.0, "ndvi": 0.2, "albedo": 0.15, "impervious": 0.5},
      "required_capabilities": ["equity"],
    },
    "graph": {"edge_mode": "adjacency", "wind_k": 0, "weight_model": {}},
    "gmrf": {"tau": 1.0, "epsilon": 1e-3, "obs_noise": 0.5},
    "interventions": {
      "budget_k": 2,
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
    "experiments": {"monte_carlo_draws": 10, "reliability_p_keep": 0.9, "confidence_alpha": 0.05, "ablations": []},
    "optimization": {"eval_top_k": 10, "stop_if_nonpositive_gain": True},
    "baselines": {"enabled": ["random", "hottest", "population"]},
  }
  import yaml

  cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
  return cfg_path



def test_run_writes_operational_artifacts(tmp_path: Path) -> None:
  cfg_path = _write_min_config(tmp_path)
  out_dir = Path(run(str(cfg_path)))

  assert (out_dir / "greedy_history.csv").exists()
  assert (out_dir / "selected_interventions.json").exists()
  assert (out_dir / "provenance_manifest.json").exists()
  assert (out_dir / "data_quality_report.json").exists()
  assert (out_dir / "fairness_audit.json").exists()
  assert (out_dir / "decision_log.json").exists()

  report = json.loads((out_dir / "data_quality_report.json").read_text(encoding="utf-8"))
  assert report["quality_gate_passed"] is True



def test_benchmark_and_ablation_outputs(tmp_path: Path) -> None:
  cfg_path = _write_min_config(tmp_path)
  bench_dir = Path(run_benchmark(str(cfg_path)))
  assert (bench_dir / "benchmark_summary.json").exists()

  ablation_dir = Path(run_ablations(str(cfg_path)))
  assert (ablation_dir / "ablation_summary.json").exists()
