# Protocol

## Flagship Claim
Given identical budget and candidate space, spectral optimization improves composite score over random and hottest baselines while maintaining equity constraints.

## Hypotheses
1. Composite score improvement over random baseline is positive.
2. Equity audit metrics do not degrade below configured threshold.
3. Results are reproducible under fixed seed and pinned environment.

## Experimental Controls
- Fixed config per run.
- Fixed random seed.
- Same intervention budget across comparators.
- Same graph and feature inputs.

## Failure Conditions
- Schema validation failure.
- Plugin contract mismatch.
- Missing required capabilities.
- Reproducibility mismatch on repeated run with same seed.

## Outputs
- greedy_history.csv
- selected_interventions.json
- data_quality_report.json
- provenance_manifest.json
- fairness_audit.json
- decision_log.json
- benchmark_results/benchmark_summary.json
- benchmark_results/ablation_summary.json
