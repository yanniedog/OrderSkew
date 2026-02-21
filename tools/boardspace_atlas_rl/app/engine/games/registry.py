from __future__ import annotations

from app.engine.games.base import Game
from app.engine.games.connect4 import Connect4Game
from app.engine.games.othello import OthelloGame
from app.engine.games.tictactoe import TicTacToeGame


def build_games() -> dict[str, Game]:
    games: list[Game] = [TicTacToeGame(), Connect4Game(), OthelloGame()]
    return {g.spec.game_id: g for g in games}

