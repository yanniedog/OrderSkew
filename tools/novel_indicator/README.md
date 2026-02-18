# Novel Indicator Discovery Platform

End-to-end local research stack for crypto OHLCV ingestion, AI-driven symbolic indicator discovery, leakage-safe forecasting (`3..200` bars), backtest diagnostics, universal/per-asset ranking, interactive web UI, PDF reporting, and PineScript v6 export.

## OrderSkew Integration Mode

This project is copied into `orderskew/tools/novel_indicator` and deployed as a static tool under `orderskew/pages/novel_indicator`.

- Public website role: serve static HTML/CSS/JS only.
- End-user machine role: run the local compute engine (`FastAPI`) at `127.0.0.1:8000`.
- Frontend endpoint routing: configurable from the UI (`Local API endpoint`) and persisted in local storage.
- Fallback mode: bundled demo artifacts can be loaded without backend connectivity.

This architecture keeps server load near-zero while preserving full local compute for discovery runs.

## What Is Implemented

- Backend (`FastAPI`, Python 3.10):
  - `POST /api/runs` launches resumable background runs.
  - `GET /api/runs/{id}` stage/progress/log monitoring.
  - `GET /api/runs/{id}/results` universal + per-asset recommendations.
- `GET /api/runs/{id}/plots/{plot_id}` chart payload retrieval.
- `GET /api/runs/{id}/telemetry` live telemetry snapshots.
  - `POST /api/runs/{id}/report` HTML-to-PDF report generation.
  - `POST /api/runs/{id}/exports/pine` PineScript bundle export.
  - Binance top-volume universe snapshot + OHLCV ingestion.
  - Purged walk-forward CV with purge/embargo leakage controls.
  - Symbolic indicator DSL, novelty filtering, collinearity filtering.
  - Adaptive coarse-to-fine horizon search over `3..200`.
  - Multi-stage candidate search + mutation tuning + sparse combo search.
  - Secondary backtest metrics with fees/slippage.
  - SQLite run metadata, Parquet data/features, JSON artifacts.
  - Live telemetry stream to console and file (overall/task progress bars, elapsed/ETA, throughput, CPU/RAM, CPU temp when available).
- Frontend (`React` + `Vite` + `Plotly`):
  - Run launch, run list, live monitor logs, result tables, visual diagnostics.
  - Live telemetry dashboard (overall/task progress, ETA, throughput, CPU/RAM/temp).
  - Export controls (report + Pine).
  - Responsive, non-generic visual style.

## Repo Layout

- `backend/app/main.py` FastAPI entrypoint.
- `backend/app/api/routes_runs.py` run lifecycle and export/report APIs.
- `backend/app/research/runner.py` full orchestration pipeline.
- `backend/app/research/search/optimizer.py` multi-stage AI indicator search.
- `backend/app/research/indicators/dsl.py` indicator expression DSL + Pine translation.
- `backend/app/reporting/report_builder.py` HTML -> PDF report builder.
- `backend/app/exporters/pine.py` PineScript generator.
- `frontend/src/pages/App.tsx` interactive dashboard.
- `artifacts/runs/<run_id>/...` run outputs.

## Setup

### Prerequisites

- `pyenv` Python `3.10.9` active.
- Node.js `20+` and npm.

### Backend

```powershell
cd backend
python -m pip install -e .
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

macOS/Linux equivalent:

```bash
cd backend
python3 -m pip install -e .
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Production static bundle for `orderskew/pages/novel_indicator`:

```powershell
cd frontend
npm run build
```

Automated test + build + publish into OrderSkew pages:

```powershell
.\deploy-to-orderskew.ps1
```

### One-command launcher

```powershell
.\run-dev.ps1
```

## Test And Build Validation

Backend tests:

```powershell
python -m pytest backend/tests -q
```

Frontend build:

```powershell
cd frontend
npm run build
```

## Run Artifacts

For each run, artifacts are written to:

- `artifacts/runs/<run_id>/data/*.parquet`
- `artifacts/runs/<run_id>/plots/*.json`
- `artifacts/runs/<run_id>/report/report.html`
- `artifacts/runs/<run_id>/report/report.pdf`
- `artifacts/runs/<run_id>/exports/*.pine`
- `artifacts/runs/<run_id>/result_summary.json`
- `artifacts/runs/<run_id>/telemetry.log`
- `artifacts/runs/<run_id>/telemetry.jsonl`

## Benchmark Snapshot

On the same 2-symbol x 2-timeframe benchmark workload:

- Baseline model/search pipeline: `~16.8s`, mean composite error `~0.205`.
- Refined pipeline (current): `~26.2s`, mean composite error `~0.059`.

This improves prediction quality substantially while remaining interactive. Use lower search budgets for faster iteration cycles.

## Notes

- Primary ranking metric is pure prediction error (normalized MAE/RMSE blend).
- Directional accuracy and backtest performance are secondary diagnostics.
- Pine scripts are deterministic and contain no AI logic.
- A smoke run was validated successfully (`artifacts/runs/smoke002`).
- CPU temperature reporting depends on host sensor exposure; if unavailable it is logged as `n/a`.
- Purged/embargoed CV + strict no-lookahead timestamp checks are enforced to prevent historical data contamination.
- Adaptive budget scaling reduces search complexity automatically when budget-per-job is low.
- Browser support target is modern Chromium/Firefox/Safari/Edge. Internet Explorer is not supported.
