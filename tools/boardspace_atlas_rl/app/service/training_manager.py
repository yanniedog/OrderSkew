from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import torch

from app.core.config import replay_root, repo_root
from app.core.model_registry import ModelRegistry
from app.engine.atlas_seed import load_atlas_seed_samples
from app.engine.encoding import encode_state
from app.engine.replay import ReplayBuffer, ReplayDiskWriter
from app.engine.selfplay import play_selfplay_game
from app.engine.training import arena_win_rate, train_step
from app.engine.types import GameState


@dataclass
class RuntimeConfig:
    game_ids: list[str]
    selfplay_games_per_cycle: int = 1
    train_steps_per_cycle: int = 1
    batch_size: int = 256
    replay_capacity: int = 200_000
    promotion_interval: int = 2000
    promotion_games: int = 200
    promotion_threshold: float = 0.55


class TrainingManager:
    def __init__(self, model_registry: ModelRegistry) -> None:
        self.model_registry = model_registry
        self.running = False
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.status_lock = threading.Lock()
        self.started_at: float | None = None
        self.message: str = "idle"
        self.updates: dict[str, int] = {gid: 0 for gid in self.model_registry.games.keys()}

        self.buffers: dict[str, ReplayBuffer] = {
            gid: ReplayBuffer(capacity=200_000) for gid in self.model_registry.games.keys()
        }
        self.writers: dict[str, ReplayDiskWriter] = {
            gid: ReplayDiskWriter(replay_root(), gid) for gid in self.model_registry.games.keys()
        }

    def _state_evaluator(self, game_id: str, model: torch.nn.Module, device: torch.device):
        game = self.model_registry.game(game_id)

        def _eval(state: GameState):
            x = torch.from_numpy(encode_state(game, state)).unsqueeze(0).to(device)
            with torch.no_grad():
                logits, value, latent = model(x)
            return (
                logits.squeeze(0).cpu().numpy().astype("float32"),
                float(value.item()),
                latent.squeeze(0).cpu().numpy().astype("float32"),
            )

        return _eval

    def _default_selfplay_sims(self, game_id: str) -> int:
        if game_id == "tictactoe":
            return 200
        return 800

    def _seed_from_atlas_once(self, game_ids: list[str]) -> None:
        seeds = load_atlas_seed_samples(repo_root(), {gid: self.model_registry.game(gid) for gid in game_ids})
        for gid in game_ids:
            for sample in seeds.get(gid, []):
                self.buffers[gid].add(sample)
                self.writers[gid].add(sample)

    def _loop(self, cfg: RuntimeConfig) -> None:
        device = torch.device("cpu")
        working_models: dict[str, torch.nn.Module] = {}
        optimizers: dict[str, torch.optim.Optimizer] = {}
        for gid in cfg.game_ids:
            model = self.model_registry.clone_model(gid).to(device)
            model.train()
            working_models[gid] = model
            optimizers[gid] = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)

        self._seed_from_atlas_once(cfg.game_ids)

        while not self.stop_event.is_set():
            for gid in cfg.game_ids:
                if self.stop_event.is_set():
                    break
                game = self.model_registry.game(gid)
                model = working_models[gid]
                evaluator = self._state_evaluator(gid, model, device)

                for _ in range(cfg.selfplay_games_per_cycle):
                    samples = play_selfplay_game(
                        game=game,
                        evaluate=evaluator,
                        sims=self._default_selfplay_sims(gid),
                    )
                    self.buffers[gid].extend(samples)
                    self.writers[gid].extend(samples)

                for _ in range(cfg.train_steps_per_cycle):
                    batch = self.buffers[gid].sample(cfg.batch_size)
                    if len(batch) < max(8, min(cfg.batch_size, 32)):
                        break
                    lam = 0.05 if self.updates[gid] < 100_000 else 0.0
                    metrics = train_step(
                        model=model,
                        optimizer=optimizers[gid],
                        samples=batch,
                        device=device,
                        lambda_atlas=lam,
                    )
                    self.updates[gid] += 1
                    with self.status_lock:
                        self.message = (
                            f"training {gid} | step={self.updates[gid]} "
                            f"loss={metrics.loss_total:.4f} policy={metrics.loss_policy:.4f} "
                            f"value={metrics.loss_value:.4f}"
                        )

                    if self.updates[gid] % cfg.promotion_interval == 0:
                        incumbent = self.model_registry.clone_model(gid).to(device)
                        win_rate = arena_win_rate(
                            game=game,
                            candidate=model,
                            incumbent=incumbent,
                            games=cfg.promotion_games,
                            sims=min(200, self._default_selfplay_sims(gid)),
                            device=device,
                        )
                        if win_rate >= cfg.promotion_threshold:
                            self.model_registry.save_model(gid, model.cpu())
                            self.model_registry.reload_model(gid)
                            model.to(device)
                            with self.status_lock:
                                self.message = f"promoted {gid} checkpoint (win_rate={win_rate:.3f})"
                        else:
                            model.load_state_dict(incumbent.state_dict())
                            model.to(device)
                            with self.status_lock:
                                self.message = f"rejected {gid} checkpoint (win_rate={win_rate:.3f})"

            time.sleep(0.01)

        for writer in self.writers.values():
            writer.flush()

    def start(self, game_ids: list[str], selfplay_games_per_cycle: int, train_steps_per_cycle: int) -> None:
        if self.running:
            return
        valid = [gid for gid in game_ids if gid in self.model_registry.games]
        if not valid:
            valid = list(self.model_registry.games.keys())
        cfg = RuntimeConfig(
            game_ids=valid,
            selfplay_games_per_cycle=selfplay_games_per_cycle,
            train_steps_per_cycle=train_steps_per_cycle,
        )
        self.stop_event.clear()
        self.running = True
        self.started_at = time.time()
        with self.status_lock:
            self.message = "training loop started"
        self.thread = threading.Thread(target=self._loop, args=(cfg,), daemon=True, name="atlas-trainer")
        self.thread.start()

    def stop(self) -> None:
        if not self.running:
            return
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=5.0)
        self.thread = None
        self.running = False
        with self.status_lock:
            self.message = "stopped"

    def status(self) -> dict:
        with self.status_lock:
            return {
                "running": self.running,
                "started_at": self.started_at,
                "updates": dict(self.updates),
                "message": self.message,
            }

