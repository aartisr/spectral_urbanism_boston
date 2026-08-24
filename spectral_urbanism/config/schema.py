from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RunConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  run_id: str = Field(min_length=1)
  seed: int
  out_dir: str = Field(min_length=1)


class CityConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  name: str = "city"
  bbox: tuple[float, float, float, float]
  crs: str = Field(min_length=1)
  grid_resolution_m: float = Field(gt=0)

  @model_validator(mode="after")
  def validate_bbox(self) -> "CityConfig":
    min_lon, min_lat, max_lon, max_lat = self.bbox
    if min_lon >= max_lon:
      raise ValueError("city.bbox must satisfy min_lon < max_lon")
    if min_lat >= max_lat:
      raise ValueError("city.bbox must satisfy min_lat < max_lat")
    return self


class GraphConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  edge_mode: str = Field(min_length=1)
  wind_k: int = Field(ge=0)
  weight_model: dict[str, float] = Field(default_factory=dict)


class GmrfConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  tau: float = Field(gt=0)
  epsilon: float = Field(gt=0)
  obs_noise: float = Field(gt=0)


class InterventionConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  budget_k: int = Field(ge=1)
  types: list[str] = Field(min_length=1)
  costs: dict[str, float] = Field(default_factory=dict)
  effects: dict[str, dict[str, float | int]] = Field(default_factory=dict)

  @model_validator(mode="after")
  def validate_mappings(self) -> "InterventionConfig":
    missing_costs = sorted(set(self.types) - set(self.costs.keys()))
    if missing_costs:
      raise ValueError(f"interventions.costs missing keys for intervention types: {', '.join(missing_costs)}")
    missing_effects = sorted(set(self.types) - set(self.effects.keys()))
    if missing_effects:
      raise ValueError(
        f"interventions.effects missing keys for intervention types: {', '.join(missing_effects)}"
      )
    return self


class EquityConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  svi_column: str = Field(min_length=1)
  top_quantile: float = Field(default=0.8, gt=0, lt=1)


class ObjectiveConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  alpha_lambda2: float
  beta_reliability: float
  gamma_equity: float
  equity: EquityConfig


class FeatureConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  auto_discover_plugins: bool = True
  plugin_entrypoint_group: str = "spectral_urbanism.feature_plugins"
  plugin_contract_version: str = "1.0"
  required_capabilities: list[str] = Field(default_factory=list)
  plugins: list[str] = Field(
    default_factory=lambda: ["raster_features", "defaults", "equity_placeholder"],
    min_length=1,
  )
  observed_temp_column: str = "lst"
  rasters: dict[str, dict | str] = Field(default_factory=dict)
  defaults: dict[str, float] = Field(default_factory=dict)
  provided_columns: list[str] = Field(default_factory=list)
  thermal_source: str | None = None
  thermal_source_timestamp: str | None = None
  observed_temp_timestamp: str | None = None


class DataPathsConfig(BaseModel):
  model_config = ConfigDict(extra="allow")

  root: str = Field(min_length=1)


class ExperimentConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  monte_carlo_draws: int = Field(default=200, ge=1)
  reliability_p_keep: float = Field(default=0.95, gt=0, lt=1)
  confidence_alpha: float = Field(default=0.05, gt=0, lt=1)
  enforce_thermal_variation_gate: bool = False
  ablations: list[str] = Field(default_factory=list)


class OptimizationConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  eval_top_k: int | None = Field(default=250, ge=1)
  stop_if_nonpositive_gain: bool = True
  corridor_preference_weight: float = 0.0


class SpatialDiagnosticsConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  enabled: bool = True
  use_as_corridor_preference: bool = True
  access_low_threshold: float = Field(default=35.0, ge=0, le=100)
  access_very_low_threshold: float = Field(default=20.0, ge=0, le=100)
  sink_ndvi_quantile: float = Field(default=0.75, ge=0, le=1)
  sink_temp_quantile: float = Field(default=0.25, ge=0, le=1)
  sink_selection_mode: Literal["intersection", "union"] = "intersection"
  validate_access_variation: bool = True


class BaselinesConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  enabled: list[str] = Field(default_factory=list)


class CityPipelineConfig(BaseModel):
  model_config = ConfigDict(extra="forbid")

  run: RunConfig
  city: CityConfig
  data_paths: DataPathsConfig
  graph: GraphConfig
  gmrf: GmrfConfig
  interventions: InterventionConfig
  objective: ObjectiveConfig
  features: FeatureConfig = Field(default_factory=FeatureConfig)
  baselines: BaselinesConfig = Field(default_factory=BaselinesConfig)
  experiments: ExperimentConfig = Field(default_factory=ExperimentConfig)
  optimization: OptimizationConfig = Field(default_factory=OptimizationConfig)
  spatial_diagnostics: SpatialDiagnosticsConfig = Field(default_factory=SpatialDiagnosticsConfig)
