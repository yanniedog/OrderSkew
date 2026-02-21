from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.schemas import AiMoveStartRequest, AnalyzeRequest, AnalysisResponse, JobResponse

router = APIRouter(tags=["compat"])


@router.post("/get_ai_move", response_model=JobResponse)
def get_ai_move(body: dict, request: Request) -> JobResponse:
    session_id = str(body.get("session_id", ""))
    parsed = AiMoveStartRequest(
        sims=int(body.get("sims", 800)),
        temperature=float(body.get("temperature", 0.0)),
        emit_every=int(body.get("emit_every", 50)),
    )
    try:
        payload = request.app.state.session_manager.run_ai_move(
            session_id=session_id,
            sims=parsed.sims,
            temperature=parsed.temperature,
            emit_every=parsed.emit_every,
            progress_cb=None,
        )
        return JobResponse(
            status="done",
            progress={"done": parsed.sims, "total": parsed.sims},
            analysis=payload["analysis"],
            move=payload["move"],
            state_after=payload["state_after"],
            error=None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/get_latent", response_model=AnalysisResponse)
def get_latent(body: dict, request: Request) -> AnalysisResponse:
    parsed = AnalyzeRequest(session_id=str(body.get("session_id", "")))
    try:
        payload = request.app.state.session_manager.analyze(parsed.session_id)
        return AnalysisResponse.model_validate(payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

