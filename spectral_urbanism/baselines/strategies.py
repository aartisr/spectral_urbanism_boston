from __future__ import annotations

import numpy as np
from typing import List
from spectral_urbanism.opt.interventions import Intervention

def baseline_random(cands: List[Intervention], k: int, seed: int = 0) -> List[Intervention]:
  rng = np.random.default_rng(seed)
  idx = rng.choice(len(cands), size=min(k, len(cands)), replace=False)
  return [cands[i] for i in idx]

def baseline_hottest(nodes: np.ndarray, temps: np.ndarray, kinds: List[str], costs: dict, k: int) -> List[Intervention]:
  order = np.argsort(-temps)
  out = []
  for i in order[:k]:
    out.append(Intervention(kind=kinds[0], target=int(nodes[i]), cost=float(costs.get(kinds[0], 1.0))))
  return out

def baseline_population(nodes: np.ndarray, pop: np.ndarray, kinds: List[str], costs: dict, k: int) -> List[Intervention]:
  order = np.argsort(-pop)
  out = []
  for i in order[:k]:
    out.append(Intervention(kind=kinds[0], target=int(nodes[i]), cost=float(costs.get(kinds[0], 1.0))))
  return out
