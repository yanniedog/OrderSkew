from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.schemas import TrainingStartRequest, TrainingStatusResponse
from app.service.training_manager import TrainingManager

router = APIRouter(prefix="/api/v1/admin/train", tags=["admin"])


def _trainer(request: Request) -> TrainingManager:
    return request.app.state.training_manager


@router.post("/start", response_model=TrainingStatusResponse)
def train_start(body: TrainingStartRequest, request: Request) -> TrainingStatusResponse:
    trainer = _trainer(request)
    game_ids = body.games or list(request.app.state.model_registry.games.keys())
    trainer.start(
        game_ids=game_ids,
        selfplay_games_per_cycle=body.selfplay_games_per_cycle,
        train_steps_per_cycle=body.train_steps_per_cycle,
    )
    return TrainingStatusResponse.model_validate(trainer.status())


@router.get("/status", response_model=TrainingStatusResponse)
def train_status(request: Request) -> TrainingStatusResponse:
    return TrainingStatusResponse.model_validate(_trainer(request).status())


@router.post("/stop", response_model=TrainingStatusResponse)
def train_stop(request: Request) -> TrainingStatusResponse:
    trainer = _trainer(request)
    trainer.stop()
    return TrainingStatusResponse.model_validate(trainer.status())

