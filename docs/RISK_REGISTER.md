# Risk Register

## High Risks
1. Placeholder feature/equity assumptions produce optimistic results.
2. Data gaps reduce city portability.
3. Plugin contract drift breaks run-time compatibility.
4. Stochastic variability can mask regressions.
5. Secret leakage through recordings/configs.

## Mitigations
- Strict config schema and plugin contract checks.
- Data validation command and quality report artifacts.
- Benchmark and ablation outputs for comparator context.
- CI tests and reproducibility checks.
- Secret scanning in CI + pre-commit.
