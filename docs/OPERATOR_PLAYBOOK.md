# Operator Playbook

## Preflight
1. Validate config and plugins.
2. Confirm data path existence and access.
3. Confirm queue/API health if running full stack.

## Runbook
1. Launch run.
2. Inspect generated artifacts for quality/fairness/provenance.
3. Run benchmark and ablation for comparator context.

## Incident Response
- Validation failure: fix schema or plugin contract.
- Missing data: patch data_paths and rerun validate-data.
- Performance issues: reduce grid resolution and Monte Carlo draws for diagnostics.
