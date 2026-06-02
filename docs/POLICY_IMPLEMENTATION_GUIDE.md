# Policy Implementation Guide

## Deployment Context
Use outputs as decision support, not automatic policy execution.

## Recommended Workflow
1. Run scenarios and compare benchmark outputs.
2. Review fairness and data quality reports.
3. Document assumptions and approvals in decision logs.

## Governance Hooks
- `fairness_audit.json`
- `decision_log.json`
- `provenance_manifest.json`
