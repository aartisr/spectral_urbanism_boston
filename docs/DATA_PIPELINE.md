# Data Pipeline

## Flow
1. Validate config schema.
2. Validate plugin plan and capabilities.
3. Build grid.
4. Apply feature plugins.
5. Build graph and infer posterior.
6. Optimize interventions.
7. Emit artifacts (quality, provenance, fairness, decision, optimization outputs).

## Quality Outputs
- outputs/<run_id>/data_quality_report.json
- outputs/<run_id>/provenance_manifest.json

## Operational Validation
Use:
```bash
spectral-urbanism validate-data --config configs/city.yaml
```
