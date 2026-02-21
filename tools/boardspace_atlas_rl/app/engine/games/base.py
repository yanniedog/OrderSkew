from __future__ import annotations

from abc import ABC, abstractmethod

from app.engine.types import GameSpec, GameState


class Game(ABC):
    spec: GameSpec

    @abstractmethod
    def initial_state(self) -> GameState:
        raise NotImplementedError

    @abstractmethod
    def legal_actions(self, state: GameState) -> list[int]:
        raise NotImplementedError

    @abstractmethod
    def apply_action(self, state: GameState, action: int) -> GameState:
        raise NotImplementedError

    @abstractmethod
    def is_terminal(self, state: GameState) -> bool:
        raise NotImplementedError

    @abstractmethod
    def terminal_value(self, state: GameState, perspective: int) -> float:
        raise NotImplementedError

    @abstractmethod
    def action_to_board_coord(self, state: GameState, action: int) -> tuple[int, int] | None:
        raise NotImplementedError

    def clone(self, state: GameState) -> GameState:
        return state.clone()

