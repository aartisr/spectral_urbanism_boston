# Spectral Urbanism — Plug-and-Play City Optimization

Owner: Aarti S Ravikumar.

This repository is a **reproducible pipeline** to:

1) ingest city geospatial + thermal data,
2) build a stochastic **thermal network graph**,
3) infer temperature fields (GMRF),
4) compute spectral + resilience metrics,
5) optimize equitable interventions with certificates,
6) run comparative baselines and export figures/tables.

## Quickstart

### Fastest Full-Stack Start

Docker is the most reproducible path because it installs Python, API, worker,
web, and Redis dependencies inside containers:

```bash
cp .env.example .env
make compose-up
```

Open:

- Web: `http://localhost:5173`
- API health: `http://localhost:8000/api/v1/health`

### Local Full-Stack Start

For fast iteration without Docker, use the local dev script. It creates `.venv`
when needed, installs editable Python packages, installs web packages when
needed, clears stale Vite optimized chunks, starts API in inline mode, starts
the web app, and waits for both health checks.

```bash
cp .env.example .env
make local-dev
```

Useful diagnostics:

```bash
make doctor
make local-stop
```

To match Docker's Redis/Celery execution model locally:

```bash
DEV_WITH_WORKER=1 make local-dev
```

That mode requires a local `redis-server`.

### Library/CLI Only

```bash
# 1) Create environment
python -m venv .venv
source .venv/bin/activate

# 2) Install
pip install -U pip
pip install -e .

# 3) Create config
cp configs/city.template.yaml configs/city.yaml

# 4) Run end-to-end pipeline (stubs are runnable; fill TODOs)
spectral-urbanism run --config configs/city.yaml

# 5) Optional lifecycle commands
spectral-urbanism validate-data --config configs/city.yaml
spectral-urbanism run-benchmark --config configs/city.yaml
spectral-urbanism run-ablation --config configs/city.yaml
```

### Developer Workflow (repo root)

```bash
# Run generic city pipeline
make run-city CONFIG=configs/city.yaml

# Check local readiness
make doctor
```

### Non-Docker local start (recommended for fast iteration)

```bash
cp .env.example .env

# Starts API in inline mode + web
make local-dev

# Optional: starts API + worker + web (requires Redis)
make local-dev-worker

# Stop local services started by the commands above
make local-stop
```

Common local commands:

```bash
make run-api
make run-worker
make run-web
make test
```

### Runtime tuning (dev)

For faster local iterations, tune these keys in [configs/city.yaml](configs/city.yaml):

- `city.grid_resolution_m`
- `interventions.budget_k`
- `interventions.types`
- `experiments.monte_carlo_draws`
- `experiments.reliability_p_keep`
- `optimization.eval_top_k`
- `optimization.stop_if_nonpositive_gain`

### Plug-and-Play Extension Model

You can onboard a new city with config-only changes:

- `city`: bbox, CRS, and resolution
- `data_paths`: arbitrary dataset keys (no fixed schema required)
- `features.plugins`: ordered plugin pipeline for feature engineering
- `features.rasters`: map feature names to `data_paths` keys or explicit raster paths
- `features.defaults`: fallback values if a feature is missing
- `interventions.types` + `interventions.effects`: add new intervention kinds without code edits

Default feature plugins:

- `raster_features`
- `defaults`
- `equity_placeholder`

External plugin support (package entry points):

- Entry point group: `spectral_urbanism.feature_plugins`
- Config controls:
  - `features.auto_discover_plugins: true|false`
  - `features.plugin_entrypoint_group: "spectral_urbanism.feature_plugins"`
  - `features.plugin_contract_version: "1.0"`
  - `features.required_capabilities: [...]`
- You can also reference a plugin directly in config by import path:
  - `my_package.my_module:my_plugin`

Minimal external plugin package example:

```toml
[project.entry-points."spectral_urbanism.feature_plugins"]
my_custom_features = "my_city_plugins.features:my_custom_features"
```

```python
def my_custom_features(grid, cfg, data_paths):
  out = grid.copy()
  out["custom_signal"] = 1.0
  return out
```

## Project layout

