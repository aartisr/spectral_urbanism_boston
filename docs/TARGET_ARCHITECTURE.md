# Target Architecture (Python Core + TanStack Frontend)

## 1. Architecture Decision
Use a hybrid architecture:
- Python remains the scientific compute engine.
- FastAPI becomes the application API and orchestration layer.
- React + TanStack becomes the user-facing application layer.

Rationale:
- Current repository is already strong in Python geospatial/scientific tooling.
- TanStack is ideal for frontend routing, server-state, forms, and data-heavy tables.
- This split preserves scientific velocity and adds product-grade UX.

## 2. Target System Overview

## 2.1 Components
1. Compute Engine (existing package)
- Module root: spectral_urbanism
- Responsibilities: graph build, GMRF inference, metrics, optimization, experiment reports

2. API Service (new)
- Framework: FastAPI + Pydantic
- Responsibilities:
  - validate configs and data contracts
  - launch/track runs
  - expose run artifacts and summaries
  - expose benchmark and ablation endpoints

3. Worker Service (new)
- Framework: Celery (or Dramatiq)
- Broker/Backend: Redis
- Responsibilities:
  - execute long-running runs asynchronously
  - produce artifacts and status updates

4. Metadata Store (new)
- PostgreSQL + optional PostGIS
- Responsibilities:
  - run metadata
  - job states
  - artifact references
  - audit trail

5. Artifact Store
- Local filesystem first under outputs/<run_id>
- Optional upgrade to S3/Azure Blob for scale

6. Web App (new)
- React + TypeScript + Vite
- TanStack Router, Query, Table, Form
- Map layer: MapLibre GL (or deck.gl)

## 2.2 Request/Data Flow
1. User creates/edits config in web app.
2. Web app sends config to API validation endpoint.
3. API stores run metadata and queues job.
4. Worker executes spectral_urbanism pipeline.
5. Worker writes artifacts to outputs and updates run status.
6. Web app polls via TanStack Query and renders maps/tables/charts.

## 3. Proposed Repository Layout

```text
spectral_urbanism_boston/
  docs/
    MASTER_PLAN.md
    TARGET_ARCHITECTURE.md
    IMPLEMENTATION_SPRINT_01.md
  spectral_urbanism/
    ...existing compute modules...
  services/
    api/
      app/
        main.py
        routes/
          health.py
          runs.py
          benchmarks.py
          configs.py
        schemas/
          run.py
          config.py
          artifact.py
        core/
          settings.py
          logging.py
          security.py
        db/
          models.py
          session.py
          migrations/
      pyproject.toml
    worker/
      app/
        worker.py
        tasks/
          run_pipeline.py
          benchmark.py
      pyproject.toml
  web/
    package.json
    src/
      app/
      routes/
      features/
        runs/
        configs/
        benchmarks/
        maps/
      components/
      lib/
  tests/
    unit/
    integration/
    reproducibility/
```

## 4. API Contract (v1)

## 4.1 Health
- GET /api/v1/health
- Response:
  - status
  - version
  - dependencies (db, broker)

## 4.2 Config Validation
- POST /api/v1/configs/validate
- Request:
  - config: JSON/YAML payload
- Response:
  - valid: boolean
  - errors: []
  - warnings: []

## 4.3 Runs
- POST /api/v1/runs
- Request:
  - config
  - run_name
- Response:
  - run_id
  - job_id
  - status

- GET /api/v1/runs/{run_id}
- Response:
  - status
  - progress
  - timestamps
  - key metrics snapshot

- GET /api/v1/runs/{run_id}/artifacts
- Response:
  - artifact list with type/path/size/hash

- GET /api/v1/runs/{run_id}/history
- Response:
  - greedy history records

## 4.4 Benchmarks
- POST /api/v1/benchmarks
- Request:
  - benchmark spec
- Response:
  - benchmark_id
  - job_id

- GET /api/v1/benchmarks/{benchmark_id}
- Response:
  - status
  - aggregate metrics
  - baseline comparisons

## 5. Frontend Information Architecture (TanStack)

## 5.1 Routes
- /
  - Project overview and quick actions
- /runs
  - Run list, status, filters
- /runs/$runId
  - metrics, interventions, artifacts, logs
- /benchmarks
  - benchmark list and launch
- /benchmarks/$benchmarkId
  - leaderboard and ablations
- /configs
  - config editor and validator

## 5.2 TanStack Usage
- Router: typed route params + nested layouts
- Query: caching/polling for runs and benchmarks
- Table: interventions, leaderboard, audit tables
- Form: config creation with schema-driven validation

## 6. Security and Governance Baseline
- Add secret scanning pre-commit + CI.
- Never store credentials in configs or artifacts.
- Add run-level audit events:
  - who launched run,
  - config hash,
  - code version,
  - artifact checksums.
- Add data access controls for sensitive layers.

## 7. Migration Plan (Repo-tailored)

## Stage A: Non-breaking foundation
1. Keep current CLI and pipeline untouched.
2. Add API service that shells into existing run entrypoint.
3. Add run metadata table and minimal run status endpoints.

Exit criteria:
- Existing command still works.
- API can launch and track same run successfully.

## Stage B: Async and reliability
1. Add worker queue for long runs.
2. Add structured logging + retry policies.
3. Add run/audit metadata and artifact indexing.

Exit criteria:
- Concurrent runs supported.
- Failure recovery works for transient errors.

## Stage C: TanStack web app
1. Scaffold web app and route structure.
2. Implement run list, run details, config validation forms.
3. Render greedy history and selected interventions from API.

Exit criteria:
- End-to-end from web UI to completed run.

## Stage D: Benchmarks and policy UX
1. Add benchmark endpoints and frontend pages.
2. Add fairness/uncertainty panels.
3. Add exportable policy report templates.

Exit criteria:
- Decision-ready outputs available in app.

## 8. Versioning and Release Model
- API versioning: /api/v1
- SemVer for services and package.
- Release artifacts:
  - Docker images
  - schema migration scripts
  - reproducibility manifest

## 9. Technology Stack Final Recommendation
- Compute: Python 3.11+, NumPy, SciPy, GeoPandas, Rasterio, NetworkX
- API: FastAPI, Pydantic, SQLAlchemy, Alembic
- Worker: Celery + Redis
- DB: PostgreSQL (+ PostGIS optional)
- Frontend: React, TypeScript, TanStack Router/Query/Table/Form, MapLibre
- Testing: Pytest, Vitest, Playwright
- DevOps: Docker Compose (first), GitHub Actions

## 10. Immediate Next Build Order
1. Create services/api skeleton.
2. Add /health and /runs endpoints.
3. Add async worker task for current run pipeline.
4. Scaffold web app with TanStack Router + Query.
5. Connect run list and run detail views.
