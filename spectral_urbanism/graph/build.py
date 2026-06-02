from __future__ import annotations

import numpy as np
import networkx as nx
import geopandas as gpd
from typing import Dict


def _centroids_xy(gdf: gpd.GeoDataFrame) -> np.ndarray:
  """Return centroid coordinates in a projected CRS when possible.

  Using a metric CRS removes geographic-centroid warnings and yields more
  meaningful distance-based edges/weights.
  """
  src = gdf
  if src.crs is not None and src.crs.is_geographic:
    try:
      utm = src.estimate_utm_crs()
      if utm is not None:
        src = src.to_crs(utm)
    except Exception:
      # Fall back to original CRS when UTM estimation is unavailable.
      pass

  cent = src.geometry.centroid
  return np.column_stack([cent.x.to_numpy(), cent.y.to_numpy()])

def _neighbors_adjacency(grid: gpd.GeoDataFrame) -> list[tuple[int, int]]:
  # Efficient adjacency is non-trivial; this naive method is a placeholder.
  # For production, use spatial index (rtree/pygeos) or raster adjacency.
  sindex = grid.sindex
  edges = []
  for i, geom in zip(grid["cell_id"].values, grid.geometry):
    hits = list(sindex.intersection(geom.bounds))
    for j in hits:
      if i == grid.iloc[j]["cell_id"]:
        continue
      if geom.touches(grid.iloc[j].geometry):
        a, b = int(i), int(grid.iloc[j]["cell_id"])
        if a < b:
          edges.append((a, b))
  return edges

def _wind_aligned_edges(grid: gpd.GeoDataFrame, wind_k: int = 2) -> list[tuple[int, int]]:
  # Placeholder: add k nearest neighbors by centroid distance (no wind yet)
  cent = _centroids_xy(grid)
  edges = []
  for idx, a in enumerate(grid["cell_id"].values):
    d = np.sum((cent - cent[idx])**2, axis=1)
    nn = np.argsort(d)[1:1+wind_k]
    for j in nn:
      b = int(grid.iloc[j]["cell_id"])
      if a < b:
        edges.append((int(a), b))
  return edges

def weight_edges(grid_features: gpd.GeoDataFrame, edges: list[tuple[int, int]], params: dict) -> Dict[tuple[int,int], float]:
  """Compute conductance weights w_ij using feature model.

  w_ij = a1*albedo + a2*ndvi + a3*wind - a4*impervious - a5*distance

  NOTE: wind alignment is not implemented in this starter; set wind feature externally later.
  """
  a_alb = params.get("alpha_albedo", 1.0)
  a_ndvi = params.get("alpha_ndvi", 1.0)
  a_wind = params.get("alpha_wind", 0.0)
  a_imp = params.get("alpha_impervious", 1.0)
  a_dist = params.get("alpha_distance", 0.2)

  # expected feature columns
  alb = grid_features.get("albedo")
  ndvi = grid_features.get("ndvi")
  imp = grid_features.get("impervious")
  wind = grid_features.get("wind", 0.0)

  cent = _centroids_xy(grid_features)
  cell_ids = grid_features["cell_id"].to_numpy(dtype=int)
  row_of_cell = {cid: i for i, cid in enumerate(cell_ids)}

  alb_arr = grid_features["albedo"].to_numpy(dtype=float) if alb is not None else None
  ndvi_arr = grid_features["ndvi"].to_numpy(dtype=float) if ndvi is not None else None
  imp_arr = grid_features["impervious"].to_numpy(dtype=float) if imp is not None else None

  weights = {}
  for a, b in edges:
    ia = int(a)
    ib = int(b)
    ra = row_of_cell[ia]
    rb = row_of_cell[ib]

    da = cent[ra]
    db = cent[rb]
    dist = float(np.sqrt(np.sum((da-db)**2)))
    val = 0.0
    if alb_arr is not None:
      val += a_alb * float(alb_arr[ra] + alb_arr[rb]) / 2.0
    if ndvi_arr is not None:
      val += a_ndvi * float(ndvi_arr[ra] + ndvi_arr[rb]) / 2.0
    if imp_arr is not None:
      val -= a_imp * float(imp_arr[ra] + imp_arr[rb]) / 2.0
    # wind placeholder
    if isinstance(wind, (int, float)):
      val += a_wind * float(wind)
    val -= a_dist * dist

    # ensure positive conductance
    weights[(ia, ib)] = max(1e-6, val)
  return weights

def build_graph(grid_features: gpd.GeoDataFrame, edge_mode: str, wind_k: int, weight_params: dict) -> nx.Graph:
  if edge_mode not in {"adjacency", "adjacency_plus_wind"}:
    raise ValueError(f"Unsupported edge_mode={edge_mode}")
  edges = _neighbors_adjacency(grid_features)
  if edge_mode == "adjacency_plus_wind":
    edges = list(set(edges + _wind_aligned_edges(grid_features, wind_k=wind_k)))

  w = weight_edges(grid_features, edges, weight_params)
  G = nx.Graph()
  for cid in grid_features["cell_id"].values:
    G.add_node(int(cid))
  for (a,b), wij in w.items():
    G.add_edge(int(a), int(b), weight=float(wij))
  return G
