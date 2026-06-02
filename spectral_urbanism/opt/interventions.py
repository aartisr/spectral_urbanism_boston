from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable, Mapping

import networkx as nx

EffectSpec = Mapping[str, object]
EffectRegistry = Mapping[str, EffectSpec]
CostRegistry = Mapping[str, float]

@dataclass(frozen=True)
class Intervention:
  kind: str
  target: int
  cost: float


def intervention_weight_multiplier(kind: str, effects: dict) -> float:
  eff = effects.get(kind, {})

  if "edge_weight_multiplier" in eff:
    return max(1e-6, float(eff["edge_weight_multiplier"]))

  if "multiplier" in eff:
    return max(1e-6, float(eff["multiplier"]))

  if "edge_weight_delta" in eff:
    return max(1e-6, 1.0 + float(eff["edge_weight_delta"]))

  # Backward-compatible default: aggregate numeric effect deltas.
  numeric_vals = [float(v) for v in eff.values() if isinstance(v, (int, float))]
  if numeric_vals:
    return max(1e-6, 1.0 + float(sum(numeric_vals)))
  return 1.0

def apply_intervention(
  G: nx.Graph,
  intervention: Intervention,
  effects: EffectRegistry,
) -> nx.Graph:
  """Apply a simple intervention by locally adjusting incident edge weights.

  This is an intentionally simple model to start; refine with calibrated physics/empirics.
  """
  H = G.copy()
  multiplier = intervention_weight_multiplier(intervention.kind, effects)

  for _, _, d in list(H.edges(intervention.target, data=True)):
    d["weight"] = max(1e-6, float(d.get("weight", 1.0)) * multiplier)
  return H

def candidate_interventions(
  nodes: Iterable[int],
  kinds: Iterable[str],
  costs: CostRegistry,
) -> list[Intervention]:
  return [
    Intervention(kind=str(kind), target=int(node), cost=float(costs.get(str(kind), 1.0)))
    for node in nodes
    for kind in kinds
  ]
