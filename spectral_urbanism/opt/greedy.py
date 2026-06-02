from __future__ import annotations

from dataclasses import dataclass
from math import inf

import networkx as nx
import numpy as np

from spectral_urbanism.opt.interventions import Intervention, apply_intervention, intervention_weight_multiplier
from spectral_urbanism.opt.objective import ObjectiveWeights, evaluate_objective

@dataclass
class GreedyResult:
  selected: list[Intervention]
  history: list[dict[str, float]]


def _candidate_priority(G: nx.Graph, cand: Intervention, effects: dict) -> float:
  """Cheap proxy for expected impact used to shortlist candidates."""
  multiplier = intervention_weight_multiplier(cand.kind, effects)

  degree_strength = 0.0
  for _, _, d in G.edges(cand.target, data=True):
    degree_strength += float(d.get("weight", 1.0))

  return (multiplier - 1.0) * degree_strength / max(cand.cost, 1e-9)

def greedy_select(
  G: nx.Graph,
  candidates: list[Intervention],
  temp_mean: np.ndarray,
  vulnerability: np.ndarray,
  effects: dict,
  weights: ObjectiveWeights,
  budget_k: int,
  corridor_nodes: set[int] | None = None,
  corridor_preference_weight: float = 0.0,
  rel_p_keep: float = 0.95,
  rel_draws: int = 200,
  seed: int = 0,
  eval_top_k: int | None = None,
  stop_if_nonpositive_gain: bool = True,
) -> GreedyResult:
  selected: list[Intervention] = []
  history: list[dict[str, float]] = []

  base = evaluate_objective(G, temp_mean, vulnerability, weights, rel_p_keep, rel_draws, seed)
  history.append({"step": 0, **base})

  H = G
  remaining = candidates.copy()
  corridor_nodes = corridor_nodes or set()
  for step in range(1, budget_k + 1):
    best = None
    best_metrics = None
    best_gain = -inf
    best_raw_gain = -inf
    best_corridor_bonus = 0.0

    eval_pool = remaining
    if eval_top_k is not None and eval_top_k > 0 and len(remaining) > eval_top_k:
      scored = sorted(
        remaining,
        key=lambda c: _candidate_priority(H, c, effects),
        reverse=True,
      )
      eval_pool = scored[:eval_top_k]

    for cand in eval_pool:
      Hcand = apply_intervention(H, cand, effects)
      m = evaluate_objective(Hcand, temp_mean, vulnerability, weights, rel_p_keep, rel_draws, seed + step)
      raw_gain = m["score"] - history[-1]["score"]
      corridor_bonus = 0.0
      if corridor_preference_weight != 0.0:
        corridor_bonus = corridor_preference_weight if int(cand.target) in corridor_nodes else -corridor_preference_weight
      gain = raw_gain + corridor_bonus

      if gain > best_gain:
        best_gain = gain
        best_raw_gain = raw_gain
        best_corridor_bonus = corridor_bonus
        best = cand
        best_metrics = m

    if best is None:
      break
    if stop_if_nonpositive_gain and best_gain <= 0:
      break
    assert best_metrics is not None

    selected.append(best)
    H = apply_intervention(H, best, effects)
    history.append(
      {
        "step": step,
        "gain": float(best_gain),
        "raw_gain": float(best_raw_gain),
        "corridor_bonus": float(best_corridor_bonus),
        "is_corridor_target": bool(int(best.target) in corridor_nodes),
        **best_metrics,
      }
    )
    remaining = [c for c in remaining if c != best]

  return GreedyResult(selected=selected, history=history)
