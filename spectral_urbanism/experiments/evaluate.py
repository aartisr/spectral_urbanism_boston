from __future__ import annotations

import numpy as np
import networkx as nx
from typing import List, Dict
from dataclasses import dataclass

from spectral_urbanism.opt.interventions import Intervention, apply_intervention
from spectral_urbanism.opt.objective import ObjectiveWeights, evaluate_objective

@dataclass
class Evaluation:
  metrics: Dict[str, float]
  interventions: List[Intervention]

def apply_set(G: nx.Graph, S: List[Intervention], effects: dict) -> nx.Graph:
  H = G
  for s in S:
    H = apply_intervention(H, s, effects)
  return H

def evaluate_set(
  G: nx.Graph,
  S: List[Intervention],
  temp_mean: np.ndarray,
  vulnerability: np.ndarray,
  effects: dict,
  weights: ObjectiveWeights,
  rel_p_keep: float,
  rel_draws: int,
  seed: int = 0,
) -> Evaluation:
  H = apply_set(G, S, effects)
  m = evaluate_objective(H, temp_mean, vulnerability, weights, rel_p_keep, rel_draws, seed)
  return Evaluation(metrics=m, interventions=S)
