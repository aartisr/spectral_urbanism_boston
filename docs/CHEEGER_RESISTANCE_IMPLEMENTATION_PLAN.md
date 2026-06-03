# Cheeger Bottleneck Priority and Cooling Sink Resistance Implementation Plan

## Purpose

This report explains how to implement the Cheeger Cut Bottleneck Priority and Cooling Sink Resistance Proxy workflow from `spectral-urbanism` inside `spectral_urbanism_boston`.

The short answer: **yes, it is possible**, and `spectral_urbanism_boston` is the better long-term home for the feature because it already has:

- a config-driven pipeline,
- a reusable Python package,
- a FastAPI service,
- a worker execution path,
- run artifacts,
- a React/MapLibre map,
- street/address workflows,
- intervention cost/effect models,
- intervention impact reporting.

The Streamlit app has the new diagnostic ideas. The Boston app has the stronger operational architecture. The goal should be to port the **math, run artifacts, and map layers**, not the Streamlit UI.

## Current Difference Between the Repositories

| Capability | `spectral-urbanism` | `spectral_urbanism_boston` |
| --- | --- | --- |
| Application shape | Streamlit demo app | Production-style package + API + worker + React UI |
| Graph nodes | Raster pixels | City grid cells |
| Graph weights | LST gradient + NDVI conductance | Configurable feature model using albedo, NDVI, imperviousness, wind placeholder, distance |
| Spectral gap | Implemented | Implemented |
| Cheeger cut | Implemented as cut-boundary corridor priority | Placeholder Fiedler ordering only |
| Cooling sink resistance | Implemented via graph distance to inferred sinks | Not implemented |
| Intervention model | Simple conductance boost near bottleneck/sinks | Greedy optimizer with intervention types, costs, effects, objective history |
| Reliability | Sink-connectivity proxy | All-terminal Monte Carlo reliability |
| Map output | Streamlit Folium layers, GeoTIFF, GeoJSON | API `/runs/{run_id}/map`, React MapLibre layers |
| Address lookup | Streamlit + OpenStreetMap/Nominatim | React app already has address/street-level workflow |

## Current Intervention Logic in `spectral_urbanism_boston`

The Boston app already has an intervention system:

- `spectral_urbanism/opt/interventions.py`
- `spectral_urbanism/opt/greedy.py`
- `spectral_urbanism/opt/objective.py`
- `spectral_urbanism/pipelines/run_city.py`
- `services/api/app/routes/runs.py`
- `web/src/routes/map.tsx`
- `web/src/routes/map-utils.ts`

The pipeline builds candidate interventions from configured intervention types and costs. The greedy optimizer evaluates candidate interventions against a composite objective:

```text
score = alpha_lambda2 * lambda2
      + beta_reliability * reliability
      - gamma_equity * equity_exposure
```

Each selected intervention is written to:

```text
selected_interventions.json
intervention_impact_summary.json
decision_log.json
```

The web map uses selected intervention cells and street-level action planning to show intervention recommendations.

### What Is Missing

The Boston app does not yet compute:

- a true Cheeger sweep cut,
- a Cheeger cut-boundary corridor,
- Cheeger priority intensity,
- inferred cooling sinks,
- cooling-sink graph distance,
- low cooling access zones,
- address-level sampling of Cheeger/resistance values.

## Target Feature Set

Implement the following outputs per run:

```text
cheeger_bottleneck.geojson
low_cooling_access_zones.geojson
cooling_access_cells.geojson       optional
cheeger_resistance_summary.json
```

Add these properties to the run map grid GeoJSON:

```text
cheeger_boundary: boolean
cheeger_priority: number           0-100
cheeger_priority_class: string     Watch | Medium | High
cooling_access: number             0-100, higher is easier access
low_cooling_access: boolean
cooling_sink: boolean
```

Add map layers:

- **Cheeger Bottleneck Priority**
- **Low Cooling Access Zones**
- optional **Cooling Access Surface / Cell Fill**

