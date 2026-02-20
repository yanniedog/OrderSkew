from __future__ import annotations

import numpy as np

from app.engine.games.tictactoe import TicTacToeGame
from app.engine.mcts import run_mcts


def test_mcts_policy_is_distribution_and_legal() -> None:
    game = TicTacToeGame()
    state = game.initial_state()
    state.board[0, 0] = 1
    state.board[0, 1] = -1
    state.to_play = 1

    def evaluator(_state):
        return np.zeros((9,), dtype=np.float32), 0.5, np.zeros((128,), dtype=np.float32)

    action, pi, analysis = run_mcts(
        game=game,
        root_state=state,
        evaluate=evaluator,
        sims=50,
        c_puct=1.2,
        temp=1.0,
    )
    legal = set(game.legal_actions(state))
    assert action in legal
    assert abs(float(pi.sum()) - 1.0) < 1e-6
    for i in range(len(pi)):
        if i not in legal:
            assert pi[i] == 0.0
    assert "mcts" in analysis and "visit_counts" in analysis["mcts"]

