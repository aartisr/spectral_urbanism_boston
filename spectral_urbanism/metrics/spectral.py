from __future__ import annotations
import numpy as np
from scipy.linalg import eigh
from scipy.sparse import csr_matrix, issparse
from scipy.sparse.linalg import eigsh

def lambda2(L: csr_matrix, k: int = 3) -> float:
  """Compute λ2 of normalized Laplacian with small-graph fallback."""
  n = int(L.shape[0])
  if n < 2:
    return 0.0

  # ARPACK requires k < N; use dense eigendecomposition for tiny graphs.
  k_eff = max(2, int(k))
  if k_eff >= n:
    dense = L.toarray() if issparse(L) else np.asarray(L)
    vals = np.sort(np.real(eigh(dense, eigvals_only=True)))
    return float(vals[1])

  vals, _ = eigsh(L, k=k_eff, which="SM")
  vals = np.sort(np.real(vals))
  return float(vals[1])

def mixing_time_upper_bound(l2: float, eps: float = 0.25) -> float:
  """Loose bound; refine for journal text."""
  l2 = max(l2, 1e-12)
  return float(np.log(1/eps)/l2)
