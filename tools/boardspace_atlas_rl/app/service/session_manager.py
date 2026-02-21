from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Callable

import numpy as np

from app.core.model_registry import ModelRegistry
from app.engine.math_utils import masked_softmax
from app.engine.mcts import run_mcts
from app.engine.types import GameState


@dataclass
class Session:
    session_id: str
    game_id: str
    state: GameState
    human_player: int
    mcts_sims: int
    analysis_mode: str
    created_at: float
    lock: Lock = field(default_factory=Lock)


ProgressCallback = Callable[[int, int, dict], None]


class SessionManager:
    def __init__(self, model_registry: ModelRegistry) -> None:
        self.model_registry = model_registry
        self._sessions: dict[str, Session] = {}
        self._lock = Lock()

    def _default_sims(self, game_id: str) -> int:
        if game_id == "tictactoe":
            return 200
        return 800

    def _state_payload(self, session: Session) -> dict:
        legal = self.model_registry.game(session.game_id).legal_actions(session.state)
        return {
            "board": session.state.board.astype(int).tolist(),
            "to_play": int(session.state.to_play),
            "legal_actions": [int(a) for a in legal],
            "result": session.state.result,
            "ply": int(session.state.ply),
        }

    def start_session(self, game_id: str, human_player: int, mcts_sims: int, analysis_mode: str) -> dict:
        game = self.model_registry.game(game_id)
        sid = "sess_" + uuid.uuid4().hex[:12]
        sims = int(mcts_sims) if mcts_sims > 0 else self._default_sims(game_id)
        session = Session(
            session_id=sid,
            game_id=game_id,
            state=game.initial_state(),
            human_player=1 if human_player >= 0 else -1,
            mcts_sims=sims,
            analysis_mode=analysis_mode,
            created_at=time.time(),
        )
        with self._lock:
            self._sessions[sid] = session
        return {"session_id": sid, "state": self._state_payload(session)}

    def get_session(self, session_id: str) -> Session:
        with self._lock:
            session = self._sessions.get(session_id)
        if session is None:
            raise KeyError("Unknown session id")
        return session

    def session_count(self) -> int:
        with self._lock:
            return len(self._sessions)

    def apply_human_move(self, session_id: str, action: int) -> dict:
        session = self.get_session(session_id)
        game = self.model_registry.game(session.game_id)
        with session.lock:
            if session.state.result != "ongoing":
                raise ValueError("Game is already finished.")
            if session.state.to_play != session.human_player:
                raise ValueError("It is not the human player's turn.")
            legal = game.legal_actions(session.state)
            if action not in legal:
                raise ValueError("Illegal action.")
            session.state = game.apply_action(session.state, int(action))
            return {"accepted": True, "state": self._state_payload(session)}

    def analyze(self, session_id: str) -> dict:
        session = self.get_session(session_id)
        game = self.model_registry.game(session.game_id)
        with session.lock:
            logits, value, latent = self.model_registry.evaluate(session.game_id, session.state)
            legal = game.legal_actions(session.state)
            policy = masked_softmax(logits, legal, game.spec.action_size)
            return {
                "value": float(value),
                "policy": policy.tolist(),
                "latent": latent.tolist(),
                "mcts": {
                    "visit_counts": [0] * game.spec.action_size,
                    "q_values": [0.0] * game.spec.action_size,
                    "visit_policy": policy.tolist(),
                },
            }

    def run_ai_move(
        self,
        session_id: str,
        sims: int,
        temperature: float,
        emit_every: int,
        progress_cb: ProgressCallback | None = None,
    ) -> dict:
        session = self.get_session(session_id)
        game = self.model_registry.game(session.game_id)
        with session.lock:
            if session.state.result != "ongoing":
                raise ValueError("Game is already finished.")
            if session.state.to_play == session.human_player:
                raise ValueError("It is not the AI player's turn.")

            run_sims = int(sims) if sims > 0 else session.mcts_sims
            action, _, analysis = run_mcts(
                game=game,
                root_state=session.state,
                evaluate=lambda s: self.model_registry.evaluate(session.game_id, s),
                sims=run_sims,
                c_puct=1.5,
                temp=float(temperature),
                emit_every=int(emit_every),
                progress_cb=progress_cb,
            )
            session.state = game.apply_action(session.state, int(action))
            return {
                "move": {"action": int(action)},
                "state_after": self._state_payload(session),
                "analysis": {
                    "value": float(analysis["root_value"]),
                    "policy": analysis["policy"],
                    "latent": analysis["latent"],
                    "mcts": analysis["mcts"],
                },
            }
