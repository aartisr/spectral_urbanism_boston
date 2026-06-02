from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import geopandas as gpd
import numpy as np
import networkx as nx

from spectral_urbanism.city.grid import make_grid
from spectral_urbanism.city.plugins import apply_feature_plugins
from spectral_urbanism.config.schema import CityPipelineConfig
from spectral_urbanism.data.catalog import DataPaths
from spectral_urbanism.experiments.decision import build_decision_log
from spectral_urbanism.experiments.fairness import build_fairness_audit
from spectral_urbanism.experiments.provenance import build_provenance_manifest
from spectral_urbanism.experiments.qa import build_data_quality_report
from spectral_urbanism.experiments.report import save_history_csv, save_json
from spectral_urbanism.graph.build import build_graph
from spectral_urbanism.graph.laplacian import normalized_laplacian
from spectral_urbanism.model.gmrf import fit_gmrf
from spectral_urbanism.opt.greedy import GreedyResult, greedy_select
from spectral_urbanism.opt.interventions import (
  Intervention,
  apply_intervention,
  candidate_interventions,
  intervention_weight_multiplier,
)
from spectral_urbanism.opt.objective import ObjectiveWeights
from spectral_urbanism.utils.io import ensure_dir, load_yaml
from spectral_urbanism.utils.seed import set_seed


@dataclass(frozen=True)
class RunContext:
  data_paths: DataPaths
  grid: gpd.GeoDataFrame
  grid_feat: gpd.GeoDataFrame
  data_quality_report: dict[str, Any]
  graph: nx.Graph
  temp_mean: np.ndarray
  vulnerability: np.ndarray
  effects: dict[str, Any]
  candidates: list[Intervention]
  eligible_nodes: list[int] | None
  corridor_nodes: list[int] | None
  eligibility_source: str
  weights: ObjectiveWeights
  greedy_result: GreedyResult


def _ensure_observed_temp_column(grid_feat: gpd.GeoDataFrame, cfg: dict[str, Any]) -> tuple[gpd.GeoDataFrame, str | None]:
  features_cfg = cfg.get("features", {})
  observed_col = str(features_cfg.get("observed_temp_column", "lst"))
  defaults = features_cfg.get("defaults", {})

  fallback_raw: Any = None
  if isinstance(defaults, dict):
    fallback_raw = defaults.get(observed_col, defaults.get("lst"))

  fallback_value: float | None = None
  try:
    if fallback_raw is not None:
      fallback_value = float(fallback_raw)
  except (TypeError, ValueError):
    fallback_value = None

  out = grid_feat.copy()

  if observed_col not in out.columns:
    if fallback_value is not None:
      out[observed_col] = fallback_value
      return out, f"observed_temp_column_missing_filled_with_default:{observed_col}={fallback_value}"
    return out, None

  series = np.asarray(out[observed_col].values, dtype=float)
  finite_mask = np.isfinite(series)
  if not finite_mask.any() and fallback_value is not None:
    out[observed_col] = fallback_value
    return out, f"observed_temp_all_nan_filled_with_default:{observed_col}={fallback_value}"

  return out, None


def _build_intervention_explanation(
  intervention: Intervention,
  multiplier: float,
  edge_count: int,
  total_weight_before: float,
  total_weight_after: float,
  score_delta: float,
  lambda2_delta: float,
  reliability_delta: float,
  equity_delta: float,
  score_per_cost: float,
) -> str:
  direction = "increases" if multiplier >= 1.0 else "decreases"
  equity_direction = "decreased" if equity_delta < 0 else "increased"
  return (
    f"Step intervention '{intervention.kind}' at cell {int(intervention.target)} {direction} local thermal-network coupling "
    f"by applying an edge-weight multiplier of {multiplier:.3f} to {edge_count} incident edges "
    f"(total local weight {total_weight_before:.3f} -> {total_weight_after:.3f}). "
    f"This changed composite objective score by {score_delta:+.6f} (per-cost efficiency {score_per_cost:+.6f}), "
    f"with metric deltas lambda2={lambda2_delta:+.6f}, reliability={reliability_delta:+.6f}, and equity_exposure={equity_delta:+.6f} "
    f"(equity exposure {equity_direction}, lower is better)."
  )


