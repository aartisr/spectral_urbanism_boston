# User Guide

## Primary Commands
- `run`: full optimization run.
- `init-city`: generate a city config from template.
- `validate-data`: schema + plugin + data path readiness checks.
- `run-benchmark`: run baseline strategy comparisons.
- `run-ablation`: run objective-term ablations.

## Where Outputs Go
All outputs are written under `outputs/<run_id>/`.

## Troubleshooting
- Contract mismatch: align `features.plugin_contract_version`.
- Capability missing: add plugins providing required capabilities.
- Missing data files: inspect `validate-data` warnings.