Add address/street-level behavior:

- after address lookup, sample nearby grid cell properties,
- report Cheeger priority,
- report cooling access,
- report heat intensity,
- report NDVI/vegetation signal,
- return mitigation guidance.

## Mathematical Design

### 1. Cheeger Sweep

`spectral_urbanism_boston` currently has:

```python
spectral_urbanism/metrics/cheeger.py
```

with a placeholder:

```python
def cheeger_cut_placeholder(L):
    vals, vecs = eigsh(L, k=2, which="SM")
    fiedler = vecs[:, 1]
    order = np.argsort(fiedler)
    return order
```

Replace or extend this with a true sweep conductance implementation.

Recommended API:

```python
@dataclass(frozen=True)
class CheegerResult:
    lambda2: float
    conductance: float
    selected_set: set[int]
    boundary_nodes: set[int]
    fiedler: dict[int, float]

def cheeger_sweep(G: nx.Graph, weight: str = "weight") -> CheegerResult:
    ...
```

Algorithm:

1. Build normalized Laplacian.
2. Compute Fiedler vector.
3. Sort nodes by Fiedler value.
4. Sweep prefixes of the ordering.
5. Compute conductance:

```text
phi(S) = cut(S, V-S) / min(vol(S), vol(V-S))
```

6. Keep the set with minimum conductance.
7. Convert the set into boundary nodes:

```python
boundary_nodes = {
    u or v for each edge (u, v)
    where one endpoint is in S and the other is outside S
}
```

### 2. Cheeger Bottleneck Priority

The Streamlit implementation uses:

```text
priority = 0.65 * heat_intensity + 0.35 * poor_cooling_access
```

where:

```text
poor_cooling_access = 1 - cooling_access
```

For Boston, this should be computed on grid cells:

```python
cheeger_priority = 0
if cell_id in boundary_nodes:
    cheeger_priority = 100 * (0.65 * normalized_heat + 0.35 * (1 - cooling_access_01))
```

Recommended priority class:

```python
High   >= 70
Medium >= 40
Watch  < 40
```

### 3. Cooling Sinks

Cooling sinks should be inferred from grid cells. Good defaults:

1. high NDVI cells, if `ndvi` exists;
2. otherwise low posterior temperature cells;
3. optionally water/canopy/open-space layers if configured.

Recommended function:

```python
def infer_cooling_sinks(
    grid_feat: gpd.GeoDataFrame,
    ndvi_col: str = "ndvi",
    temp_col: str = "observed_temp",
    quantile: float = 0.95,
) -> set[int]:
    ...
```

Default logic:

```text
if ndvi exists:
    sinks = cells with ndvi >= 95th percentile
else:
    sinks = cells with observed_temp <= 5th percentile
```

### 4. Cooling Sink Resistance Proxy

For each node, compute weighted shortest-path cost to the nearest cooling sink.

Edge cost should be inverse conductance:

```python
cost = edge_length_or_1 / max(weight, 1e-9)
```

Then:

```python
distance_to_sink = dijkstra_distance_to_super_sink
cooling_access = normalize(-distance_to_sink) * 100
```

Interpretation:

- higher `cooling_access` means easier access to cooling sinks;
- lower `cooling_access` means harder access.

### 5. Low Cooling Access Zones

The Streamlit implementation uses a vector layer from low cooling access cells.

In Boston, this can be simpler because the graph cells already have geometries. No raster-to-vector conversion is needed.

Recommended:

```python
low_cooling_access = cooling_access <= 35
access_class = "Very Low" if cooling_access <= 20 else "Low"
```

Then write a GeoJSON containing those cells.

## Files to Change

### Python Package

#### `spectral_urbanism/metrics/cheeger.py`

Add:

- `CheegerResult`
- `cheeger_sweep`
- `boundary_nodes_from_cut`
- conductance helper

#### New file: `spectral_urbanism/metrics/cooling_access.py`

