from __future__ import annotations

import numpy as np

from app.engine.games.base import Game
from app.engine.types import GameSpec, GameState


class TicTacToeGame(Game):
    def __init__(self) -> None:
        self.spec = GameSpec(
            game_id="tictactoe",
            rows=3,
            cols=3,
            action_size=9,
            symmetry="rotations_and_mirrors",
        )

    def initial_state(self) -> GameState:
        return GameState(
            game_id=self.spec.game_id,
            board=np.zeros((3, 3), dtype=np.int8),
            to_play=1,
            ply=0,
            pass_count=0,
            result="ongoing",
        )

    def legal_actions(self, state: GameState) -> list[int]:
        if state.result != "ongoing":
            return []
        actions: list[int] = []
        for r in range(3):
            for c in range(3):
                if state.board[r, c] == 0:
                    actions.append(r * 3 + c)
        return actions

    def _winner(self, board: np.ndarray) -> int:
        for i in range(3):
            row_sum = int(board[i, :].sum())
            col_sum = int(board[:, i].sum())
            if row_sum == 3 or col_sum == 3:
                return 1
            if row_sum == -3 or col_sum == -3:
                return -1
        d1 = int(board[0, 0] + board[1, 1] + board[2, 2])
        d2 = int(board[0, 2] + board[1, 1] + board[2, 0])
        if d1 == 3 or d2 == 3:
            return 1
        if d1 == -3 or d2 == -3:
            return -1
        return 0

    def apply_action(self, state: GameState, action: int) -> GameState:
        if state.result != "ongoing":
            raise ValueError("Cannot play move on terminal state.")
        if action < 0 or action >= 9:
            raise ValueError("Action out of bounds.")
        r, c = divmod(action, 3)
        if state.board[r, c] != 0:
            raise ValueError("Illegal move: target cell occupied.")

        next_state = state.clone()
        next_state.board[r, c] = state.to_play
        next_state.to_play = -state.to_play
        next_state.ply = state.ply + 1

        winner = self._winner(next_state.board)
        if winner == 1:
            next_state.result = "p1_win"
        elif winner == -1:
            next_state.result = "p2_win"
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
        if action < 0 or action >= 9:
            return None
        return divmod(action, 3)

