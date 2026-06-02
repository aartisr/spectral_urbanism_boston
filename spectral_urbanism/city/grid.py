from __future__ import annotations
import numpy as np
import geopandas as gpd
from shapely.geometry import box
from typing import Tuple

def make_grid(bbox_lonlat: list[float], resolution_m: float, crs: str = "EPSG:4326") -> gpd.GeoDataFrame:
  """Create a coarse grid over the bbox.

  NOTE: This is a starter implementation. For publication-grade results,
  reproject to a local projected CRS (e.g., city-specific UTM or local state plane),
  then build the grid in meters.
  """
  minx, miny, maxx, maxy = bbox_lonlat
  # Simple lon/lat grid spacing heuristic (not perfect). Replace with projected CRS approach.
  # ~111km per degree latitude; longitude scale depends on latitude.
  lat0 = (miny + maxy) / 2.0
  deg_per_m_lat = 1.0 / 111_000.0
  deg_per_m_lon = 1.0 / (111_000.0 * np.cos(np.deg2rad(lat0)))

  dx = resolution_m * deg_per_m_lon
  dy = resolution_m * deg_per_m_lat

  xs = np.arange(minx, maxx, dx)
  ys = np.arange(miny, maxy, dy)

  cells = []
  for x in xs:
    for y in ys:
      cells.append(box(x, y, x + dx, y + dy))

  gdf = gpd.GeoDataFrame({"cell_id": np.arange(len(cells))}, geometry=cells, crs=crs)
  return gdf
