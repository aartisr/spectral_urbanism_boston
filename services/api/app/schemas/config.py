from pydantic import BaseModel, Field


class ConfigPayload(BaseModel):
    config: dict = Field(default_factory=dict)


class ConfigValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    plugin_health: dict[str, dict] = Field(default_factory=dict)
