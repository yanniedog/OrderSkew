from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import (
    AiMoveStartRequest,
    AnalyzeRequest,
    AnalysisResponse,
    HumanMoveResponse,
    JobResponse,
    JobStartResponse,
    MoveRequest,
    SessionStartRequest,
    SessionStartResponse,
)
from app.service.ai_jobs import AiJobManager
from app.service.session_manager import SessionManager

router = APIRouter(prefix="/api/v1", tags=["sessions"])


def _sessions(request: Request) -> SessionManager:
    return request.app.state.session_manager


def _jobs(request: Request) -> AiJobManager:
    return request.app.state.ai_job_manager


@router.post("/session/start", response_model=SessionStartResponse)
def start_session(body: SessionStartRequest, request: Request) -> SessionStartResponse:
    try:
        payload = _sessions(request).start_session(
            game_id=body.game_id,
            human_player=body.human_player,
            mcts_sims=body.mcts_sims,
            analysis_mode=body.analysis_mode,
        )
        return SessionStartResponse.model_validate(payload)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/session/{session_id}/human-move", response_model=HumanMoveResponse)
def human_move(session_id: str, body: MoveRequest, request: Request) -> HumanMoveResponse:
    try:
        payload = _sessions(request).apply_human_move(session_id=session_id, action=body.action)
        return HumanMoveResponse.model_validate(payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/session/{session_id}/ai-move/start", response_model=JobStartResponse)
def ai_move_start(session_id: str, body: AiMoveStartRequest, request: Request) -> JobStartResponse:
    try:
        job = _jobs(request).start_job(
            session_id=session_id,
            sims=body.sims,
            temperature=body.temperature,
            emit_every=body.emit_every,
        )
        return JobStartResponse(job_id=job.job_id, status=job.status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, request: Request) -> JobResponse:
    try:
        job = _jobs(request).get_job(job_id)
        with job.lock:
            return JobResponse(
                status=job.status,
                progress=job.progress,
                analysis=AnalysisResponse.model_validate(job.analysis) if job.analysis is not None else None,
                move=job.move,
                state_after=job.state_after,
                error=job.error,
            )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/session/{session_id}/ai-move", response_model=JobResponse)
def ai_move_blocking(session_id: str, body: AiMoveStartRequest, request: Request) -> JobResponse:
    try:
        payload = _sessions(request).run_ai_move(
            session_id=session_id,
            sims=body.sims,
            temperature=body.temperature,
            emit_every=body.emit_every,
            progress_cb=None,
        )
        return JobResponse(
            status="done",
            progress={"done": body.sims, "total": body.sims},
            analysis=AnalysisResponse.model_validate(payload["analysis"]),
            move=payload["move"],
            state_after=payload["state_after"],
            error=None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analyze", response_model=AnalysisResponse)
def analyze(body: AnalyzeRequest, request: Request) -> AnalysisResponse:
    try:
        payload = _sessions(request).analyze(body.session_id)
        return AnalysisResponse.model_validate(payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

