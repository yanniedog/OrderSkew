# BoardSpace Atlas RL Backend

FastAPI + PyTorch backend for live BoardSpace Atlas gameplay and analysis.

## Run

```bash
cd tools/boardspace_atlas_rl
python -m venv .venv
.venv\\Scripts\\activate
pip install -e .[dev]
uvicorn app.main:app --host 0.0.0.0 --port 8008 --reload
```

## Main Endpoints

- `POST /api/v1/session/start`
- `POST /api/v1/session/{session_id}/human-move`
- `POST /api/v1/session/{session_id}/ai-move/start`
- `GET /api/v1/jobs/{job_id}`
- `POST /api/v1/session/{session_id}/ai-move`
- `POST /api/v1/analyze`
- `POST /get_ai_move` (compat)
- `POST /get_latent` (compat)

## Tests

```bash
pytest
```

## Production API (why it may not be working)

The live frontend at **https://orderskew.com/pages/boardspace_atlas/** defaults to **https://api.orderskew.com** when not on localhost. That host currently returns **502 Bad Gateway** for `/` and `/api/v1/session/start`, which means:

- The subdomain is reachable (DNS/proxy exist).
- The origin behind it is not responding or not running the BoardSpace Atlas FastAPI app.

This repo does not deploy the BoardSpace Atlas backend to production. Only local run is documented above. To make the API work:

1. **Local use:** Run the backend with the commands above, then open the app from localhost or set the page’s **Backend URL** to `http://localhost:8008`.
2. **Production use:** Deploy this FastAPI app (e.g. to a VPS, container, or serverless that supports Python/long-running) and point the **api.orderskew.com** origin (or your chosen host) at that deployment so `/health` and `/api/v1/*` are served. Fix any proxy/upstream misconfiguration that causes 502.