Add:

- `infer_cooling_sinks`
- `cooling_access_to_sinks`
- `normalize_access`
- `classify_access`

#### New file: `spectral_urbanism/experiments/spatial_artifacts.py`

Add artifact-writing helpers:

- `attach_cheeger_and_resistance_columns`
- `write_cheeger_geojson`
- `write_low_cooling_access_geojson`
- `write_cheeger_resistance_summary`

#### `spectral_urbanism/pipelines/run_city.py`

After graph construction and GMRF fitting, compute:

```python
cheeger_result = cheeger_sweep(context.graph)
sinks = infer_cooling_sinks(context.grid_feat, ...)
cooling_access = cooling_access_to_sinks(context.graph, sinks)
```

Attach these values to `grid_feat` or `grid`:

```python
grid_feat["cooling_sink"] = ...
grid_feat["cooling_access"] = ...
grid_feat["low_cooling_access"] = ...
grid_feat["cheeger_boundary"] = ...
grid_feat["cheeger_priority"] = ...
grid_feat["cheeger_priority_class"] = ...
```

Write artifacts to `out_dir`:

```python
save_json(out_dir / "cheeger_resistance_summary.json", ...)
grid_feat[grid_feat.cheeger_boundary].to_file(out_dir / "cheeger_bottleneck.geojson", driver="GeoJSON")
grid_feat[grid_feat.low_cooling_access].to_file(out_dir / "low_cooling_access_zones.geojson", driver="GeoJSON")
```

Also consider replacing:

```python
corridor_nodes = _heat_corridor_nodes(grid_feat)
```

with:

```python
corridor_nodes = _heat_corridor_nodes(grid_feat) | cheeger_result.boundary_nodes
```

or add a config flag:

```yaml
optimization:
  use_cheeger_corridor_preference: true
  corridor_preference_weight: 0.02
```

This makes the optimizer prefer interventions in Cheeger bottlenecks.

### API

#### `services/api/app/routes/runs.py`

In `/runs/{run_id}/map`, load the new artifacts if present:

```python
cheeger_path = out_dir / "cheeger_bottleneck.geojson"
low_access_path = out_dir / "low_cooling_access_zones.geojson"
summary_path = out_dir / "cheeger_resistance_summary.json"
```

Return:

```json
{
  "cheeger_bottleneck_geojson": {...},
  "low_cooling_access_geojson": {...},
  "cheeger_resistance_summary": {...}
}
```

Also add grid properties to the existing `geojson` if they are not already present.

### React Web

#### `web/src/lib/api.ts`

Extend the run-map response type:

```ts
cheeger_bottleneck_geojson?: GeoJSON.FeatureCollection;
low_cooling_access_geojson?: GeoJSON.FeatureCollection;
cheeger_resistance_summary?: Record<string, unknown>;
```

#### `web/src/routes/map.tsx`

Add sources/layers:

```ts
cheeger-bottleneck-source
cheeger-bottleneck-fill
cheeger-bottleneck-outline
low-cooling-access-source
low-cooling-access-fill
low-cooling-access-outline
```

Suggested styles:

Cheeger:

- `High`: orange/yellow
- `Medium`: red
- `Watch`: purple

Low cooling access:

- `Very Low`: red
- `Low`: orange

Add controls:

- toggle Cheeger Bottleneck Priority
- toggle Low Cooling Access Zones

#### Address Lookup / Street Selection

When an address or street segment is selected, inspect properties:

```ts
cheeger_priority
cooling_access
observed_temp
ndvi
low_cooling_access
cheeger_boundary
```

Then produce guidance:

- high Cheeger + low access: strongest corridor intervention;
- high Cheeger + good access: protect/reinforce existing cooling path;
- low Cheeger + low access: local shade/green intervention;
- good access: maintain/protect.

## Data Contract

### `cheeger_resistance_summary.json`

Recommended shape:

