from __future__ import annotations

import numpy as np

from app.engine.encoding import encode_state, legal_policy_mask
from app.engine.games.connect4 import Connect4Game
from app.engine.games.tictactoe import TicTacToeGame


def test_tictactoe_encoding_shape_and_legal_plane() -> None:
    game = TicTacToeGame()
    state = game.initial_state()
    state.board[0, 0] = 1
    state.board[1, 1] = -1
    state.to_play = 1
    x = encode_state(game, state)
    assert x.shape == (5, 3, 3)
    assert x[0, 0, 0] == 1.0
    assert x[1, 1, 1] == 1.0
    assert x[2].sum() == 7.0


def test_connect4_policy_mask_roundtrip() -> None:
    game = Connect4Game()
    state = game.initial_state()
    state.board[:, 0] = np.array([1, -1, 1, -1, 1, -1], dtype=np.int8)
    mask = legal_policy_mask(game, state)
    assert mask.shape == (7,)
    assert mask[0] == 0.0
    assert mask[1:].sum() == 6.0

