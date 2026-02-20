from __future__ import annotations

import numpy as np

from app.engine.games.connect4 import Connect4Game
from app.engine.games.othello import OthelloGame
from app.engine.games.tictactoe import TicTacToeGame


def test_tictactoe_row_win() -> None:
    game = TicTacToeGame()
    state = game.initial_state()
    for action in [0, 3, 1, 4, 2]:
        state = game.apply_action(state, action)
    assert state.result == "p1_win"


def test_tictactoe_draw() -> None:
    game = TicTacToeGame()
    state = game.initial_state()
    for action in [0, 1, 2, 4, 3, 5, 7, 6, 8]:
        state = game.apply_action(state, action)
    assert state.result == "draw"


def test_connect4_vertical_win() -> None:
    game = Connect4Game()
    state = game.initial_state()
    for action in [0, 1, 0, 1, 0, 1, 0]:
        state = game.apply_action(state, action)
    assert state.result == "p1_win"


def test_othello_opening_legal_moves() -> None:
    game = OthelloGame()
    state = game.initial_state()
    legal = sorted(game.legal_actions(state))
    assert legal == [19, 26, 37, 44]


def test_othello_forced_pass_terminal_after_double_pass() -> None:
    game = OthelloGame()
    state = game.initial_state()
    state.board = np.ones((8, 8), dtype=np.int8)
    state.board[0, 0] = -1
    state.board[0, 1] = 0
    state.to_play = -1
    state.result = "ongoing"
    legal = game.legal_actions(state)
    assert legal == [64]
    state = game.apply_action(state, 64)
    legal2 = game.legal_actions(state)
    assert legal2 == [64]
    state = game.apply_action(state, 64)
    assert state.result in {"p1_win", "p2_win", "draw"}
