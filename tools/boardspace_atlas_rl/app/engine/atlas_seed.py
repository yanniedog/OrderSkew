from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

from app.engine.encoding import encode_state
from app.engine.games.base import Game
from app.engine.replay import ReplaySample
from app.engine.types import GameState


def _infer_to_play(board: np.ndarray) -> int:
    p1 = int((board == 1).sum())
    p2 = int((board == -1).sum())
    return 1 if p1 <= p2 else -1


def _pad_embedding(values: list[float] | np.ndarray, target_dim: int = 8) -> np.ndarray:
    arr = np.array(values, dtype=np.float32).flatten()
    if arr.size >= target_dim:
        return arr[:target_dim]
    out = np.zeros((target_dim,), dtype=np.float32)
    out[: arr.size] = arr
    return out


def _uniform_policy(action_size: int, legal_actions: list[int]) -> np.ndarray:
    pi = np.zeros((action_size,), dtype=np.float32)
    if not legal_actions:
        return pi
    v = 1.0 / len(legal_actions)
    for a in legal_actions:
        pi[a] = v
    return pi


def _load_raw_from_node(data_js_path: Path) -> list[dict]:
    script = """
const dataPath = process.argv[1];
global.window = {};
require(dataPath);
const all = Array.isArray(window.BoardSpaceAtlasData) ? window.BoardSpaceAtlasData : [];
const allowed = new Set(["tictactoe","connect4","othello"]);
const out = all
  .filter(g => allowed.has(g.gameId))
  .map(g => ({
    gameId: g.gameId,
    positions: (g.positions || []).map(p => ({
      board: p.board,
      embedding: p.embedding
    }))
  }));
console.log(JSON.stringify(out));
"""
    run = subprocess.run(
        ["node", "-e", script, str(data_js_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(run.stdout)


def _fallback_raw() -> list[dict]:
    return [
        {
            "gameId": "tictactoe",
            "positions": [
                {"board": ["", "", "", "", "", "", "", "", ""], "embedding": [0.5, 0.4, 0.3, 0.2, 0.5, 0.1]},
                {"board": ["X", "", "", "", "O", "", "", "", ""], "embedding": [0.7, 0.5, 0.4, 0.4, 0.6, 0.2]},
                {"board": ["X", "X", "", "O", "O", "", "", "", ""], "embedding": [0.8, 0.7, 0.6, 0.5, 0.7, 0.3]},
            ],
        },
        {
            "gameId": "connect4",
            "positions": [
                {
                    "board": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [1, 2, 0, 0, 0, 0, 0]],
                    "embedding": [0.4, 0.3, 0.5, 0.6, 0.4, 0.2],
                },
                {
                    "board": [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 2, 0, 0, 0], [1, 2, 0, 1, 0, 0, 0]],
                    "embedding": [0.6, 0.5, 0.5, 0.7, 0.6, 0.3],
                },
            ],
        },
        {
            "gameId": "othello",
            "positions": [
                {
                    "board": [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 2, 1, 0, 0, 0], [0, 0, 0, 1, 2, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
                    "embedding": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                }
            ],
        },
    ]


def _convert_board(game_id: str, raw_board) -> np.ndarray:
    if game_id == "tictactoe":
        vals = []
        for cell in raw_board:
            if cell == "X":
                vals.append(1)
            elif cell == "O":
                vals.append(-1)
            else:
                vals.append(0)
        return np.array(vals, dtype=np.int8).reshape(3, 3)
    if game_id in {"connect4", "othello"}:
        arr = np.array(raw_board, dtype=np.int8)
        out = np.zeros_like(arr, dtype=np.int8)
        out[arr == 1] = 1
        out[arr == 2] = -1
        return out
    raise ValueError(f"Unsupported game id in atlas seed conversion: {game_id}")


def load_atlas_seed_samples(repo_root: Path, games: dict[str, Game]) -> dict[str, list[ReplaySample]]:
    data_js_path = repo_root / "pages" / "boardspace_atlas" / "data.js"
    raw: list[dict]
    try:
        raw = _load_raw_from_node(data_js_path)
    except Exception:
        raw = _fallback_raw()

    out: dict[str, list[ReplaySample]] = {g: [] for g in games.keys()}
    for game_blob in raw:
        game_id = str(game_blob.get("gameId", ""))
        game = games.get(game_id)
        if game is None:
            continue
        for pos in game_blob.get("positions", []):
            board = _convert_board(game_id, pos.get("board"))
            state = GameState(
                game_id=game_id, board=board, to_play=_infer_to_play(board), ply=0, pass_count=0, result="ongoing"
            )
            legal = game.legal_actions(state)
            if not legal:
                continue
            emb = [float(v) for v in pos.get("embedding", [])]
            z = float(np.clip(np.mean(emb) if emb else 0.5, 0.0, 1.0))
            sample = ReplaySample(
                game_id=game_id,
                state_planes=encode_state(game, state),
                target_pi=_uniform_policy(game.spec.action_size, legal),
                target_z=z,
                ply=0,
                source="atlas_seed",
                atlas_target=_pad_embedding(emb, 8),
            )
            out[game_id].append(sample)
    return out

