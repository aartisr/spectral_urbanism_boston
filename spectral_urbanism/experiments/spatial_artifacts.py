from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import geopandas as gpd
import networkx as nx
import numpy as np

from spectral_urbanism.metrics.cheeger import cheeger_sweep
from spectral_urbanism.metrics.cooling_access import (
  cooling_access_to_sinks,
  infer_cooling_sinks,
  robust_unit_scale,
)


DIAGNOSTIC_COLUMNS = [
  "cheeger_side",
  "cheeger_boundary",
  "cheeger_fiedler",
  "cheeger_rank",
  "cheeger_priority",
  "cheeger_priority_class",
  "cooling_sink",
  "cooling_access_score",
  "cooling_sink_resistance_proxy",
  "cooling_access_class",
  "low_cooling_access",
  "street_intervention_signal",
]


def attach_cheeger_resistance_columns(
  grid_feat: gpd.GeoDataFrame,
  G: nx.Graph,
  *,
  temp_values: np.ndarray | None = None,
  temp_col: str = "observed_temp",
  ndvi_col: str = "ndvi",
  access_low_threshold: float = 35.0,
  access_very_low_threshold: float = 20.0,
  sink_ndvi_quantile: float = 0.75,
  sink_temp_quantile: float = 0.25,
) -> tuple[gpd.GeoDataFrame, dict[str, Any]]:
  """Attach generic Cheeger bottleneck and cooling-resistance diagnostics."""
  out = grid_feat.copy()
  if "cell_id" not in out.columns:
    out["cell_id"] = np.arange(len(out), dtype=int)

  cheeger = cheeger_sweep(G)
  sinks = infer_cooling_sinks(
    out,
    temp_values=temp_values,
    temp_col=temp_col,
    ndvi_col=ndvi_col,
    ndvi_quantile=sink_ndvi_quantile,
    temp_quantile=sink_temp_quantile,
  )
  access_by_node = cooling_access_to_sinks(G, sinks)

  if temp_values is not None and len(temp_values) == len(out):
    heat_values = np.asarray(temp_values, dtype=float)
  elif temp_col in out.columns:
    heat_values = np.asarray(out[temp_col].values, dtype=float)
  else:
    heat_values = np.zeros(len(out), dtype=float)
  heat_unit = robust_unit_scale(heat_values)

  cell_ids = out["cell_id"].astype(int)
  out["cheeger_side"] = cell_ids.map(lambda cid: "left" if int(cid) in cheeger.left else "right")
  out["cheeger_boundary"] = cell_ids.map(lambda cid: bool(int(cid) in cheeger.boundary_nodes))
  out["cheeger_fiedler"] = cell_ids.map(lambda cid: float(cheeger.fiedler_by_node.get(int(cid), 0.0)))
  out["cheeger_rank"] = cell_ids.map(lambda cid: int(cheeger.rank_by_node.get(int(cid), -1)))
  out["cooling_sink"] = cell_ids.map(lambda cid: bool(int(cid) in sinks))
  out["cooling_access_score"] = cell_ids.map(lambda cid: float(access_by_node.get(int(cid), 0.0)))
  out["cooling_sink_resistance_proxy"] = out["cooling_access_score"].map(lambda score: float(100.0 - float(score)))

  poor_access_unit = np.clip(1.0 - np.asarray(out["cooling_access_score"].values, dtype=float) / 100.0, 0.0, 1.0)
  priority = 100.0 * (0.65 * heat_unit + 0.35 * poor_access_unit)
  out["cheeger_priority"] = np.where(out["cheeger_boundary"].values.astype(bool), priority, 0.0)
  out["cheeger_priority_class"] = out["cheeger_priority"].map(_priority_class)
  out["cooling_access_class"] = out["cooling_access_score"].map(
    lambda score: _access_class(float(score), access_low_threshold, access_very_low_threshold)
  )
  out["low_cooling_access"] = out["cooling_access_score"].map(lambda score: bool(float(score) <= access_low_threshold))
  out["street_intervention_signal"] = np.maximum(
    np.asarray(out["cheeger_priority"].values, dtype=float),
    np.asarray(out["cooling_sink_resistance_proxy"].values, dtype=float),
  )

  summary = {
    "enabled": True,
    "method": "cheeger_fiedler_sweep_plus_cooling_sink_resistance",
    "cheeger_conductance": float(cheeger.conductance),
    "cheeger_boundary_cells": int(out["cheeger_boundary"].sum()),
    "cooling_sink_cells": int(out["cooling_sink"].sum()),
    "low_cooling_access_cells": int(out["low_cooling_access"].sum()),
    "access_low_threshold": float(access_low_threshold),
    "access_very_low_threshold": float(access_very_low_threshold),
    "priority_definition": "boundary_cells_only: 100 * (0.65 * heat_percentile + 0.35 * poor_cooling_access)",
    "resistance_definition": "100 - cooling_access_score; high values mean poor graph access to inferred cooling sinks",
  }
  return out, summary


def write_spatial_diagnostic_artifacts(
  out_dir: str | Path,
  grid_diag: gpd.GeoDataFrame,
  summary: dict[str, Any],
) -> dict[str, str]:
  """Persist diagnostic vector layers for API and map clients."""
  out_path = Path(out_dir)
  out_path.mkdir(parents=True, exist_ok=True)

  all_path = out_path / "cooling_access_cells.geojson"
  cheeger_path = out_path / "cheeger_bottleneck.geojson"
  access_path = out_path / "low_cooling_access_zones.geojson"
  summary_path = out_path / "cheeger_resistance_summary.json"

  _write_geojson(grid_diag[["cell_id", *[c for c in DIAGNOSTIC_COLUMNS if c in grid_diag.columns], "geometry"]], all_path)
  _write_geojson(grid_diag.loc[grid_diag["cheeger_boundary"].astype(bool)], cheeger_path)
  _write_geojson(grid_diag.loc[grid_diag["low_cooling_access"].astype(bool)], access_path)
  summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")

  return {
    "cooling_access_cells": str(all_path),
    "cheeger_bottleneck": str(cheeger_path),
    "low_cooling_access_zones": str(access_path),
    "cheeger_resistance_summary": str(summary_path),
  }


def _write_geojson(gdf: gpd.GeoDataFrame, path: Path) -> None:
  cols = [c for c in gdf.columns if c == "geometry" or _is_geojson_safe_column(gdf[c])]
  safe = gdf[cols].copy()
  safe.to_file(path, driver="GeoJSON")


def _is_geojson_safe_column(series) -> bool:
  return str(series.dtype) != "object" or series.map(lambda v: isinstance(v, (str, int, float, bool)) or v is None).all()


def _priority_class(value: float) -> str:
  v = float(value)
  if v >= 70:
    return "critical"
  if v >= 45:
    return "high"
  if v > 0:
    return "moderate"
  return "not_boundary"


def _access_class(score: float, low_threshold: float, very_low_threshold: float) -> str:
  if score <= very_low_threshold:
    return "very_low"
  if score <= low_threshold:
    return "low"
  if score < 65:
    return "moderate"
  return "good"
