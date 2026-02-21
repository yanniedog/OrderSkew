from __future__ import annotations

import numpy as np

from app.engine.games.base import Game
from app.engine.types import GameSpec, GameState


class Connect4Game(Game):
    ROWS = 6
    COLS = 7

    def __init__(self) -> None:
        self.spec = GameSpec(
            game_id="connect4",
            rows=self.ROWS,
            cols=self.COLS,
            action_size=self.COLS,
            symmetry="mirror_lr_only",
        )

    def initial_state(self) -> GameState:
        return GameState(
            game_id=self.spec.game_id,
            board=np.zeros((self.ROWS, self.COLS), dtype=np.int8),
            to_play=1,
            ply=0,
            pass_count=0,
            result="ongoing",
        )

    def legal_actions(self, state: GameState) -> list[int]:
        if state.result != "ongoing":
            return []
        return [c for c in range(self.COLS) if state.board[0, c] == 0]

    def _landing_row(self, board: np.ndarray, col: int) -> int:
        for r in range(self.ROWS - 1, -1, -1):
            if board[r, col] == 0:
                return r
        return -1

    def _has_connect4(self, board: np.ndarray, row: int, col: int, player: int) -> bool:
        directions = ((0, 1), (1, 0), (1, 1), (1, -1))
        for dr, dc in directions:
            count = 1
            for sign in (-1, 1):
                rr, cc = row + sign * dr, col + sign * dc
                while 0 <= rr < self.ROWS and 0 <= cc < self.COLS and board[rr, cc] == player:
                    count += 1
                    rr += sign * dr
                    cc += sign * dc
            if count >= 4:
                return True
        return False

    def apply_action(self, state: GameState, action: int) -> GameState:
        if state.result != "ongoing":
            raise ValueError("Cannot play move on terminal state.")
        if action < 0 or action >= self.COLS:
            raise ValueError("Action out of bounds.")
        row = self._landing_row(state.board, action)
        if row < 0:
            raise ValueError("Illegal move: column is full.")

        next_state = state.clone()
        next_state.board[row, action] = state.to_play
        next_state.to_play = -state.to_play
        next_state.ply = state.ply + 1

        if self._has_connect4(next_state.board, row, action, state.to_play):
            next_state.result = "p1_win" if state.to_play == 1 else "p2_win"
        elif not np.any(next_state.board == 0):
            next_state.result = "draw"
        else:
            next_state.result = "ongoing"
        return next_state

    def is_terminal(self, state: GameState) -> bool:
        return state.result != "ongoing"

    def terminal_value(self, state: GameState, perspective: int) -> float:
        if state.result == "draw":
            return 0.5
        if state.result == "p1_win":
            return 1.0 if perspective == 1 else 0.0
        if state.result == "p2_win":
            return 1.0 if perspective == -1 else 0.0
        raise ValueError("terminal_value called on non-terminal state")

    def action_to_board_coord(self, state: GameState, action: int) -> tuple[int, int] | None:
        if action < 0 or action >= self.COLS:
            return None
        row = self._landing_row(state.board, action)
        if row < 0:
            return 0, action
        return row, action

