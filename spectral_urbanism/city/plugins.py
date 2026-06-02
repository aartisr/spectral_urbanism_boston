from __future__ import annotations

import importlib
import os
import warnings
from dataclasses import dataclass, field
from importlib.metadata import entry_points
from typing import Callable

import geopandas as gpd
import numpy as np

from spectral_urbanism.data.catalog import DataPaths

FeaturePlugin = Callable[[gpd.GeoDataFrame, dict, DataPaths], gpd.GeoDataFrame]


@dataclass(frozen=True)
class FeaturePluginContract:
  version: str = "1.0"
  capabilities: set[str] = field(default_factory=set)
  required_columns: set[str] = field(default_factory=set)
  description: str = ""


@dataclass(frozen=True)
class RegisteredFeaturePlugin:
  name: str
  plugin: FeaturePlugin
  contract: FeaturePluginContract


_FEATURE_PLUGINS: dict[str, RegisteredFeaturePlugin] = {}
_DISCOVERED_GROUPS: set[str] = set()


def register_feature_plugin(
  name: str,
  plugin: FeaturePlugin,
  *,
  contract_version: str = "1.0",
  capabilities: set[str] | None = None,
  required_columns: set[str] | None = None,
  description: str = "",
) -> None:
  if not callable(plugin):
    raise TypeError(f"Feature plugin '{name}' must be callable")

  _FEATURE_PLUGINS[name] = RegisteredFeaturePlugin(
    name=name,
    plugin=plugin,
    contract=FeaturePluginContract(
      version=contract_version,
      capabilities=capabilities or set(),
      required_columns=required_columns or set(),
      description=description,
    ),
  )


def get_feature_plugin(name: str) -> FeaturePlugin:
  if name not in _FEATURE_PLUGINS:
    raise ValueError(f"Unknown feature plugin: {name}")
  return _FEATURE_PLUGINS[name].plugin


def get_feature_plugin_contract(name: str) -> FeaturePluginContract:
  if name not in _FEATURE_PLUGINS:
    raise ValueError(f"Unknown feature plugin: {name}")
  return _FEATURE_PLUGINS[name].contract


def list_feature_plugins() -> list[str]:
  return sorted(_FEATURE_PLUGINS.keys())


def _load_plugin_from_path(import_path: str) -> FeaturePlugin:
  if ":" not in import_path:
    raise ValueError(
      f"Invalid plugin import path '{import_path}'. Expected format: module.submodule:function_name"
    )
  module_name, attr = import_path.split(":", 1)
  module = importlib.import_module(module_name)
  plugin = getattr(module, attr)
  if not callable(plugin):
    raise TypeError(f"Imported plugin '{import_path}' is not callable")
  return plugin


def _register_entrypoint_loaded(ep_name: str, loaded: object) -> None:
  if callable(loaded):
    # Preserve any existing contract metadata for built-in plugins when
    # re-registering via entry point discovery.
    existing = _FEATURE_PLUGINS.get(ep_name)
    if existing is not None:
      register_feature_plugin(
        ep_name,
        loaded,
        contract_version=existing.contract.version,
        capabilities=set(existing.contract.capabilities),
        required_columns=set(existing.contract.required_columns),
        description=existing.contract.description,
      )
    else:
      register_feature_plugin(ep_name, loaded)
    return

  if isinstance(loaded, dict):
    plugin = loaded.get("plugin") or loaded.get("callable")
    capabilities = set(map(str, loaded.get("capabilities", [])))
    required_columns = set(map(str, loaded.get("required_columns", [])))
    contract_version = str(loaded.get("version", "1.0"))
    description = str(loaded.get("description", ""))
    register_feature_plugin(
      ep_name,
      plugin,  # type: ignore[arg-type]
      contract_version=contract_version,
      capabilities=capabilities,
      required_columns=required_columns,
      description=description,
    )
    return

  raise TypeError(
    f"Entry point '{ep_name}' must load a callable or contract dict, got {type(loaded).__name__}"
  )


