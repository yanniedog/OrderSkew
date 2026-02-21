from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F

from app.engine.games.base import Game
from app.engine.mcts import run_mcts
from app.engine.replay import ReplaySample
from app.engine.types import GameState


@dataclass
class TrainMetrics:
    loss_total: float
    loss_policy: float
    loss_value: float
    loss_atlas: float


def build_batch(samples: list[ReplaySample]) -> dict[str, torch.Tensor]:
    states = torch.from_numpy(np.stack([s.state_planes for s in samples], axis=0)).float()
    pi = torch.from_numpy(np.stack([s.target_pi for s in samples], axis=0)).float()
    z = torch.from_numpy(np.array([s.target_z for s in samples], dtype=np.float32))

    atlas = np.stack(
        [s.atlas_target if s.atlas_target is not None else np.full((8,), np.nan, dtype=np.float32) for s in samples],
        axis=0,
    ).astype(np.float32)
    atlas_t = torch.from_numpy(atlas).float()
    atlas_mask = ~torch.isnan(atlas_t).any(dim=1)
    atlas_t = torch.nan_to_num(atlas_t, nan=0.0)
    return {"states": states, "target_pi": pi, "target_z": z, "atlas_target": atlas_t, "atlas_mask": atlas_mask}


def train_step(
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    samples: list[ReplaySample],
    device: torch.device,
    lambda_atlas: float,
) -> TrainMetrics:
    model.train()
    batch = build_batch(samples)
    states = batch["states"].to(device)
    target_pi = batch["target_pi"].to(device)
    target_z = batch["target_z"].to(device)
    atlas_target = batch["atlas_target"].to(device)
    atlas_mask = batch["atlas_mask"].to(device)

    logits, value, _, atlas_pred = model.forward_with_atlas(states)
    loss_policy = -(target_pi * F.log_softmax(logits, dim=1)).sum(dim=1).mean()
    loss_value = F.mse_loss(value, target_z)

    if atlas_mask.any():
        loss_atlas = F.mse_loss(atlas_pred[atlas_mask], atlas_target[atlas_mask])
    else:
        loss_atlas = torch.zeros((), device=device)

    total = loss_policy + loss_value + lambda_atlas * loss_atlas
    optimizer.zero_grad(set_to_none=True)
    total.backward()
    optimizer.step()

    return TrainMetrics(
        loss_total=float(total.item()),
        loss_policy=float(loss_policy.item()),
        loss_value=float(loss_value.item()),
        loss_atlas=float(loss_atlas.item()),
    )


def _evaluator_from_model(
    model: torch.nn.Module,
    game: Game,
    device: torch.device,
):
    from app.engine.encoding import encode_state

    def _eval(state: GameState) -> tuple[np.ndarray, float, np.ndarray]:
        x = torch.from_numpy(encode_state(game, state)).unsqueeze(0).to(device)
        with torch.no_grad():
            logits, value, latent = model(x)
        return (
            logits.squeeze(0).cpu().numpy().astype(np.float32),
            float(value.item()),
            latent.squeeze(0).cpu().numpy().astype(np.float32),
        )

    return _eval


def _play_arena_game(game: Game, model_p1: torch.nn.Module, model_p2: torch.nn.Module, sims: int, device: torch.device) -> str:
    state = game.initial_state()
    eval_p1 = _evaluator_from_model(model_p1, game, device)
    eval_p2 = _evaluator_from_model(model_p2, game, device)

    while state.result == "ongoing":
        evaluator = eval_p1 if state.to_play == 1 else eval_p2
        action, _, _ = run_mcts(
            game=game,
            root_state=state,
            evaluate=evaluator,
            sims=sims,
            c_puct=1.5,
            temp=0.0,
            dirichlet_eps=0.0,
        )
        state = game.apply_action(state, action)
    return state.result


def arena_win_rate(
    game: Game,
    candidate: torch.nn.Module,
    incumbent: torch.nn.Module,
    games: int = 200,
    sims: int = 200,
    device: torch.device | None = None,
) -> float:
    dev = device or torch.device("cpu")
    candidate.eval()
    incumbent.eval()
    points = 0.0
    for i in range(games):
        if i % 2 == 0:
            result = _play_arena_game(game, candidate, incumbent, sims=sims, device=dev)
            if result == "p1_win":
                points += 1.0
            elif result == "draw":
                points += 0.5
        else:
            result = _play_arena_game(game, incumbent, candidate, sims=sims, device=dev)
            if result == "p2_win":
                points += 1.0
            elif result == "draw":
                points += 0.5
    return points / games

