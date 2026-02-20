from __future__ import annotations

import numpy as np

from app.engine.games.base import Game
from app.engine.types import GameState


def encode_state(game: Game, state: GameState) -> np.ndarray:
    rows, cols = game.spec.rows, game.spec.cols
    planes = np.zeros((5, rows, cols), dtype=np.float32)

    board = state.board
    to_play = state.to_play
    planes[0] = (board == to_play).astype(np.float32)
    planes[1] = (board == -to_play).astype(np.float32)

    legal = game.legal_actions(state)
    for action in legal:
        coord = game.action_to_board_coord(state, action)
        if coord is None:
            continue
        r, c = coord
        if 0 <= r < rows and 0 <= c < cols:
            planes[2, r, c] = 1.0

    planes[3].fill(1.0 if state.to_play == 1 else 0.0)

    if game.spec.pass_action is not None and game.spec.pass_action in legal:
        planes[4].fill(1.0)
    else:
        planes[4].fill(0.0)

    return planes


def legal_policy_mask(game: Game, state: GameState) -> np.ndarray:
    mask = np.zeros((game.spec.action_size,), dtype=np.float32)
    for action in game.legal_actions(state):
        if 0 <= action < game.spec.action_size:
            mask[action] = 1.0
    return mask

