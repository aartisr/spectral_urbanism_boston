from __future__ import annotations

import numpy as np
import networkx as nx
from scipy.sparse import csr_matrix, diags
from typing import Tuple, Dict

def normalized_laplacian(G: nx.Graph) -> csr_matrix:
  """Return normalized Laplacian L = I - D^{-1/2} W D^{-1/2}."""
  nodes = list(G.nodes())
  idx = {n:i for i,n in enumerate(nodes)}
  rows, cols, data = [], [], []
  deg = np.zeros(len(nodes), dtype=float)

  for u, v, attr in G.edges(data=True):
    w = float(attr.get("weight", 1.0))
    i, j = idx[u], idx[v]
    rows += [i, j]
    cols += [j, i]
    data += [w, w]
    deg[i] += w
    deg[j] += w

  W = csr_matrix((data, (rows, cols)), shape=(len(nodes), len(nodes)))
  d_inv_sqrt = 1.0 / np.sqrt(np.maximum(deg, 1e-12))
  D_inv_sqrt = diags(d_inv_sqrt)
  I = diags(np.ones(len(nodes)))
  L = I - D_inv_sqrt @ W @ D_inv_sqrt
  return L
