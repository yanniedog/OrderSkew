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
