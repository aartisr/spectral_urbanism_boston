from pydantic import BaseModel, Field


class RunCreateRequest(BaseModel):
    run_name: str = "api_run"
    config: dict = Field(default_factory=dict)


class RunCreateResponse(BaseModel):
    run_id: str
    status: str


class RunResponse(BaseModel):
    run_id: str
    status: str
    run_name: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    out_dir: str | None = None
    error: str | None = None