def discover_feature_plugins(group: str = "spectral_urbanism.feature_plugins", force: bool = False) -> list[str]:
  if not force and group in _DISCOVERED_GROUPS:
    return []

  loaded: list[str] = []
  try:
    candidates = list(entry_points(group=group))
  except TypeError:
    # Compatibility fallback for older importlib.metadata APIs.
    eps = entry_points()
    if hasattr(eps, "select"):
      candidates = list(eps.select(group=group))
    else:
      candidates = list(eps.get(group, []))

  for ep in candidates:
    try:
      loaded_obj = ep.load()
      _register_entrypoint_loaded(ep.name, loaded_obj)
      loaded.append(ep.name)
    except Exception as exc:  # noqa: BLE001
      warnings.warn(
        f"Failed loading feature plugin entry point '{ep.name}' from group '{group}': {exc}",
        RuntimeWarning,
        stacklevel=2,
      )

  _DISCOVERED_GROUPS.add(group)
  return loaded


def _ensure_plugin_available(plugin_name: str) -> None:
  if plugin_name in _FEATURE_PLUGINS:
    return

  # Support inline plugin references in config, e.g. "my_pkg.my_mod:my_plugin".
  if ":" in plugin_name:
    plugin = _load_plugin_from_path(plugin_name)
    register_feature_plugin(plugin_name, plugin)
    return

  raise ValueError(
    f"Unknown feature plugin: {plugin_name}. Available plugins: {', '.join(list_feature_plugins())}"
  )


def _collect_config_declared_columns(cfg: dict) -> set[str]:
  features_cfg = cfg.get("features", {})
  columns: set[str] = set()

  defaults = features_cfg.get("defaults", {})
  if isinstance(defaults, dict):
    columns.update(map(str, defaults.keys()))

  rasters = features_cfg.get("rasters", {})
  if isinstance(rasters, dict):
    columns.update(map(str, rasters.keys()))

  explicit_columns = features_cfg.get("provided_columns", [])
  if isinstance(explicit_columns, list):
    columns.update(map(str, explicit_columns))

  svi_col = str(cfg.get("objective", {}).get("equity", {}).get("svi_column", "SVI"))
  columns.add(svi_col)

  return columns


def validate_feature_plugin_plan(cfg: dict) -> tuple[list[str], list[str], dict[str, dict[str, object]]]:
  errors: list[str] = []
  warnings: list[str] = []
  health: dict[str, dict[str, object]] = {}

  features_cfg = cfg.get("features", {})
  if bool(features_cfg.get("auto_discover_plugins", True)):
    discover_feature_plugins(str(features_cfg.get("plugin_entrypoint_group", "spectral_urbanism.feature_plugins")))

  plugin_names = features_cfg.get(
    "plugins",
    ["raster_features", "defaults", "equity_placeholder"],
  )

  expected_version = str(features_cfg.get("plugin_contract_version", "1.0"))
  required_capabilities = set(map(str, features_cfg.get("required_capabilities", [])))
  declared_columns = _collect_config_declared_columns(cfg)
  aggregate_capabilities: set[str] = set()

  for plugin_name in plugin_names:
    plugin_name_str = str(plugin_name)
    try:
      _ensure_plugin_available(plugin_name_str)
      contract = get_feature_plugin_contract(plugin_name_str)
      aggregate_capabilities.update(contract.capabilities)

      missing_columns = sorted(contract.required_columns - declared_columns)
      if missing_columns:
        errors.append(
          f"Plugin '{plugin_name_str}' requires missing columns: {', '.join(missing_columns)}"
        )

      if contract.version != expected_version:
        errors.append(
          f"Plugin '{plugin_name_str}' contract version {contract.version} does not match expected {expected_version}"
        )

      health[plugin_name_str] = {
        "contract_version": contract.version,
        "capabilities": sorted(contract.capabilities),
        "required_columns": sorted(contract.required_columns),
        "description": contract.description,
      }
    except Exception as exc:  # noqa: BLE001
      errors.append(str(exc))

  missing_capabilities = sorted(required_capabilities - aggregate_capabilities)
  if missing_capabilities:
    errors.append(
      "Required plugin capabilities not satisfied: " + ", ".join(missing_capabilities)
    )

  if not required_capabilities and plugin_names:
    warnings.append(
      "features.required_capabilities not set; capability-level validation is not enforcing feature guarantees"
    )

  return errors, warnings, health