- `spectral_urbanism/` — library code
- `pipelines/` — orchestration entrypoints
- `scripts/` — convenience CLI wrappers
- `configs/` — YAML configs (data paths, parameters)
- `notebooks/` — exploration + figure drafts
- `outputs/` — generated artifacts (ignored by git)

## What you will implement next (high impact)

- **Data download adapters** for: Landsat LST, Sentinel-2 NDVI, OSM extracts, building footprints, canopy layers, NOAA wind.
- **Weight model**: w_ij = f(albedo, NDVI, wind alignment, imperviousness, distance)
- **Interventions**: tree, cool roof, reflective pavement, shade corridor
- **Empirical study**: baselines + ablations + confidence intervals

## Reproducibility checklist (reviewer-friendly)

- All experiments are driven by config files in `configs/`
- Random seeds are centralized in `spectral_urbanism/utils/seed.py`
- All outputs are written under `outputs/<run_id>/`
- Operational artifacts now include:
  - `data_quality_report.json`
  - `provenance_manifest.json`
  - `fairness_audit.json`
  - `decision_log.json`
  - `intervention_impact_summary.json`
  - `benchmark_results/benchmark_summary.json`
  - `benchmark_results/ablation_summary.json`

## Backward Compatibility

- Existing `configs/boston*.yaml` files continue to run.
- Legacy `run_boston` entrypoints are preserved as wrappers to the generic city pipeline.

## New Full-Stack Skeleton (API + Worker + Web)

The repository now includes a Sprint 01 scaffolding for:

- API service: `services/api/` (FastAPI)
- Worker service: `services/worker/` (Celery)
- Web app: `web/` (React + TanStack)

### Run the API

```bash
source .venv/bin/activate
pip install -e .
pip install -e services/api
uvicorn app.main:app --app-dir services/api --reload --port 8000
```

### Run the Worker

```bash
source .venv/bin/activate
pip install -e .
pip install -e services/worker
celery -A app.worker.celery_app worker --workdir services/worker -Q runs --loglevel=INFO
```

### Run the Web App

```bash
cd web
npm install
npm run dev
```

By default, the web app calls `http://localhost:8000/api/v1`.

### Start Full Stack with Docker Compose

```bash
docker compose up --build
```

For custom ports or API base, copy and edit `.env` from `.env.example`.

Services:

- API: `http://localhost:8000`
- Web: `http://localhost:5173`
- Redis: `localhost:6379`

Key API endpoints:

- `GET /api/v1/health`
- `POST /api/v1/configs/validate`
- `POST /api/v1/runs`
- `GET /api/v1/runs?status=&q=&limit=&offset=`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/artifacts`

Config validation behavior:

- `POST /api/v1/configs/validate` performs strict schema validation.
- Unknown top-level keys and invalid value types are rejected.
- Plugin health checks run before enqueue and include:
  - plugin existence/loadability
  - contract version compatibility
  - capability coverage (`features.required_capabilities`)
  - required-column coverage declared by plugin contracts
- Validation response includes `plugin_health` metadata per plugin.

Multi-column sorting:

- `GET /api/v1/runs?sort_by=status,run_name&sort_dir=asc,desc`

Execution profile toggles:

- `APP_ENV=production` forces queue-only execution (no inline fallback)
- `RUN_EXECUTION_MODE=celery|inline` controls non-production mode
- `ALLOW_INLINE_FALLBACK=true|false` controls fallback behavior outside production

### Script Targets (Copy/Paste)

```bash
# target: install-core
python -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e .

# target: install-services
pip install -e services/api
pip install -e services/worker

# target: run-api
uvicorn app.main:app --app-dir services/api --reload --port 8000

# target: run-worker
celery -A app.worker.celery_app worker --workdir services/worker -Q runs --loglevel=INFO

# target: run-web
cd web && npm install && npm run dev

# target: run-compose
docker compose up --build
```

## Planning Docs

- `docs/MASTER_PLAN.md`
- `docs/TARGET_ARCHITECTURE.md`
- `docs/IMPLEMENTATION_SPRINT_01.md`

## License

MIT (adjust if needed).
