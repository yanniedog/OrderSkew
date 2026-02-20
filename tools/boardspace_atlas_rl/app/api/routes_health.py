from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready(request: Request) -> dict:
    registry = request.app.state.model_registry
    sessions = request.app.state.session_manager
    jobs = request.app.state.ai_job_manager
    trainer = request.app.state.training_manager
    model_status = registry.status()
    return {
        "status": "ready",
        "models": model_status,
        "runtime": {
            "session_count": sessions.session_count(),
            "job_count": jobs.job_count(),
            "training_running": trainer.running,
        },
    }


@router.get("/metrics")
def metrics(request: Request) -> dict:
    sessions = request.app.state.session_manager
    jobs = request.app.state.ai_job_manager
    trainer = request.app.state.training_manager
    return {
        "sessions_active": sessions.session_count(),
        "jobs_active": jobs.job_count(),
        "training_running": trainer.running,
        "training_updates": trainer.status()["updates"],
    }