def _raster_features_plugin(grid: gpd.GeoDataFrame, cfg: dict, dp: DataPaths) -> gpd.GeoDataFrame:
  features_cfg = cfg.get("features", {})
  
  # Dynamically select LST path based on thermal_source config
  thermal_source = features_cfg.get("thermal_source", "landsat").lower()
  lst_path_key = f"lst_{thermal_source}" if thermal_source in ("landsat", "ecostress") else "lst_landsat"
  
  raster_specs = features_cfg.get(
    "rasters",
    {
      "ndvi": {"path_key": "ndvi_s2"},
      "albedo": {"path_key": "albedo"},
      "impervious": {"path_key": "impervious"},
      "lst": {"path_key": lst_path_key},
    },
  )
  if isinstance(raster_specs, dict) and thermal_source in ("landsat", "ecostress"):
    raster_specs = dict(raster_specs)
    raster_specs["lst"] = {"path_key": lst_path_key}

  rasters = {}
  
  # Try to load with rasterio first
  rasterio_available = False
  try:
    from spectral_urbanism.city.features import attach_raster_features
    from spectral_urbanism.data.loaders import load_raster
    rasterio_available = True
  except Exception:  # noqa: BLE001
    pass

  for feature_name, spec in raster_specs.items():
    if isinstance(spec, str):
      raster_path = dp.get(spec)
    elif isinstance(spec, dict):
      path_key = str(spec.get("path_key", "")).strip()
      explicit_path = str(spec.get("path", "")).strip()
      raster_path = explicit_path or (dp.get(path_key) if path_key else "")
    else:
      continue

    # Try the specified path first, then fallback to .npy variant if .tif doesn't exist
    if raster_path and not os.path.exists(raster_path):
      # Try .npy fallback for common rasters (lst, ndvi, albedo, impervious)
      if raster_path.endswith('.tif'):
        npy_path = raster_path.replace('.tif', '.npy')
        if os.path.exists(npy_path):
          raster_path = npy_path
    
    if raster_path and os.path.exists(raster_path):
      if raster_path.endswith('.npy'):
        try:
          import numpy as np
          rasters[feature_name] = np.load(raster_path)
        except Exception as exc:  # noqa: BLE001
          warnings.warn(
            f"Failed to load raster {feature_name} from {raster_path}: {exc}",
            RuntimeWarning,
            stacklevel=2,
          )
      elif rasterio_available:
        try:
          rasters[feature_name] = load_raster(raster_path)
        except Exception:
          # If rasterio loading fails, fall back to numpy
          pass
      
      # Fallback: load .npy files directly with numpy
      if feature_name not in rasters and raster_path.endswith('.npy'):
        try:
          import numpy as np
          data = np.load(raster_path)
          rasters[feature_name] = data
        except Exception as exc:  # noqa: BLE001
          warnings.warn(
            f"Failed to load raster {feature_name} from {raster_path}: {exc}",
            RuntimeWarning,
            stacklevel=2,
          )

  if not rasters:
    if not rasterio_available:
      warnings.warn(
        "Raster feature plugin: rasterio unavailable; proceeding with defaults only",
        RuntimeWarning,
        stacklevel=2,
      )
    return grid

  # Try to use rasterio-based attachment if available
  if rasterio_available and not any(isinstance(ds, np.ndarray) for ds in rasters.values()):
    try:
      result = attach_raster_features(grid, rasters)
      for ds in rasters.values():
        if hasattr(ds, 'close'):
          ds.close()
      return result
    except Exception as exc:  # noqa: BLE001
      warnings.warn(
        f"attach_raster_features failed: {exc}; attempting numpy fallback",
        RuntimeWarning,
        stacklevel=2,
      )
  
  # Numpy fallback: manually attach numpy arrays to grid
  try:
    import numpy as np
    for feature_name, data in rasters.items():
      if isinstance(data, np.ndarray):
        if data.ndim == 2:
          # 2D grid: map to grid cells by spatial sampling
          # Sample the raster at each grid cell's centroid or use a simple distribution
          flat_data = data.flatten()
          
          # Create feature values by distributing raster samples across grid cells
          if len(grid) > 0:
            # Use quantile-based sampling: divide raster into n quantiles for n grid cells
            n_cells = len(grid)
            indices = np.linspace(0, len(flat_data) - 1, n_cells, dtype=int)
            sampled_values = flat_data[indices]
            grid[feature_name] = sampled_values
          else:
            grid[feature_name] = np.mean(flat_data)
        elif data.ndim == 1:
          # 1D array: directly assign to grid (if length matches)
          if len(data) == len(grid):
            grid[feature_name] = data
          else:
            # Resample to match grid size
            indices = np.linspace(0, len(data) - 1, len(grid), dtype=int)
            grid[feature_name] = data[indices]
    return grid
  except Exception as exc:  # noqa: BLE001
    warnings.warn(
      f"Numpy fallback for raster features failed ({exc}); proceeding without raster-derived features",
      RuntimeWarning,
      stacklevel=2,
    )
    return grid



