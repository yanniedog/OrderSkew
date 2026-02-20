from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np


ResultType = Literal["ongoing", "p1_win", "p2_win", "draw"]


@dataclass(frozen=True)
class GameSpec:
    game_id: Literal["tictactoe", "connect4", "othello"]
    rows: int
    cols: int
    action_size: int
    symmetry: str
    pass_action: int | None = None


@dataclass
class GameState:
    game_id: Literal["tictactoe", "connect4", "othello"]
    board: np.ndarray
    to_play: int
    ply: int
    pass_count: int = 0
    result: ResultType = "ongoing"

    def clone(self) -> "GameState":
        return GameState(
            game_id=self.game_id,
            board=self.board.copy(),
            to_play=int(self.to_play),
            ply=int(self.ply),
            pass_count=int(self.pass_count),
            result=self.result,
        )

