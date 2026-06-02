from __future__ import annotations

import os
from typing import Any

import numpy as np

from spectral_urbanism.baselines.strategies import baseline_hottest, baseline_population, baseline_random
from spectral_urbanism.experiments.evaluate import evaluate_set
from spectral_urbanism.experiments.report import save_json
from spectral_urbanism.opt.objective import ObjectiveWeights
from spectral_urbanism.pipelines.run_city import build_run_context, load_config
from spectral_urbanism.utils.io import ensure_dir


def _evaluate_strategy(
  name: str,
  interventions,
  *,
  context: dict[str, Any],
  weights: ObjectiveWeights,
  cfg: dict[str, Any],
) -> dict[str, Any]:
  ev = evaluate_set(
    context["graph"],
    interventions,
    context["temp_mean"],
    context["vulnerability"],
    context["effects"],
    weights,
    rel_p_keep=float(cfg.get("experiments", {}).get("reliability_p_keep", 0.95)),
    rel_draws=int(cfg.get("experiments", {}).get("monte_carlo_draws", 200)),
    seed=int(cfg["run"]["seed"]),
  )
  return {
    "strategy": name,
    **ev.metrics,
    "selected": [x.__dict__ for x in interventions],
  }


def run_benchmark(config_path: str) -> str:
  cfg = load_config(config_path)
  run_id = cfg["run"]["run_id"]
  out_dir = os.path.join(cfg["run"]["out_dir"], run_id)
  ensure_dir(out_dir)

  context = build_run_context(cfg)

  kinds = cfg["interventions"]["types"]
  costs = cfg["interventions"]["costs"]
  budget_k = int(cfg["interventions"]["budget_k"])
  nodes = np.array(list(context["graph"].nodes()), dtype=int)

  temp = np.array(context["temp_mean"], dtype=float)
  vulnerability = np.array(context["vulnerability"], dtype=float)

  weights = ObjectiveWeights(
    alpha_lambda2=float(cfg["objective"]["alpha_lambda2"]),
    beta_reliability=float(cfg["objective"]["beta_reliability"]),
    gamma_equity=float(cfg["objective"]["gamma_equity"]),
  )

  cands = context["candidates"]

  strategies = {
    "random": baseline_random(cands, budget_k, seed=int(cfg["run"]["seed"])),
    "hottest": baseline_hottest(nodes, temp, kinds, costs, budget_k),
    "population": baseline_population(nodes, vulnerability, kinds, costs, budget_k),
  }

  results = [
    _evaluate_strategy(name, interventions, context=context, weights=weights, cfg=cfg)
    for name, interventions in strategies.items()
  ]

  results = sorted(results, key=lambda x: float(x["score"]), reverse=True)

  bench_dir = os.path.join(out_dir, "benchmark_results")
  ensure_dir(bench_dir)
  save_json(os.path.join(bench_dir, "benchmark_summary.json"), {"results": results})
  return bench_dir


def run_ablations(config_path: str) -> str:
  cfg = load_config(config_path)
  run_id = cfg["run"]["run_id"]
  out_dir = os.path.join(cfg["run"]["out_dir"], run_id)
  ensure_dir(out_dir)

  context = build_run_context(cfg)

  base_weights = ObjectiveWeights(
    alpha_lambda2=float(cfg["objective"]["alpha_lambda2"]),
    beta_reliability=float(cfg["objective"]["beta_reliability"]),
    gamma_equity=float(cfg["objective"]["gamma_equity"]),
  )

  ablation_specs = {
    "baseline": base_weights,
    "no_equity": ObjectiveWeights(base_weights.alpha_lambda2, base_weights.beta_reliability, 0.0),
    "no_reliability": ObjectiveWeights(base_weights.alpha_lambda2, 0.0, base_weights.gamma_equity),
    "no_spectral": ObjectiveWeights(0.0, base_weights.beta_reliability, base_weights.gamma_equity),
  }

  selected = context["greedy_result"].selected
  output = {}
  for name, weights in ablation_specs.items():
    ev = evaluate_set(
      context["graph"],
      selected,
      context["temp_mean"],
      context["vulnerability"],
      context["effects"],
      weights,
      rel_p_keep=float(cfg.get("experiments", {}).get("reliability_p_keep", 0.95)),
      rel_draws=int(cfg.get("experiments", {}).get("monte_carlo_draws", 200)),
      seed=int(cfg["run"]["seed"]),
    )
    output[name] = ev.metrics

  bench_dir = os.path.join(out_dir, "benchmark_results")
  ensure_dir(bench_dir)
  save_json(os.path.join(bench_dir, "ablation_summary.json"), output)
  return bench_dir
