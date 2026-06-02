# Spectral Urbanism Master Plan (Research-Grade, Utility-First)

## 1. Purpose
Build this repository into a defensible, reproducible, city-scale decision system for equitable urban heat mitigation with:
- strong scientific validity,
- operational utility for city teams,
- plug-and-play onboarding for new cities,
- publication-grade transparency and reproducibility.

This plan is ambitious and outcome-oriented. It cannot guarantee prizes, but it is designed to maximize real-world impact and top-tier research quality.

## 2. Current Repository Baseline (Observed)

### 2.1 Existing strengths
- Clean package structure under spectral_urbanism with modules for city, graph, model, metrics, optimization, experiments, and baselines.
- CLI entrypoint exists: spectral-urbanism run --config <yaml>.
- Config-driven workflow in configs with city, graph, gmrf, interventions, objective, experiments sections.
- End-to-end runnable pipeline producing artifacts:
  - outputs/boston_dev/greedy_history.csv
  - outputs/boston_dev/selected_interventions.json
- Reproducibility intent exists via centralized seed utilities.

### 2.2 High-risk gaps to close
- Core scientific logic still contains placeholders in multiple modules (wind alignment, intervention physics realism, equity joins, reliability sophistication).
- No automated tests found in repository.
- No CI pipeline detected.
- Notebook and output artifacts are minimal and not publication-ready.
- Duplicate pipeline entrypoints exist (pipelines/run_boston.py and spectral_urbanism/pipelines/run_boston.py), increasing drift risk.
- One config file contains invalid YAML-like experimental notation:
  - configs/boston1.yaml includes budget_k: 10,25,50
  - configs/boston1.yaml includes reliability_p_keep: 0.95 + draws(1000 once you have speed)

## 3. Data Program (What data, why, and how)

### 3.1 Core required data layers
- Thermal observations:
  - Landsat Collection 2 Surface Temperature (L2 ST)
- Vegetation and surface properties:
  - Sentinel-2 NDVI
  - Albedo raster
  - Impervious surface raster
- Urban morphology and exposure:
  - Buildings footprints
  - Tree canopy
  - Road and parcel layers where available
- Meteorology:
  - Wind fields, temperature, humidity (NOAA and local station feeds)
- Equity and vulnerability:
  - CDC SVI and local socioeconomic indicators
- Implementation constraints:
  - Municipal feasibility zones, land ownership constraints, historical intervention logs

### 3.2 Data quality controls
- CRS normalization and explicit projection policy (city-specific projected CRS as computational default).
- Time alignment windows and seasonality harmonization.
- Missing-data masks and uncertainty tags per layer.
- Provenance manifest per run:
  - source,
  - acquisition date,
  - preprocessing version,
  - checksum.

### 3.3 Data licensing and citation requirements
- Add a machine-readable data_licenses.md and citations.md in docs.
- For Landsat L2 ST include USGS citation guidance and scaling conversion methods.
- Preserve provenance and traceability to satisfy publication standards for data and code availability.

## 4. Target Product Capabilities

### 4.1 User-facing goals
- One-command onboarding:
  - spectral-urbanism init-city --name <city>
  - spectral-urbanism validate-data --config <file>
  - spectral-urbanism run-benchmark --config <file>
- Intuitive outputs:
  - map layers,
  - ranked interventions,
  - uncertainty bands,
  - equity impact summaries,
  - cost-benefit scenario sheets.
- Generic city portability:
  - plugin adapter pattern for data loaders and policy constraints.

### 4.2 Scientific goals
- Clear mathematical specification for all objective terms.
- Strong uncertainty quantification and sensitivity analyses.
- Robust baseline and ablation suite.
- External validation on multiple cities and temporal holdouts.

## 5. Execution Plan by Phase

## Phase 0 (Week 1): Program Lock
- Define one falsifiable flagship claim.
- Freeze benchmark metrics and acceptance criteria.
- Write protocol document with assumptions and failure conditions.

Deliverables:
- docs/PROTOCOL.md
- docs/METRICS_SPEC.md
- docs/RISK_REGISTER.md

## Phase 1 (Weeks 2-5): Scientific Core Hardening
- Replace placeholder geospatial math with projected-CRS workflows.
- Upgrade graph weight model with explicit physical and urban-form terms.
- Strengthen GMRF inference pipeline with scalable sparse solvers and diagnostics.
- Refactor objective into modular terms with validated units and normalization.
- Upgrade reliability estimation and confidence interval reporting.

Deliverables:
- model specification notebook and docs
- validated objective module with unit tests
- reproducible posterior diagnostics report

## Phase 2 (Weeks 4-7): Data Reliability and Provenance
- Implement ingestion adapters for all required layers.
- Add schema validation for configs and data contracts.
- Add provenance ledger and run manifest export.
- Add data QA report generation command.

Deliverables:
- docs/DATA_CONTRACTS.md
- docs/DATA_PIPELINE.md
- outputs/<run_id>/data_quality_report.json
- outputs/<run_id>/provenance_manifest.json

## Phase 3 (Weeks 6-9): Reproducibility and Engineering Defense
- Add full test stack:
  - unit tests,
  - regression tests,
  - stochastic consistency tests.
- Add CI for lint, type checks, tests, and reproducibility smoke runs.
- Add strict version pinning and environment lock workflow.
- Add experiment tracking and immutable artifact structure.

Deliverables:
- tests/ suite with initial coverage target >= 75%
- CI workflow files
- docs/REPRODUCIBILITY.md

