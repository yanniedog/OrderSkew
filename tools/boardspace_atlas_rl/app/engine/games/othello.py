from __future__ import annotations

import numpy as np

from app.engine.games.base import Game
from app.engine.types import GameSpec, GameState


class OthelloGame(Game):
    SIZE = 8
    PASS_ACTION = 64

    def __init__(self) -> None:
        self.spec = GameSpec(
            game_id="othello",
            rows=self.SIZE,
            cols=self.SIZE,
            action_size=65,
            symmetry="rotations_and_mirrors",
            pass_action=self.PASS_ACTION,
        )

    def initial_state(self) -> GameState:
        board = np.zeros((self.SIZE, self.SIZE), dtype=np.int8)
        board[3, 3] = -1
        board[3, 4] = 1
        board[4, 3] = 1
        board[4, 4] = -1
        return GameState(
            game_id=self.spec.game_id,
            board=board,
            to_play=1,
            ply=0,
            pass_count=0,
            result="ongoing",
        )

    def _in_bounds(self, r: int, c: int) -> bool:
        return 0 <= r < self.SIZE and 0 <= c < self.SIZE

    def _collect_flips(self, board: np.ndarray, row: int, col: int, player: int) -> list[tuple[int, int]]:
        if board[row, col] != 0:
            return []
        opponent = -player
        flips: list[tuple[int, int]] = []
        dirs = (
            (-1, -1),
            (-1, 0),
            (-1, 1),
            (0, -1),
            (0, 1),
            (1, -1),
            (1, 0),
            (1, 1),
        )
        for dr, dc in dirs:
            line: list[tuple[int, int]] = []
            rr, cc = row + dr, col + dc
            while self._in_bounds(rr, cc) and board[rr, cc] == opponent:
                line.append((rr, cc))
                rr += dr
                cc += dc
            if line and self._in_bounds(rr, cc) and board[rr, cc] == player:
                flips.extend(line)
        return flips

    def _board_legal_actions(self, board: np.ndarray, player: int) -> list[int]:
        actions: list[int] = []
        for r in range(self.SIZE):
            for c in range(self.SIZE):
                if self._collect_flips(board, r, c, player):
                    actions.append(r * self.SIZE + c)
        return actions

    def _result_from_counts(self, board: np.ndarray) -> str:
        p1 = int((board == 1).sum())
        p2 = int((board == -1).sum())
        if p1 == p2:
            return "draw"
        return "p1_win" if p1 > p2 else "p2_win"

    def legal_actions(self, state: GameState) -> list[int]:
        if state.result != "ongoing":
            return []
        moves = self._board_legal_actions(state.board, state.to_play)
        if moves:
            return moves
        return [self.PASS_ACTION]

    def apply_action(self, state: GameState, action: int) -> GameState:
        if state.result != "ongoing":
            raise ValueError("Cannot play move on terminal state.")

        legal = self.legal_actions(state)
        if action not in legal:
            raise ValueError("Illegal action for current Othello position.")

        next_state = state.clone()
        next_state.ply = state.ply + 1

        if action == self.PASS_ACTION:
            next_state.to_play = -state.to_play
            next_state.pass_count = state.pass_count + 1
            if next_state.pass_count >= 2 or not np.any(next_state.board == 0):
                next_state.result = self._result_from_counts(next_state.board)
            else:
                next_state.result = "ongoing"
            return next_state

        row, col = divmod(action, self.SIZE)
        flips = self._collect_flips(next_state.board, row, col, state.to_play)
        next_state.board[row, col] = state.to_play
        for rr, cc in flips:
            next_state.board[rr, cc] = state.to_play
        next_state.to_play = -state.to_play
        next_state.pass_count = 0

        if not np.any(next_state.board == 0):
            next_state.result = self._result_from_counts(next_state.board)
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
        if action == self.PASS_ACTION:
            return None
        if action < 0 or action >= 64:
            return None
        return divmod(action, self.SIZE)

