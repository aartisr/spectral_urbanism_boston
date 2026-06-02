from __future__ import annotations

import numpy as np
from scipy.sparse import csr_matrix, diags
from scipy.sparse.linalg import splu
from dataclasses import dataclass

@dataclass
class GMRFPosterior:
  mean: np.ndarray
  # For large graphs, store factorization handle rather than full covariance
  Q: csr_matrix

def fit_gmrf(Q: csr_matrix, y: np.ndarray, obs_idx: np.ndarray, obs_noise: float) -> GMRFPosterior:
  """Fit a basic GMRF with Gaussian likelihood on observed nodes.

  Posterior precision: Q_post = Q + (1/σ^2) * I_obs
  Posterior mean: μ = Q_post^{-1} * (1/σ^2) * y_obs
  """
  n = Q.shape[0]
  w = np.zeros(n, dtype=float)
  w[obs_idx] = 1.0 / max(obs_noise, 1e-9)**2
  Iobs = diags(w)
  Q_post = Q + Iobs

  b = np.zeros(n, dtype=float)
  b[obs_idx] = w[obs_idx] * y

  # Sparse solve for mean
  # For very large graphs, consider iterative solvers with preconditioners
  mu = splu(Q_post.tocsc()).solve(b)
  return GMRFPosterior(mean=mu, Q=Q_post.tocsr())

def sample_posterior(posterior: GMRFPosterior, draws: int, seed: int = 0) -> np.ndarray:
  """Draw samples using a simple (and not fastest) approach.

  For publication-grade scale: use sparse Cholesky sampling or iterative methods.
  """
  rng = np.random.default_rng(seed)
  n = posterior.Q.shape[0]
  # White noise
  z = rng.normal(size=(draws, n))
  # Solve Q x = z^T  => x = Q^{-1} z^T
  lu = splu(posterior.Q.tocsc())
  samples = np.vstack([lu.solve(z[i]) for i in range(draws)])
  return samples
