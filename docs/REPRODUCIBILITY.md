# Reproducibility

## Baseline Procedure
1. Use pinned environment and same code revision.
2. Run with fixed seed and same config.
3. Compare generated artifacts for deterministic fields.

## Commands
```bash
spectral-urbanism run --config configs/city.yaml
spectral-urbanism run-benchmark --config configs/city.yaml
spectral-urbanism run-ablation --config configs/city.yaml
```

## CI
- Lint + tests in GitHub Actions.
- Compose smoke check for API health.
- Secret scanning job.