```json
{
  "lambda2": 0.0123,
  "conductance": 0.21,
  "cheeger_boundary_cells": 42,
  "cooling_sink_cells": 18,
  "low_cooling_access_cells": 76,
  "priority_formula": "100 * (0.65 * normalized_heat + 0.35 * poor_cooling_access)",
  "cooling_sink_rule": "ndvi >= p95 if ndvi exists, else observed_temp <= p05",
  "access_thresholds": {
    "very_low": 20,
    "low": 35
  }
}
```

### Grid GeoJSON Properties

Each grid feature should include:

```json
{
  "cell_id": 123,
  "observed_temp": 34.2,
  "ndvi": 0.48,
  "cheeger_boundary": true,
  "cheeger_priority": 78.4,
  "cheeger_priority_class": "High",
  "cooling_access": 22.7,
  "low_cooling_access": true,
  "cooling_sink": false
}
```

## Implementation Order

### Phase 1: Backend Metrics

1. Implement real Cheeger sweep.
2. Implement cooling sink inference.
3. Implement cooling access Dijkstra proxy.
4. Unit test on small graphs.

### Phase 2: Pipeline Artifacts

1. Attach properties to `grid_feat`.
2. Write Cheeger GeoJSON.
3. Write low-cooling-access GeoJSON.
4. Write summary JSON.
5. Add pipeline artifact tests.

### Phase 3: API Contract

1. Return new artifact GeoJSONs from `/runs/{run_id}/map`.
2. Include new grid properties.
3. Add integration tests.

### Phase 4: Web Map

1. Add toggle controls.
2. Add MapLibre vector layers.
3. Add tooltip/popup descriptions.
4. Add address/street-level interpretation panel.

### Phase 5: Optimizer Integration

1. Add config flag for Cheeger corridor preference.
2. Use Cheeger boundary nodes as preferred corridor nodes.
3. Evaluate whether selected interventions shift toward bottleneck corridors.
4. Update decision log explanations.

## Testing Plan

### Unit Tests

Add tests for:

- path graph Cheeger cut,
- two-cluster graph bottleneck,
- sink inference from NDVI,
- sink inference fallback from temperature,
- Dijkstra cooling access monotonicity,
- priority classification.

### Integration Tests

Run a small Boston config and assert:

```text
cheeger_bottleneck.geojson exists
low_cooling_access_zones.geojson exists
cheeger_resistance_summary.json exists
grid GeoJSON includes cheeger_priority and cooling_access
```

### Visual QA

Check:

- Cheeger layer is stable across zoom levels.
- Low Cooling Access Zones render as vector polygons.
- Address lookup shows sampled values.
- Selected interventions still render above diagnostic layers.

## Risks and Caveats

1. **Cheeger is a graph cut, not a parcel boundary.**
   The vector boxes are grid cells, not exact street assets.

2. **Cooling access is a proxy.**
   It is based on graph conductance and inferred sinks, not a full CFD or urban canopy model.

3. **Sink definition matters.**
   NDVI-derived sinks are reasonable, but water, canopy, parks, and shade datasets can improve them.

4. **Optimizer objective may need tuning.**
   If Cheeger preference is too strong, interventions may over-concentrate on one corridor.

5. **API payload size may grow.**
   Separate GeoJSON artifacts may be better than embedding everything in the main grid if the grid is large.

## Recommendation

Implement this feature in `spectral_urbanism_boston` as a first-class diagnostic layer and optimizer input.

Recommended final architecture:

- Cheeger/resistance metrics in `spectral_urbanism/metrics`.
- Artifact writing in `spectral_urbanism/experiments`.
- Pipeline integration in `spectral_urbanism/pipelines/run_city.py`.
- API exposure through `/runs/{run_id}/map`.
- MapLibre vector layers in `web/src/routes/map.tsx`.
- Address/street-level interpretation in the existing street selection panel.

This preserves the Boston app's production architecture while bringing over the strongest interpretability improvements from the Streamlit prototype.