def _defaults_plugin(grid: gpd.GeoDataFrame, cfg: dict, _: DataPaths) -> gpd.GeoDataFrame:
  defaults = cfg.get("features", {}).get(
    "defaults",
    {
      "ndvi": 0.2,
      "albedo": 0.15,
      "impervious": 0.5,
      "lst": 35.0,
    },
  )
  out = grid.copy()
  for col, val in defaults.items():
    if col not in out.columns:
      out[col] = float(val)
  return out


def _equity_placeholder_plugin(grid: gpd.GeoDataFrame, cfg: dict, dp: DataPaths) -> gpd.GeoDataFrame:
  svi_col = str(cfg.get("objective", {}).get("equity", {}).get("svi_column", "SVI"))
  out = grid.copy()

  # Placeholder behavior kept for now. Real spatial join can be plugged as another plugin.
  _ = dp.get("svi")
  if svi_col not in out.columns:
    out[svi_col] = 0.0
  else:
    out[svi_col] = out[svi_col].fillna(0.0).astype(float)
  return out


def apply_feature_plugins(grid: gpd.GeoDataFrame, cfg: dict, dp: DataPaths) -> gpd.GeoDataFrame:
  plugin_names = cfg.get("features", {}).get(
    "plugins",
    ["raster_features", "defaults", "equity_placeholder"],
  )

  errors, _, _ = validate_feature_plugin_plan(cfg)
  if errors:
    raise ValueError("; ".join(errors))

  out = grid
  for plugin_name in plugin_names:
    plugin_name_str = str(plugin_name)
    _ensure_plugin_available(plugin_name_str)
    out = get_feature_plugin(plugin_name_str)(out, cfg, dp)
  return out


register_feature_plugin(
  "raster_features",
  _raster_features_plugin,
  capabilities={"raster-zonal-stats", "thermal-observations"},
  description="Attach configured raster-derived columns onto the city grid.",
)
register_feature_plugin(
  "defaults",
  _defaults_plugin,
  capabilities={"feature-fallback"},
  description="Populate missing feature columns with configured fallback defaults.",
)
register_feature_plugin(
  "equity_placeholder",
  _equity_placeholder_plugin,
  capabilities={"equity"},
  description="Ensure the configured equity vulnerability column exists.",
)
