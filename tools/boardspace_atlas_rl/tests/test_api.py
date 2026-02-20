from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_session_flow_start_human_analyze() -> None:
    client = TestClient(app)
    start = client.post(
        "/api/v1/session/start",
        json={"game_id": "tictactoe", "human_player": 1, "mcts_sims": 50, "analysis_mode": "live"},
    )
    assert start.status_code == 200
    payload = start.json()
    session_id = payload["session_id"]
    assert payload["state"]["to_play"] == 1

    hm = client.post(f"/api/v1/session/{session_id}/human-move", json={"action": 0})
    assert hm.status_code == 200
    assert hm.json()["state"]["to_play"] == -1

    az = client.post("/api/v1/analyze", json={"session_id": session_id})
    assert az.status_code == 200
    analysis = az.json()
    assert "policy" in analysis and "latent" in analysis and "value" in analysis


def test_blocking_ai_move_and_compat_aliases() -> None:
    client = TestClient(app)
    start = client.post(
        "/api/v1/session/start",
        json={"game_id": "tictactoe", "human_player": -1, "mcts_sims": 30, "analysis_mode": "live"},
    )
    session_id = start.json()["session_id"]

    ai = client.post(f"/api/v1/session/{session_id}/ai-move", json={"sims": 20, "temperature": 0.0, "emit_every": 10})
    assert ai.status_code == 200
    assert ai.json()["status"] == "done"

    lat = client.post("/get_latent", json={"session_id": session_id})
    assert lat.status_code == 200
    gm = client.post("/get_ai_move", json={"session_id": session_id, "sims": 10, "temperature": 0.0, "emit_every": 5})
    assert gm.status_code in {200, 400}

