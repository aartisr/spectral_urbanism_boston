# Implementation Sprint 01 (2 Weeks)

## Sprint Goal
Deliver the first production slice:
- API can validate config and launch runs.
- Worker can execute the current pipeline asynchronously.
- TanStack web app can submit a run and view status/results.
- CI quality gates are active.

## Scope
In scope:
- service scaffolding (api, worker, web)
- run tracking and artifact indexing
- basic frontend routes and tables
- tests and CI baseline

Out of scope:
- full benchmark suite
- full policy report UX
- advanced geospatial map interactions

## Work Items

## A. API Foundation
1. Scaffold FastAPI service under services/api.
2. Implement endpoints:
- GET /api/v1/health
- POST /api/v1/configs/validate
- POST /api/v1/runs
- GET /api/v1/runs/{run_id}
- GET /api/v1/runs/{run_id}/artifacts
3. Add Pydantic schemas for config and run objects.
4. Add basic SQLAlchemy models for runs and artifacts.

Acceptance checks:
- OpenAPI docs available.
- Validation endpoint returns schema errors for malformed config.
- Run create endpoint returns run_id and queued status.

## B. Worker Integration
1. Scaffold worker service under services/worker.
2. Add queue task run_pipeline(config_path_or_payload).
3. Reuse existing spectral_urbanism.pipelines.run_boston.run.
4. Persist status transitions:
- queued -> running -> succeeded/failed
5. Index generated artifacts in metadata store.

Acceptance checks:
- Worker executes run and updates status.
- Artifact list endpoint returns expected files.

## C. Frontend (TanStack)
1. Scaffold web app under web with:
- React + TypeScript + Vite
- TanStack Router
- TanStack Query
- TanStack Table
- TanStack Form
2. Routes:
- /
- /runs
- /runs/$runId
- /configs
3. Features:
- Config form with validate action
- Run launch action
- Run status polling
- Results tables for history/interventions

Acceptance checks:
- User can submit config, launch run, and observe final status.
- Run details show history rows and selected interventions.

## D. Quality and DevEx
1. Add Python tests for new API and worker boundaries.
2. Add frontend tests for critical flow (launch and poll run).
3. Add CI workflow:
- lint
- type checks
- tests
4. Add .env.example for services.

Acceptance checks:
- CI passes on fresh clone.
- Local compose boot works with one command.

## File-Level Changes (Planned)
- New files/directories:
  - services/api/**
  - services/worker/**
  - web/**
  - .github/workflows/ci.yml
  - docs/API_CONTRACT_V1.md
- Existing files to update:
  - pyproject.toml (if shared tooling additions are required)
  - README.md (new local run instructions)

## Test Plan

## Python
- unit: config schema validation, run state transitions
- integration: API + worker + pipeline happy path
- failure tests: malformed config, missing data paths

## Frontend
- unit: form validation, query hooks
- e2e: submit config -> launch run -> view run results

## Runbook (Developer)
1. Start infra (db + redis).
2. Start API.
3. Start worker.
4. Start web app.
5. Launch test run from /configs.

## Definition of Done
- End-to-end flow works from web UI to completed run.
- API and worker are documented and tested.
- CI is green.
- README includes local setup and troubleshooting.

## Risks and Mitigations
1. Long-running jobs blocking API
- Mitigation: strict async queue boundary and polling.

2. Config incompatibility between old CLI and API
- Mitigation: single shared config schema and validation layer.

3. Artifact format drift
- Mitigation: explicit artifact contract and response schema.

## Owners and ETA Template
- API Owner: TBD
- Worker Owner: TBD
- Web Owner: TBD
- QA Owner: TBD
- Sprint Duration: 10 working days

## End-of-Sprint Deliverables
- Running MVP stack (api + worker + web)
- First CI pipeline
- Developer setup docs
- Demo: create run and inspect outputs from browser