def _build_selected_interventions_with_impact(
  selected: list[Intervention],
  history: list[dict[str, float]],
  base_graph: Any,
  effects: dict[str, Any],
  weights: ObjectiveWeights,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  working_graph = base_graph

  baseline = history[0] if history else {"score": 0.0, "lambda2": 0.0, "reliability": 0.0, "equity": 0.0}
  final = history[-1] if history else baseline
  total_score_gain = float(final.get("score", 0.0) - baseline.get("score", 0.0))

  for idx, intervention in enumerate(selected, start=1):
    if idx >= len(history):
      break

    prev_metrics = history[idx - 1]
    curr_metrics = history[idx]

    score_delta = float(curr_metrics.get("score", 0.0) - prev_metrics.get("score", 0.0))
    lambda2_delta = float(curr_metrics.get("lambda2", 0.0) - prev_metrics.get("lambda2", 0.0))
    reliability_delta = float(curr_metrics.get("reliability", 0.0) - prev_metrics.get("reliability", 0.0))
    equity_delta = float(curr_metrics.get("equity", 0.0) - prev_metrics.get("equity", 0.0))

    weighted_lambda2 = float(weights.alpha_lambda2 * lambda2_delta)
    weighted_reliability = float(weights.beta_reliability * reliability_delta)
    weighted_equity = float(-weights.gamma_equity * equity_delta)
    recomposed_score_delta = float(weighted_lambda2 + weighted_reliability + weighted_equity)
    recomposition_residual = float(score_delta - recomposed_score_delta)

    multiplier = float(intervention_weight_multiplier(intervention.kind, effects))
    incident_weights = [float(d.get("weight", 1.0)) for _, _, d in working_graph.edges(intervention.target, data=True)]
    edge_count = int(len(incident_weights))
    total_weight_before = float(sum(incident_weights))
    total_weight_after = float(total_weight_before * multiplier)
    score_per_cost = float(score_delta / max(float(intervention.cost), 1e-9))
    share_of_total_gain = float(score_delta / total_score_gain) if abs(total_score_gain) > 1e-12 else 0.0

    row = {
      "step": idx,
      "kind": intervention.kind,
      "node": int(intervention.target),
      "target": int(intervention.target),
      "cost": float(intervention.cost),
      "model_effect": {
        "edge_weight_multiplier": multiplier,
        "incident_edge_count": edge_count,
        "total_incident_weight_before": total_weight_before,
        "total_incident_weight_after": total_weight_after,
      },
      "impact": {
        "score_delta": score_delta,
        "score_per_cost": score_per_cost,
        "share_of_total_score_gain": share_of_total_gain,
        "metric_deltas": {
          "lambda2": lambda2_delta,
          "reliability": reliability_delta,
          "equity_exposure": equity_delta,
        },
        "weighted_component_contributions": {
          "lambda2": weighted_lambda2,
          "reliability": weighted_reliability,
          "equity_exposure": weighted_equity,
          "recomposed_score_delta": recomposed_score_delta,
          "recomposition_residual": recomposition_residual,
        },
      },
    }
    row["explanation"] = _build_intervention_explanation(
      intervention=intervention,
      multiplier=multiplier,
      edge_count=edge_count,
      total_weight_before=total_weight_before,
      total_weight_after=total_weight_after,
      score_delta=score_delta,
      lambda2_delta=lambda2_delta,
      reliability_delta=reliability_delta,
      equity_delta=equity_delta,
      score_per_cost=score_per_cost,
    )
    rows.append(row)

    working_graph = apply_intervention(working_graph, intervention, effects)

  summary = {
    "steps_selected": int(len(rows)),
    "baseline": {
      "score": float(baseline.get("score", 0.0)),
      "lambda2": float(baseline.get("lambda2", 0.0)),
      "reliability": float(baseline.get("reliability", 0.0)),
      "equity_exposure": float(baseline.get("equity", 0.0)),
    },
    "final": {
      "score": float(final.get("score", 0.0)),
      "lambda2": float(final.get("lambda2", 0.0)),
      "reliability": float(final.get("reliability", 0.0)),
      "equity_exposure": float(final.get("equity", 0.0)),
    },
    "net_improvement": {
      "score_delta": float(final.get("score", 0.0) - baseline.get("score", 0.0)),
      "lambda2_delta": float(final.get("lambda2", 0.0) - baseline.get("lambda2", 0.0)),
      "reliability_delta": float(final.get("reliability", 0.0) - baseline.get("reliability", 0.0)),
      "equity_exposure_delta": float(final.get("equity", 0.0) - baseline.get("equity", 0.0)),
    },
    "objective_formula": (
      "score = alpha_lambda2 * lambda2 + beta_reliability * reliability - gamma_equity * equity_exposure"
    ),
  }
  return rows, summary


def load_config(config_path: str) -> dict[str, Any]:
  return CityPipelineConfig.model_validate(load_yaml(config_path)).model_dump(mode="python")


def build_run_context(cfg: dict[str, Any]) -> RunContext:
  dp = DataPaths.from_cfg(cfg)

  grid = make_grid(cfg["city"]["bbox"], cfg["city"]["grid_resolution_m"], crs=cfg["city"]["crs"])
  grid_feat = apply_feature_plugins(grid, cfg, dp)
  grid_feat, temp_fill_note = _ensure_observed_temp_column(grid_feat, cfg)
  data_quality_report = build_data_quality_report(grid_feat, cfg)

  strict_thermal_gate = bool(cfg.get("experiments", {}).get("enforce_thermal_variation_gate", False))
  thermal_gate_passed = bool(data_quality_report.get("thermal_variation_gate_passed", False))
  data_quality_report["thermal_variation_gate_enforced"] = strict_thermal_gate
  if temp_fill_note:
    data_quality_report["observed_temp_fallback"] = temp_fill_note

  if strict_thermal_gate and not thermal_gate_passed:
    lst_col = str(cfg.get("features", {}).get("observed_temp_column", "lst"))
    lst_stats = data_quality_report.get("columns", {}).get(lst_col, {})
    raise ValueError(
      "Thermal variation gate failed: "
      f"column={lst_col}, std={lst_stats.get('std')}, unique_values={lst_stats.get('unique_values')}. "
      "Operational heat-corridor confidence requires non-uniform observed thermal input."
    )

  G = build_graph(
    grid_feat,
    edge_mode=cfg["graph"]["edge_mode"],
    wind_k=int(cfg["graph"]["wind_k"]),
    weight_params=cfg["graph"]["weight_model"],
  )

  from scipy.sparse import diags

  L = normalized_laplacian(G)
  tau = float(cfg["gmrf"]["tau"])
  eps = float(cfg["gmrf"]["epsilon"])
  Q = tau * L + diags(np.ones(L.shape[0]) * eps)

  lst_column = str(cfg.get("features", {}).get("observed_temp_column", "lst"))
  y = grid_feat[lst_column].values.astype(float)
  obs_idx = np.arange(len(y), dtype=int)
  posterior = fit_gmrf(Q, y=y, obs_idx=obs_idx, obs_noise=float(cfg["gmrf"]["obs_noise"]))
  temp_mean = posterior.mean

  svi_column = str(cfg["objective"]["equity"]["svi_column"])
  vulnerability = grid_feat[svi_column].values.astype(float)

  kinds = cfg["interventions"]["types"]
  costs = cfg["interventions"]["costs"]
  effects = cfg["interventions"]["effects"]
  eligible_nodes, eligibility_source = _eligible_intervention_nodes(grid_feat, dp)
  corridor_nodes = _heat_corridor_nodes(grid_feat)
  if eligible_nodes:
    cands = candidate_interventions(sorted(eligible_nodes), kinds, costs)
  else:
    cands = candidate_interventions(list(G.nodes()), kinds, costs)

  weights = ObjectiveWeights(
    alpha_lambda2=float(cfg["objective"]["alpha_lambda2"]),
    beta_reliability=float(cfg["objective"]["beta_reliability"]),
    gamma_equity=float(cfg["objective"]["gamma_equity"]),
  )

  res = greedy_select(
    G,
    candidates=cands,
    temp_mean=temp_mean,
    vulnerability=vulnerability,
    effects=effects,
    weights=weights,
    budget_k=int(cfg["interventions"]["budget_k"]),
    corridor_nodes=corridor_nodes,
    corridor_preference_weight=float(cfg.get("optimization", {}).get("corridor_preference_weight", 0.0)),
    rel_p_keep=float(cfg.get("experiments", {}).get("reliability_p_keep", 0.95)),
    rel_draws=int(cfg.get("experiments", {}).get("monte_carlo_draws", 200)),
    seed=int(cfg["run"]["seed"]),
    eval_top_k=cfg.get("optimization", {}).get("eval_top_k"),
    stop_if_nonpositive_gain=bool(cfg.get("optimization", {}).get("stop_if_nonpositive_gain", True)),
  )

  return RunContext(
    data_paths=dp,
    grid=grid,
    grid_feat=grid_feat,
    data_quality_report=data_quality_report,
    graph=G,
    temp_mean=temp_mean,
    vulnerability=vulnerability,
    effects=effects,
    candidates=cands,
    eligible_nodes=sorted(eligible_nodes) if eligible_nodes else None,
    corridor_nodes=sorted(corridor_nodes) if corridor_nodes else None,
    eligibility_source=eligibility_source,
    weights=weights,
    greedy_result=res,
  )


def _eligible_intervention_nodes(grid_feat: gpd.GeoDataFrame, dp: DataPaths) -> tuple[set[int], str]:
  """Return eligible cell ids for interventions based on real land-use layers.

  If building/canopy layers are available, only cells intersecting those layers are eligible.
  This avoids selecting ocean/open-water cells inside a coarse city bbox.
  """
  layers: list[gpd.GeoDataFrame] = []
  used_keys: list[str] = []
  for key in ("buildings", "canopy"):
    path = dp.get(key)
    if not path or not os.path.exists(path):
      continue
    try:
      gdf = gpd.read_file(path)
    except Exception:
      continue
    if gdf.empty:
      continue
    if gdf.crs is None:
      gdf = gdf.set_crs(grid_feat.crs)
    elif str(gdf.crs) != str(grid_feat.crs):
      gdf = gdf.to_crs(grid_feat.crs)
    layers.append(gdf[["geometry"]])
    used_keys.append(key)

  if not layers:
    return set(), "none"

  union = gpd.GeoDataFrame(
    geometry=gpd.GeoSeries(
      [geom for layer in layers for geom in layer.geometry if geom is not None and not geom.is_empty],
      crs=grid_feat.crs,
    ),
    crs=grid_feat.crs,
  )
  if union.empty:
    return set(), "+".join(used_keys)

  joined = gpd.sjoin(grid_feat[["cell_id", "geometry"]], union, how="inner", predicate="intersects")
  return set(map(int, joined["cell_id"].unique().tolist())), "+".join(used_keys)


def _heat_corridor_nodes(grid_feat: gpd.GeoDataFrame) -> set[int]:
  """Return cell_ids that are flagged as heat-corridor cells, if available."""
  for col in ("heat_corridor", "is_heat_corridor", "heat_corridor_flag"):
    if col not in grid_feat.columns:
      continue

    raw = grid_feat[col].fillna(False)
    if raw.dtype == bool:
      mask = raw
    else:
      as_text = raw.astype(str).str.lower().str.strip()
      mask = as_text.isin(["1", "true", "yes", "y", "t"])

    if "cell_id" not in grid_feat.columns:
      return set()
    return set(map(int, grid_feat.loc[mask, "cell_id"].tolist()))

  return set()


def run(config_path: str) -> str:
  cfg = load_config(config_path)
  run_id = cfg["run"]["run_id"]
  out_dir = os.path.join(cfg["run"]["out_dir"], run_id)
  ensure_dir(out_dir)
  set_seed(int(cfg["run"]["seed"]))

  context = build_run_context(cfg)
  res = context.greedy_result
  selected_interventions, intervention_impact_summary = _build_selected_interventions_with_impact(
    selected=res.selected,
    history=res.history,
    base_graph=context.graph,
    effects=context.effects,
    weights=context.weights,
  )

  save_history_csv(os.path.join(out_dir, "greedy_history.csv"), res.history)
  save_json(os.path.join(out_dir, "selected_interventions.json"), selected_interventions)
  save_json(os.path.join(out_dir, "intervention_impact_summary.json"), intervention_impact_summary)
  eligible_nodes = context.eligible_nodes
  eligible_count = int(len(eligible_nodes)) if eligible_nodes is not None else int(len(context.grid_feat))
  save_json(
    os.path.join(out_dir, "eligibility_summary.json"),
    {
      "source": context.eligibility_source,
      "eligible_cells": eligible_count,
      "total_cells": int(len(context.grid_feat)),
      "constrained": bool(eligible_nodes),
    },
  )

  provenance_manifest = build_provenance_manifest(cfg, config_path)
  save_json(os.path.join(out_dir, "provenance_manifest.json"), provenance_manifest)

  data_quality_report = context.data_quality_report
  save_json(os.path.join(out_dir, "data_quality_report.json"), data_quality_report)

  fairness_audit = build_fairness_audit(
    res.selected,
    np.asarray(context.vulnerability, dtype=float),
    np.asarray(context.temp_mean, dtype=float),
    float(cfg["objective"]["equity"].get("top_quantile", 0.8)),
  )
  save_json(os.path.join(out_dir, "fairness_audit.json"), fairness_audit)

  decision_log = build_decision_log(
    cfg,
    res.selected,
    res.history,
    selected_interventions=selected_interventions,
    intervention_impact_summary=intervention_impact_summary,
  )
  save_json(os.path.join(out_dir, "decision_log.json"), decision_log)

  return out_dir


if __name__ == "__main__":
  import argparse

  ap = argparse.ArgumentParser()
  ap.add_argument("--config", required=True)
  args = ap.parse_args()
  out = run(args.config)
  print(out)
