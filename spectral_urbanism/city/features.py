from __future__ import annotations

import numpy as np
import pandas as pd
import geopandas as gpd
import rasterio
from rasterio.mask import mask
from shapely.geometry import mapping
from typing import Dict

def zonal_mean(raster: rasterio.io.DatasetReader, polygons: gpd.GeoDataFrame, nodata=None) -> np.ndarray:
  """Compute mean raster value per polygon (simple zonal stats)."""
  means = []
  for geom in polygons.geometry:
    out_image, _ = mask(raster, [mapping(geom)], crop=True, nodata=nodata)
    data = out_image[0]
    data = data[np.isfinite(data)]
    means.append(float(np.mean(data)) if data.size else float("nan"))
  return np.array(means)

def attach_raster_features(grid: gpd.GeoDataFrame, rasters: Dict[str, rasterio.io.DatasetReader]) -> gpd.GeoDataFrame:
  """Attach raster-derived features to grid cells."""
  out = grid.copy()
  for name, ds in rasters.items():
    out[name] = zonal_mean(ds, out)
  return out

def attach_equity_features(grid: gpd.GeoDataFrame, svi_gdf: gpd.GeoDataFrame, svi_col: str) -> gpd.GeoDataFrame:
  """Spatial join grid with vulnerability index."""
  joined = gpd.sjoin(grid, svi_gdf[[svi_col, "geometry"]], how="left", predicate="intersects")
  # Aggregate if multiple tracts intersect cell
  agg = joined.groupby("cell_id")[svi_col].mean()
  out = grid.copy()
  out[svi_col] = out["cell_id"].map(agg).astype(float)
  return out
