# Decision Logging

## Artifact
`outputs/<run_id>/decision_log.json`

## Captured Fields
- run_id, city, generation timestamp
- selected interventions by step
- per-step intervention impact attribution:
	- score delta
	- lambda2, reliability, and equity_exposure deltas
	- weighted component contributions and recomposition residual
	- score-per-cost efficiency and share of total gain
- per-step plain-language explanation of mechanism and observed modeled benefit
- objective history across greedy steps
- rationale snapshot (weights, budget, optimization settings)

## Related Artifacts
- `selected_interventions.json`: intervention-level impact details + explanations
- `intervention_impact_summary.json`: baseline/final objective metrics and net improvement

## Usage
Store this artifact with run outputs for auditability and post-hoc review.