## Phase 4 (Weeks 8-12): User Experience and Plug-and-Play
- Build guided CLI with friendly validation errors and remediation hints.
- Add generic city starter templates and adapter docs.
- Add report generation with policy-facing summaries.
- Add optional lightweight web dashboard for map and scenario exploration.

Deliverables:
- docs/QUICKSTART_CITY_ONBOARDING.md
- docs/USER_GUIDE.md
- docs/OPERATOR_PLAYBOOK.md

## Phase 5 (Weeks 10-14): Benchmark Dominance
- Implement baseline zoo:
  - random,
  - hottest-first,
  - population-priority,
  - intervention-specific heuristics,
  - robust optimization comparator.
- Implement ablations for every objective term and feature family.
- Implement stress tests under failure and uncertainty scenarios.
- Publish leaderboard and model card.

Deliverables:
- docs/BENCHMARK_PROTOCOL.md
- docs/MODEL_CARD.md
- outputs/benchmark_results/*

## Phase 6 (Weeks 14-20): Field Utility and Governance
- Add constraints for municipal implementation realism.
- Add fairness and impact audit pipelines.
- Co-design with stakeholder workflows (planners, public health, utilities).
- Add intervention deployment and maintenance planning hooks.

Deliverables:
- docs/POLICY_IMPLEMENTATION_GUIDE.md
- docs/FAIRNESS_AUDIT.md
- docs/DECISION_LOGGING.md

## Phase 7 (Weeks 18-28): Publication and Public Release
- Prepare methods, systems, and policy-impact manuscripts.
- Archive data and code artifacts with persistent identifiers.
- Launch public replication package and challenge benchmark.

Deliverables:
- paper-ready artifact bundle
- replication kit with one-command rerun
- release notes and citation files

## 6. Workstreams and Ownership Model
- W1 Science Core: graph, gmrf, objective, uncertainty.
- W2 Data Ops: ingestion, quality, provenance.
- W3 Engineering: tests, CI, packaging, performance.
- W4 Product UX: CLI, reports, dashboard.
- W5 Policy/Ethics: fairness, governance, deployment utility.

Each workstream should have:
- one owner,
- one backup,
- weekly acceptance review,
- monthly hard quality gate.

## 7. Acceptance Gates (Hard Requirements)
A release cannot pass unless all conditions are true:
- Deterministic rerun of benchmark outputs from pinned environment.
- All mandatory tests pass and coverage threshold is met.
- Config schema validation passes.
- Data provenance manifests generated.
- Fairness audit and uncertainty report generated.
- Docs and examples compile and execute from clean environment.

## 8. Immediate 14-Day Sprint (Start Now)

### Day 1-2
- Create docs backbone and protocol specs.
- Resolve duplicate pipeline entrypoint strategy.
- Fix invalid configs in configs/boston1.yaml.

### Day 3-5
- Add config schema validation and loader guards.
- Add baseline unit tests for graph/laplacian/objective paths.
- Add first CI workflow.

### Day 6-9
- Implement data provenance manifest writer.
- Improve equity join path and null handling.
- Add run-level QA report skeleton.

### Day 10-14
- Add benchmark command and ablation command.
- Add user guide with city onboarding template.
- Run first reproducibility dry-run and publish sprint report.

## 9. Measurable KPIs
- Scientific:
  - Improvement over baseline on locked objective and fairness metrics.
  - Confidence intervals reported for all headline results.
- Engineering:
  - CI pass rate, mean runtime, deterministic rerun success rate.
- Utility:
  - Time-to-first-city-run under 15 minutes.
  - Number of cities onboarded via template with no code changes.
- Trust:
  - Provenance completeness,
  - Fairness audit completeness,
  - Stakeholder acceptance feedback score.

## 10. Security and Sensitive Data Handling
- Remove and rotate exposed credentials immediately if any were captured in recordings or artifacts.
- Add secret scanning to CI and pre-commit checks.
- Ensure no credentials or live tokens are committed to repository history.

## 11. Priority Backlog (Top 20)
1. Add config schema validation layer.
2. Fix boston1.yaml invalid values.
3. Consolidate pipeline entrypoints.
4. Add unit tests for graph construction.
5. Add unit tests for objective evaluation.
6. Add smoke test for CLI run.
7. Implement provenance manifest writer.
8. Add QA report exporter.
9. Implement city projected-CRS policy.
10. Replace placeholder wind logic.
11. Improve intervention effect model.
12. Add reproducible benchmark runner.
13. Add ablation runner.
14. Add fairness audit outputs.
15. Add CI workflow.
16. Add type checks and lint gates.
17. Add model card template.
18. Add city onboarding template.
19. Add policy-facing report templates.
20. Add release artifact packaging.

## 12. Reference Sources Used in Planning
- Nobel context and impact framing:
  - https://www.nobelprize.org/prizes/facts/nobel-prize-facts/
- Science editorial and reproducibility standards:
  - https://www.science.org/content/page/science-journals-editorial-policies
- IPCC AR6 WG2 Chapter 6 (cities and infrastructure):
  - https://www.ipcc.ch/report/ar6/wg2/chapter/chapter-6/
- EPA heat island intervention resources:
  - https://www.epa.gov/heatislands
- NOAA climate impacts for infrastructure and health context:
  - https://www.noaa.gov/education/resource-collections/climate/climate-change-impacts
- USGS Landsat Collection 2 Surface Temperature data and caveats:
  - https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature

## 13. Next Immediate Deliverable
After this plan, the next file to produce is docs/IMPLEMENTATION_SPRINT_01.md with:
- exact tasks,
- file-level edits,
- test cases,
- acceptance checks,
- expected artifacts,
- owner and ETA.
