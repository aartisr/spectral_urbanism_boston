from __future__ import annotations

import numpy as np
import networkx as nx
from typing import Callable

def all_terminal_reliability_monte_carlo(G: nx.Graph, p_edge_keep: float, draws: int, seed: int = 0) -> float:
  """Monte Carlo estimator for all-terminal reliability (connectedness under iid edge failures).

  NOTE: This is not the Karger FPRAS yet; it's a usable baseline estimator.
  """
  rng = np.random.default_rng(seed)
  edges = list(G.edges())
  m = len(edges)
  if m == 0:
    return 0.0

  success = 0
  for _ in range(draws):
    keep = rng.random(m) < p_edge_keep
    H = nx.Graph()
    H.add_nodes_from(G.nodes())
    for (e, k) in zip(edges, keep):
      if k:
        u, v = e
        H.add_edge(u, v)
    if nx.is_connected(H):
      success += 1
  return success / draws

def percolation_scan(G: nx.Graph, ps: np.ndarray, draws: int, seed: int = 0) -> dict:
  """Scan bond percolation probabilities and compute giant component fraction."""
  rng = np.random.default_rng(seed)
  edges = list(G.edges())
  m = len(edges)
  out = {}
  for p in ps:
    fracs = []
    for t in range(draws):
      keep = rng.random(m) < p
      H = nx.Graph()
      H.add_nodes_from(G.nodes())
      for (e, k) in zip(edges, keep):
        if k:
          H.add_edge(*e)
      comps = list(nx.connected_components(H))
      largest = max((len(c) for c in comps), default=0)
      fracs.append(largest / max(1, H.number_of_nodes()))
    out[float(p)] = float(np.mean(fracs))
  return out
