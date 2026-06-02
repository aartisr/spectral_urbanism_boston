from __future__ import annotations

import numpy as np
import networkx as nx
from dataclasses import dataclass
from typing import Callable, Dict, Tuple
from scipy.sparse import csr_matrix

from spectral_urbanism.graph.laplacian import normalized_laplacian
from spectral_urbanism.metrics.spectral import lambda2
from spectral_urbanism.metrics.reliability import all_terminal_reliability_monte_carlo

@dataclass
class ObjectiveWeights:
  alpha_lambda2: float
  beta_reliability: float
  gamma_equity: float

def equity_exposure(temp_mean: np.ndarray, vulnerability: np.ndarray) -> float:
  vulnerability = np.nan_to_num(vulnerability, nan=0.0)
  return float(np.sum(vulnerability * temp_mean))

def evaluate_objective(
  G: nx.Graph,
  temp_mean: np.ndarray,
  vulnerability: np.ndarray,
  w: ObjectiveWeights,
  rel_p_keep: float = 0.95,
  rel_draws: int = 200,
  seed: int = 0,
) -> Dict[str, float]:
  L = normalized_laplacian(G)
  l2 = lambda2(L)
  rel = all_terminal_reliability_monte_carlo(G, p_edge_keep=rel_p_keep, draws=rel_draws, seed=seed)
  eq = equity_exposure(temp_mean, vulnerability)
  score = w.alpha_lambda2 * l2 + w.beta_reliability * rel - w.gamma_equity * eq
  return {"score": float(score), "lambda2": float(l2), "reliability": float(rel), "equity": float(eq)}
