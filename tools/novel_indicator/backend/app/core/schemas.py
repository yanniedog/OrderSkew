from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class RunStatusEnum(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"


class RunStageEnum(str, Enum):
    created = "created"
    universe = "universe"
    ingest = "ingest"
    discovery = "discovery"
    optimization = "optimization"
    ranking = "ranking"
    backtest = "backtest"
    artifacts = "artifacts"
    finished = "finished"


class HorizonConfig(BaseModel):
    min_bar: int = 3
    max_bar: int = 200
    coarse_step: int = 12
    refine_radius: int = 8

    @model_validator(mode="after")
    def validate_range(self) -> "HorizonConfig":
        if self.min_bar < 1:
            raise ValueError("min_bar must be >= 1")
        if self.max_bar <= self.min_bar:
            raise ValueError("max_bar must be > min_bar")
        if self.coarse_step < 1:
            raise ValueError("coarse_step must be >= 1")
        return self


class BacktestConfig(BaseModel):
    fee_bps: float = 7.0
    slippage_bps: float = 5.0
    signal_threshold: float = 0.001


class CVConfig(BaseModel):
    folds: int = 5
    embargo_bars: int = 8
    purge_bars: int = 8


class SearchConfig(BaseModel):
    candidate_pool_size: int = 180
    stage_a_keep: int = 90
    stage_b_keep: int = 30
    tuning_trials: int = 8
    max_combo_size: int = 3
    novelty_similarity_threshold: float = 0.82
    collinearity_threshold: float = 0.94


class RunConfig(BaseModel):
    top_n_symbols: int = Field(default=10, ge=1, le=40)
    symbols: list[str] | None = None
    timeframes: list[str] = Field(default_factory=lambda: ["5m", "1h", "4h"])
    history_windows: dict[str, int] = Field(default_factory=lambda: {"5m": 120, "1h": 365 * 2, "4h": 365 * 4})
    horizon: HorizonConfig = Field(default_factory=HorizonConfig)
    cv: CVConfig = Field(default_factory=CVConfig)
    search: SearchConfig = Field(default_factory=SearchConfig)
    backtest: BacktestConfig = Field(default_factory=BacktestConfig)
    budget_minutes: int = Field(default=120, ge=5, le=480)
    random_seed: int = Field(default=42, ge=1, le=1_000_000)

    @field_validator("timeframes")
    @classmethod
    def validate_timeframes(cls, values: list[str]) -> list[str]:
        supported = {"5m", "1h", "4h"}
        for value in values:
            if value not in supported:
                raise ValueError(f"unsupported timeframe '{value}'")
        return values

    @model_validator(mode="after")
    def validate_symbol_inputs(self) -> "RunConfig":
        if self.symbols is not None:
            if len(self.symbols) == 0:
                raise ValueError("symbols must not be empty when provided")
            if len(self.symbols) > 40:
                raise ValueError("symbols supports at most 40 entries")
        return self


class RunCreated(BaseModel):
    run_id: str
    status: RunStatusEnum
    created_at: datetime


class RunStageLog(BaseModel):
    timestamp: datetime
    stage: RunStageEnum
    message: str


class RunStatus(BaseModel):
    run_id: str
    status: RunStatusEnum
    stage: RunStageEnum
    progress: float
    created_at: datetime
    updated_at: datetime
    config_hash: str
    error: str | None = None
    logs: list[RunStageLog] = Field(default_factory=list)


class IndicatorSpec(BaseModel):
    indicator_id: str
    expression: str
    complexity: int
    params: dict[str, Any] = Field(default_factory=dict)


class ScoreCard(BaseModel):
    normalized_rmse: float
    normalized_mae: float
    composite_error: float
    directional_hit_rate: float
    pnl_total: float
    max_drawdown: float
    turnover: float
    stability_score: float


class AssetRecommendation(BaseModel):
    symbol: str
    timeframe: str
    best_horizon: int
    indicator_combo: list[IndicatorSpec]
    score: ScoreCard


class ResultSummary(BaseModel):
    run_id: str
    universal_recommendation: AssetRecommendation
    per_asset_recommendations: list[AssetRecommendation]
    generated_at: datetime


class PlotPayload(BaseModel):
    run_id: str
    plot_id: str
    title: str
    payload: dict[str, Any]


class ReportArtifact(BaseModel):
    run_id: str
    html_path: str
    pdf_path: str


class ExportConfig(BaseModel):
    top_n: int = 3


class PineFile(BaseModel):
    name: str
    path: str


class PineBundle(BaseModel):
    run_id: str
    files: list[PineFile]


class UniversePreview(BaseModel):
    symbols: list[str]
    timestamp: datetime


class TelemetrySnapshot(BaseModel):
    ts: datetime
    stage: str
    working_on: str
    achieved: str
    remaining: str
    overall_progress: float
    stage_progress: float
    run_elapsed_sec: float
    stage_elapsed_sec: float
    eta_total_sec: float | None = None
    eta_stage_sec: float | None = None
    rate_units_per_sec: float
    rate_units_per_core_sec: float | None = None
    rate_units_per_cpu_pct_sec: float | None = None
    system_cpu_percent: float
    process_cpu_percent: float
    ram_used_gb: float
    ram_total_gb: float
    ram_percent: float
    cpu_temp_c: float | None = None


class TelemetryFeed(BaseModel):
    run_id: str
    snapshots: list[TelemetrySnapshot]
