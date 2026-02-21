from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import numpy as np
import torch

from app.core.config import model_root
from app.engine.encoding import encode_state
from app.engine.games.base import Game
from app.engine.games.registry import build_games
from app.engine.model.net import AlphaZeroNet


@dataclass(frozen=True)
class ModelConfig:
    blocks: int
    latent_dim: int = 128
    trunk_ch: int = 64


@dataclass
class LoadedModel:
    net: AlphaZeroNet
    ckpt_path: Path
    lock: Lock


class ModelRegistry:
    def __init__(self, device: str = "cpu") -> None:
        self.games: dict[str, Game] = build_games()
        self.device = torch.device(device if torch.cuda.is_available() and device != "cpu" else "cpu")
        self._models: dict[str, LoadedModel] = {}

        self._config: dict[str, ModelConfig] = {
            "tictactoe": ModelConfig(blocks=4),
            "connect4": ModelConfig(blocks=6),
            "othello": ModelConfig(blocks=8),
        }
        for game_id, game in self.games.items():
            self._models[game_id] = self._load_game_model(game)

    def _checkpoint_path(self, game_id: str) -> Path:
        path = model_root() / game_id / "best.pt"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _new_model(self, game: Game) -> AlphaZeroNet:
        cfg = self._config[game.spec.game_id]
        return AlphaZeroNet(
            h=game.spec.rows,
            w=game.spec.cols,
            action_size=game.spec.action_size,
            blocks=cfg.blocks,
            latent_dim=cfg.latent_dim,
            trunk_ch=cfg.trunk_ch,
        )

    def _load_game_model(self, game: Game) -> LoadedModel:
        ckpt = self._checkpoint_path(game.spec.game_id)
        net = self._new_model(game)
        if ckpt.exists():
            payload = torch.load(ckpt, map_location="cpu")
            state = payload.get("model_state", payload)
            net.load_state_dict(state, strict=False)
        net.to(self.device)
        net.eval()
        return LoadedModel(net=net, ckpt_path=ckpt, lock=Lock())

    def game(self, game_id: str) -> Game:
        game = self.games.get(game_id)
        if game is None:
            raise KeyError(f"Unknown game id: {game_id}")
        return game

    def save_model(self, game_id: str, model: AlphaZeroNet) -> None:
        loaded = self._models[game_id]
        with loaded.lock:
            torch.save({"model_state": model.state_dict()}, loaded.ckpt_path)

    def reload_model(self, game_id: str) -> None:
        game = self.game(game_id)
        loaded = self._load_game_model(game)
        self._models[game_id] = loaded

    def clone_model(self, game_id: str) -> AlphaZeroNet:
        loaded = self._models[game_id]
        game = self.game(game_id)
        clone = self._new_model(game)
        with loaded.lock:
            clone.load_state_dict(loaded.net.state_dict())
        clone.eval()
        return clone

    def evaluate(self, game_id: str, state) -> tuple[np.ndarray, float, np.ndarray]:
        loaded = self._models[game_id]
        game = self.game(game_id)
        x = torch.from_numpy(encode_state(game, state)).unsqueeze(0).to(self.device)
        with loaded.lock:
            loaded.net.eval()
            with torch.no_grad():
                logits, value, latent = loaded.net(x)
        return (
            logits.squeeze(0).detach().cpu().numpy().astype(np.float32),
            float(value.item()),
            latent.squeeze(0).detach().cpu().numpy().astype(np.float32),
        )

    def status(self) -> dict:
        games: dict[str, dict] = {}
        for game_id, loaded in self._models.items():
            games[game_id] = {
                "checkpoint_path": str(loaded.ckpt_path),
                "checkpoint_exists": loaded.ckpt_path.exists(),
            }
        return {
            "device": str(self.device),
            "games": games,
        }
