from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


GameId = Literal["tictactoe", "connect4", "othello"]


class SessionStartRequest(BaseModel):
    game_id: GameId
    human_player: int = Field(default=1)
    mcts_sims: int = Field(default=800, ge=1, le=5000)
    analysis_mode: Literal["live", "off"] = "live"


class MoveRequest(BaseModel):
    action: int


class AiMoveStartRequest(BaseModel):
    sims: int = Field(default=800, ge=1, le=5000)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    emit_every: int = Field(default=50, ge=1, le=2000)


class AnalyzeRequest(BaseModel):
    session_id: str


class SessionStateResponse(BaseModel):
    board: list[list[int]]
    to_play: int
    legal_actions: list[int]
    result: Literal["ongoing", "p1_win", "p2_win", "draw"]
    ply: int


class SessionStartResponse(BaseModel):
    session_id: str
    state: SessionStateResponse


class HumanMoveResponse(BaseModel):
    accepted: bool
    state: SessionStateResponse


class AnalysisResponse(BaseModel):
    value: float
    policy: list[float]
    latent: list[float]
    mcts: dict[str, Any] = Field(default_factory=dict)


class JobStartResponse(BaseModel):
    job_id: str
    status: str


class JobResponse(BaseModel):
    status: str
    progress: dict[str, int] | None = None
    analysis: AnalysisResponse | None = None
    move: dict[str, int] | None = None
    state_after: SessionStateResponse | None = None
    error: str | None = None


class TrainingStartRequest(BaseModel):
    games: list[GameId] | None = None
    selfplay_games_per_cycle: int = Field(default=1, ge=1, le=64)
    train_steps_per_cycle: int = Field(default=1, ge=1, le=128)


class TrainingStatusResponse(BaseModel):
    running: bool
    started_at: float | None = None
    updates: dict[str, int] = Field(default_factory=dict)
    message: str = ""

