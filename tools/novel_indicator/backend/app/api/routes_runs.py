from __future__ import annotations

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.core.container import get_binance_client, get_db, get_run_manager
from app.core.schemas import (
    ExportConfig,
    PineBundle,
    PlotPayload,
    ReportArtifact,
    ResultSummary,
    RunConfig,
    RunCreated,
    RunStageEnum,
    RunStageLog,
    RunStatus,
    RunStatusEnum,
    TelemetryFeed,
    TelemetrySnapshot,
    UniversePreview,
)
from app.data.binance import BinanceClient
from app.db.sqlite import Database
from app.research.manager import RunManager
from app.research.runner import config_hash
from app.reporting.report_builder import ReportBuilder
from app.data.storage import ArtifactStore
from app.core.container import get_store
from app.exporters.pine import PineExporter
from app.research.search.optimizer import SearchOutcome

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("", response_model=RunCreated)
def create_run(
    config: RunConfig,
    db: Database = Depends(get_db),
    manager: RunManager = Depends(get_run_manager),
) -> RunCreated:
    run_id = uuid.uuid4().hex[:12]
    cfg_hash = config_hash(config)
    db.create_run(run_id=run_id, config_json=config.model_dump(mode="json"), config_hash=cfg_hash)
    db.add_log(run_id, RunStageEnum.created, "Run created")
    manager.submit(run_id, config)

    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create run")
    return RunCreated(run_id=run_id, status=RunStatusEnum(row["status"]), created_at=datetime.fromisoformat(row["created_at"]))


@router.get("", response_model=list[RunStatus])
def list_runs(db: Database = Depends(get_db)) -> list[RunStatus]:
    return [_row_to_run_status(db, row["run_id"]) for row in db.list_runs(limit=100)]


@router.get("/{run_id}", response_model=RunStatus)
def get_run(run_id: str, db: Database = Depends(get_db)) -> RunStatus:
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return _row_to_run_status(db, run_id)


@router.post("/{run_id}/resume", response_model=RunCreated)
def resume_run(
    run_id: str,
    db: Database = Depends(get_db),
    manager: RunManager = Depends(get_run_manager),
) -> RunCreated:
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    config = RunConfig.model_validate(json.loads(row["config_json"]))
    manager.resume(run_id, config)
    db.add_log(run_id, RunStageEnum.created, "Run resumed")
    return RunCreated(run_id=run_id, status=RunStatusEnum.queued, created_at=datetime.fromisoformat(row["created_at"]))


@router.post("/{run_id}/cancel")
def cancel_run(run_id: str, manager: RunManager = Depends(get_run_manager)) -> dict[str, bool]:
    ok = manager.cancel(run_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Run not active")
    return {"ok": True}


@router.get("/{run_id}/results", response_model=ResultSummary)
def get_results(run_id: str, db: Database = Depends(get_db)) -> ResultSummary:
    payload = db.get_result(run_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Results not found")
    return ResultSummary.model_validate(payload)


@router.get("/{run_id}/plots/{plot_id}", response_model=PlotPayload)
def get_plot(run_id: str, plot_id: str, db: Database = Depends(get_db)) -> PlotPayload:
    payload = db.get_plot(run_id, plot_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Plot not found")
    return PlotPayload(run_id=run_id, plot_id=plot_id, title=payload.get("title", plot_id), payload=payload)


@router.post("/{run_id}/report", response_model=ReportArtifact)
def generate_report(
    run_id: str,
    db: Database = Depends(get_db),
    store: ArtifactStore = Depends(get_store),
) -> ReportArtifact:
    payload = db.get_result(run_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Results not found")
    summary = ResultSummary.model_validate(payload)
    builder = ReportBuilder(store)
    artifact = builder.build(run_id, summary)
    db.add_artifact(run_id, "report_html", artifact.html_path)
    db.add_artifact(run_id, "report_pdf", artifact.pdf_path)
    return artifact


@router.post("/{run_id}/exports/pine", response_model=PineBundle)
def export_pine(
    run_id: str,
    cfg: ExportConfig,
    db: Database = Depends(get_db),
    store: ArtifactStore = Depends(get_store),
) -> PineBundle:
    payload = db.get_result(run_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Results not found")
    summary = ResultSummary.model_validate(payload)

    expression_map_path = store.export_dir(run_id) / "expression_to_pine.json"
    expression_map: dict[str, str] = {}
    if expression_map_path.exists():
        expression_map = store.load_json(expression_map_path)

    # Rebuild minimal synthetic outcomes from result summary for API-triggered export.
    synthetic_outcomes: list[SearchOutcome] = []
    exporter = PineExporter(store)
    bundle = exporter.export(
        run_id,
        summary,
        synthetic_outcomes,
        top_n=cfg.top_n,
        expression_to_pine_override=expression_map,
    )
    for file in bundle.files:
        db.add_artifact(run_id, "pine", file.path)
    return bundle


@router.get("/universe/preview", response_model=UniversePreview)
def preview_universe(
    top_n: int = 10,
    binance: BinanceClient = Depends(get_binance_client),
) -> UniversePreview:
    symbols = binance.fetch_top_volume_symbols(top_n=top_n)
    return UniversePreview(symbols=symbols, timestamp=datetime.utcnow())


@router.get("/{run_id}/telemetry", response_model=TelemetryFeed)
def get_telemetry(
    run_id: str,
    limit: int = 200,
    store: ArtifactStore = Depends(get_store),
) -> TelemetryFeed:
    path = store.run_dir(run_id) / "telemetry.jsonl"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Telemetry not found")

    lines = path.read_text(encoding="utf-8").splitlines()
    tail = lines[-max(1, min(limit, 5000)) :]
    snapshots: list[TelemetrySnapshot] = []
    for line in tail:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            snapshots.append(TelemetrySnapshot.model_validate(obj))
        except Exception:
            continue

    return TelemetryFeed(run_id=run_id, snapshots=snapshots)


def _row_to_run_status(db: Database, run_id: str) -> RunStatus:
    row = db.get_run(run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    logs = [
        RunStageLog(
            timestamp=datetime.fromisoformat(log["timestamp"]),
            stage=RunStageEnum(log["stage"]),
            message=log["message"],
        )
        for log in db.get_logs(run_id)
    ]
    return RunStatus(
        run_id=run_id,
        status=RunStatusEnum(row["status"]),
        stage=RunStageEnum(row["stage"]),
        progress=float(row["progress"]),
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
        config_hash=row["config_hash"],
        error=row["error"],
        logs=logs,
    )
