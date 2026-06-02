# Metrics Specification

## Primary Objective
Composite score:
- + spectral connectivity term (`lambda2`)
- + reliability term (Monte Carlo all-terminal reliability)
- - equity exposure term

## Reported Metrics
- `score`
- `lambda2`
- `reliability`
- `equity`

## Fairness Metrics
- high_vulnerability_share_selected
- mean_vulnerability_selected vs mean_vulnerability_overall
- mean_heat_selected vs mean_heat_overall

## Data Quality Metrics
- required column presence
- missing rate per required feature column
- basic descriptive stats (min/max/mean)

## Validation Rules
- All required sections pass schema validation.
- Plugin contract version equals configured expected version.
- Required plugin capabilities must be satisfied.
