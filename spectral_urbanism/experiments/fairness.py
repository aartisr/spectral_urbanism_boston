from __future__ import annotations

from typing import Any

import numpy as np

from spectral_urbanism.opt.interventions import Intervention


def build_fairness_audit(
  selected: list[Intervention],
  vulnerability: np.ndarray,
  temp_mean: np.ndarray,
  high_vulnerability_quantile: float,
) -> dict[str, Any]:
  if len(vulnerability) == 0:
    return {
      "selected_count": len(selected),
      "high_vulnerability_share_selected": 0.0,
      "mean_vulnerability_selected": 0.0,
      "mean_heat_selected": 0.0,
      "notes": ["Empty vulnerability vector"],
    }

  threshold = float(np.quantile(vulnerability, high_vulnerability_quantile))
  selected_targets = [int(s.target) for s in selected]

  selected_vulnerability = np.array([vulnerability[t] for t in selected_targets], dtype=float) if selected_targets else np.array([])
  selected_heat = np.array([temp_mean[t] for t in selected_targets], dtype=float) if selected_targets else np.array([])

  high_count = int(np.sum(selected_vulnerability >= threshold)) if selected_vulnerability.size else 0
  selected_count = max(1, len(selected_targets))

  return {
    "selected_count": len(selected_targets),
    "high_vulnerability_threshold": threshold,
    "high_vulnerability_share_selected": float(high_count / selected_count),
    "mean_vulnerability_selected": float(np.mean(selected_vulnerability)) if selected_vulnerability.size else 0.0,
    "mean_vulnerability_overall": float(np.mean(vulnerability)),
    "mean_heat_selected": float(np.mean(selected_heat)) if selected_heat.size else 0.0,
    "mean_heat_overall": float(np.mean(temp_mean)) if len(temp_mean) else 0.0,
  }
