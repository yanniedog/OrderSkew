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

- `GET /health`
- `GET /ready`
- `GET /metrics`
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

## CORS Configuration

Default allowed origins include `https://orderskew.com` and localhost ports used in development.

To override, set:

```bash
ATLAS_CORS_ALLOW_ORIGINS=https://orderskew.com,http://localhost:8008
```

## Production API (why it may not be working)

The live frontend at **https://orderskew.com/pages/boardspace_atlas/** defaults to **https://api.orderskew.com** when not on localhost. If requests fail with `Failed to fetch`, check DNS first. A known failure mode is **NXDOMAIN** for `api.orderskew.com`, which means the host does not resolve at all.

This repo does not deploy the BoardSpace Atlas backend to production. Only local run is documented above. To make the API work:

1. **Local use:** Run the backend with the commands above, then open the app from localhost or set the page's **Backend URL** to `http://localhost:8008`.
2. **Production use:** Deploy this FastAPI app (for example to a VPS/container), create a Cloudflare DNS record for `api.orderskew.com`, proxy it to the origin, and verify `/health`, `/ready`, and `/api/v1/*` are served.
