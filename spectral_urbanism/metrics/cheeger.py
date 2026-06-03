from __future__ import annotations

from dataclasses import dataclass

import networkx as nx
import numpy as np
from scipy.sparse.linalg import eigsh

from spectral_urbanism.graph.laplacian import normalized_laplacian


@dataclass(frozen=True)
class CheegerResult:
  """Result of a Fiedler-vector sweep cut over the weighted thermal graph."""

  conductance: float
  left: set[int]
  right: set[int]
  boundary_nodes: set[int]
  fiedler_by_node: dict[int, float]
  rank_by_node: dict[int, int]


def cheeger_sweep(G: nx.Graph, weight: str = "weight") -> CheegerResult:
  """Compute a weighted Cheeger cut proxy using a normalized-Laplacian sweep.

  The graph edge weights are interpreted as thermal conductance. Lower sweep
  conductance means the cut separates two subregions with weak thermal coupling.
  Boundary nodes are the cells incident to the minimizing cut and are the best
  candidates for bottleneck mitigation diagnostics.
  """
  nodes = [int(n) for n in G.nodes()]
  if len(nodes) == 0:
    return CheegerResult(0.0, set(), set(), set(), {}, {})
  if len(nodes) == 1 or G.number_of_edges() == 0:
    node_set = set(nodes)
    return CheegerResult(0.0, node_set, set(), node_set, {nodes[0]: 0.0}, {nodes[0]: 0})

  L = normalized_laplacian(G)
  k = 2 if L.shape[0] > 2 else 1
  if k == 1:
    fiedler = np.arange(len(nodes), dtype=float)
  else:
    vals, vecs = eigsh(L, k=k, which="SM")
    order_eigs = np.argsort(vals)
    fiedler = np.asarray(vecs[:, order_eigs[1]], dtype=float)

  order = [nodes[i] for i in np.argsort(fiedler)]
  volume_total = sum(float(d) for _, d in G.degree(weight=weight))
  if volume_total <= 0:
    node_set = set(nodes)
    return CheegerResult(0.0, node_set, set(), node_set, dict(zip(nodes, fiedler)), {n: i for i, n in enumerate(order)})

  in_left: set[int] = set()
  best_phi = float("inf")
  best_left: set[int] = set()

  for idx, node in enumerate(order[:-1]):
    in_left.add(node)
    left_vol = sum(float(G.degree(n, weight=weight)) for n in in_left)
    right_vol = max(volume_total - left_vol, 0.0)
    denom = min(left_vol, right_vol)
    if denom <= 1e-12:
      continue

    cut_weight = 0.0
    for u in in_left:
      for v, attrs in G[u].items():
        if int(v) not in in_left:
          cut_weight += float(attrs.get(weight, 1.0))
    phi = cut_weight / denom
    if phi < best_phi:
      best_phi = float(phi)
      best_left = set(in_left)

  if not best_left:
    half = max(1, len(order) // 2)
    best_left = set(order[:half])
    best_phi = 0.0

  left = set(map(int, best_left))
  right = set(nodes) - left
  boundary = boundary_nodes_from_cut(G, left, right)
  return CheegerResult(
    conductance=float(best_phi),
    left=left,
    right=right,
    boundary_nodes=boundary,
    fiedler_by_node={int(node): float(fiedler[i]) for i, node in enumerate(nodes)},
    rank_by_node={int(node): int(i) for i, node in enumerate(order)},
  )


def boundary_nodes_from_cut(G: nx.Graph, left: set[int], right: set[int]) -> set[int]:
  """Return nodes incident to at least one edge crossing a two-way cut."""
  boundary: set[int] = set()
  for u, v in G.edges():
    iu = int(u)
    iv = int(v)
    if (iu in left and iv in right) or (iu in right and iv in left):
      boundary.add(iu)
      boundary.add(iv)
  return boundary


def cheeger_cut_placeholder(L) -> np.ndarray:
  """Backward-compatible Fiedler ordering helper for older callers."""
  vals, vecs = eigsh(L, k=2, which="SM")
  fiedler = vecs[:, np.argsort(vals)[1]]
  return np.argsort(fiedler)
