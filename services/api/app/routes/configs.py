from fastapi import APIRouter
from pydantic import ValidationError

from app.schemas.config import ConfigPayload, ConfigValidationResult
from spectral_urbanism.city.plugins import validate_feature_plugin_plan
from spectral_urbanism.config.schema import CityPipelineConfig

router = APIRouter()


@router.post("/configs/validate", response_model=ConfigValidationResult)
def validate_config(payload: ConfigPayload) -> ConfigValidationResult:
    cfg = payload.config
    errors: list[str] = []
    warnings: list[str] = []
    plugin_health: dict[str, dict] = {}

    try:
        normalized = CityPipelineConfig.model_validate(cfg)
        normalized_cfg = normalized.model_dump(mode="python")
    except ValidationError as exc:
        for issue in exc.errors():
            loc = ".".join(str(x) for x in issue.get("loc", []))
            msg = issue.get("msg", "invalid value")
            errors.append(f"{loc}: {msg}" if loc else msg)
        return ConfigValidationResult(valid=False, errors=errors, warnings=warnings, plugin_health={})

    plugin_errors, plugin_warnings, plugin_health = validate_feature_plugin_plan(normalized_cfg)
    errors.extend(plugin_errors)
    warnings.extend(plugin_warnings)

    if "optimization" not in cfg:
        warnings.append("optimization section missing; defaults were applied")
    if "features" not in cfg:
        warnings.append("features section missing; default plugin pipeline was applied")

    return ConfigValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        plugin_health=plugin_health,
    )
