from __future__ import annotations

from datetime import datetime, UTC
from typing import Any

from spectral_urbanism.opt.interventions import Intervention


def build_decision_log(
  cfg: dict[str, Any],
  selected: list[Intervention],
  objective_history: list[dict[str, float]],
  selected_interventions: list[dict[str, Any]] | None = None,
  intervention_impact_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
  selection_summary: list[dict[str, Any]]
  if selected_interventions:
    selection_summary = selected_interventions
  else:
    selection_summary = [
      {
        "step": idx + 1,
        "kind": s.kind,
        "target": int(s.target),
        "cost": float(s.cost),
      }
      for idx, s in enumerate(selected)
    ]

  return {
    "generated_at_utc": datetime.now(UTC).isoformat(),
    "run_id": cfg.get("run", {}).get("run_id"),
    "city": cfg.get("city", {}).get("name"),
    "selection_summary": selection_summary,
    "objective_history": objective_history,
    "impact_summary": intervention_impact_summary,
    "rationale": {
      "mechanism": (
        "Each intervention modifies thermal-network edge weights at the target cell. "
        "Greedy selection chooses the candidate with the largest positive marginal composite-score gain at each step."
      ),
      "objective_formula": (
        "score = alpha_lambda2 * lambda2 + beta_reliability * reliability - gamma_equity * equity_exposure"
      ),
      "objective_weights": cfg.get("objective", {}),
      "budget_k": cfg.get("interventions", {}).get("budget_k"),
      "optimization": cfg.get("optimization", {}),
    },
  }
