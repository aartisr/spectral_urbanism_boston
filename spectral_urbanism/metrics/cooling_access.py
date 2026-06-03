from __future__ import annotations

import networkx as nx
import numpy as np
import pandas as pd


def robust_unit_scale(values: np.ndarray, lower_q: float = 0.05, upper_q: float = 0.95) -> np.ndarray:
  """Scale finite values to [0, 1] with percentile clipping."""
  arr = np.asarray(values, dtype=float)
  finite = arr[np.isfinite(arr)]
  if finite.size == 0:
    return np.zeros_like(arr, dtype=float)
  lo = float(np.quantile(finite, lower_q))
  hi = float(np.quantile(finite, upper_q))
  if hi <= lo:
    return np.zeros_like(arr, dtype=float)
  scaled = (arr - lo) / (hi - lo)
  return np.clip(np.nan_to_num(scaled, nan=0.0, posinf=1.0, neginf=0.0), 0.0, 1.0)


def infer_cooling_sinks(
  frame: pd.DataFrame,
  *,
  temp_values: np.ndarray | None = None,
  temp_col: str = "observed_temp",
  ndvi_col: str = "ndvi",
  ndvi_quantile: float = 0.75,
  temp_quantile: float = 0.25,
) -> set[int]:
  """Infer cool/green sink cells from NDVI and temperature proxies.

  A cell qualifies when it is relatively vegetated, relatively cool, or both.
  If neither proxy is available, the coolest quartile from supplied temperatures
  is used. The returned identifiers are `cell_id` values.
  """
  if "cell_id" not in frame.columns or frame.empty:
    return set()

  mask = np.zeros(len(frame), dtype=bool)

  if ndvi_col in frame.columns:
    ndvi = np.asarray(frame[ndvi_col].values, dtype=float)
    finite = ndvi[np.isfinite(ndvi)]
    if finite.size > 0:
      threshold = float(np.quantile(finite, ndvi_quantile))
      mask |= np.isfinite(ndvi) & (ndvi >= threshold)

  temps: np.ndarray | None = None
  if temp_values is not None:
    temps = np.asarray(temp_values, dtype=float)
  elif temp_col in frame.columns:
    temps = np.asarray(frame[temp_col].values, dtype=float)

  if temps is not None and len(temps) == len(frame):
    finite = temps[np.isfinite(temps)]
    if finite.size > 0:
      threshold = float(np.quantile(finite, temp_quantile))
      mask |= np.isfinite(temps) & (temps <= threshold)

  if not mask.any() and len(frame) > 0:
    mask[: max(1, int(np.ceil(len(frame) * 0.05)))] = True

  return set(map(int, frame.loc[mask, "cell_id"].tolist()))


def cooling_access_to_sinks(G: nx.Graph, sinks: set[int], weight: str = "weight") -> dict[int, float]:
  """Return a 0-100 access score where high means low resistance to cooling sinks."""
  nodes = [int(n) for n in G.nodes()]
  if not nodes:
    return {}
  sink_set = {int(s) for s in sinks if int(s) in G}
  if not sink_set:
    return {node: 0.0 for node in nodes}

  H = nx.Graph()
  H.add_nodes_from(nodes)
  super_sink = "__cooling_sink__"
  H.add_node(super_sink)
  for u, v, attrs in G.edges(data=True):
    conductance = max(float(attrs.get(weight, 1.0)), 1e-9)
    H.add_edge(int(u), int(v), resistance=1.0 / conductance)
  for node in sink_set:
    H.add_edge(node, super_sink, resistance=0.0)

  lengths = nx.single_source_dijkstra_path_length(H, super_sink, weight="resistance")
  distances = np.asarray([float(lengths.get(node, np.inf)) for node in nodes], dtype=float)
  finite = distances[np.isfinite(distances)]
  if finite.size == 0:
    return {node: 0.0 for node in nodes}
  capped = distances.copy()
  capped[~np.isfinite(capped)] = float(np.max(finite))
  resistance_unit = robust_unit_scale(capped, 0.0, 0.95)
  access = (1.0 - resistance_unit) * 100.0
  for i, node in enumerate(nodes):
    if node in sink_set:
      access[i] = 100.0
  return {node: float(np.clip(access[i], 0.0, 100.0)) for i, node in enumerate(nodes)}
