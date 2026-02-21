from __future__ import annotations

from typing import Callable

import numpy as np

from app.engine.encoding import encode_state
from app.engine.games.base import Game
from app.engine.mcts import run_mcts
from app.engine.replay import ReplaySample
from app.engine.types import GameState


EvalFn = Callable[[GameState], tuple[np.ndarray, float, np.ndarray]]


def _outcome_to_z(result: str, to_play: int) -> float:
    if result == "draw":
        return 0.5
    if result == "p1_win":
        return 1.0 if to_play == 1 else 0.0
    if result == "p2_win":
        return 1.0 if to_play == -1 else 0.0
    raise ValueError(f"Unexpected result value: {result}")


def play_selfplay_game(
    game: Game,
    evaluate: EvalFn,
    sims: int = 200,
    c_puct: float = 1.5,
) -> list[ReplaySample]:
    state = game.initial_state()
    trajectory: list[tuple[GameState, np.ndarray, int]] = []

    while state.result == "ongoing":
        temperature = 1.0 if state.ply < 8 else 0.0
        action, pi, _ = run_mcts(
            game=game,
            root_state=state,
            evaluate=evaluate,
            sims=sims,
            c_puct=c_puct,
            temp=temperature,
        )
        trajectory.append((state.clone(), pi.copy(), state.to_play))
        if temperature > 1e-8 and pi.sum() > 0:
            action = int(np.random.choice(np.arange(len(pi)), p=pi))
        state = game.apply_action(state, action)

    samples: list[ReplaySample] = []
    for src_state, pi, to_play in trajectory:
        z = _outcome_to_z(state.result, to_play)
        samples.append(
            ReplaySample(
                game_id=game.spec.game_id,
                state_planes=encode_state(game, src_state),
                target_pi=pi.astype(np.float32),
                target_z=float(z),
                ply=src_state.ply,
                source="selfplay",
            )
        )
    return samples

