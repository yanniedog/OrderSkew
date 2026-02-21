from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from app.engine.games.base import Game
from app.engine.math_utils import masked_softmax, normalize_probs
from app.engine.types import GameState


EvaluateFn = Callable[[GameState], tuple[np.ndarray, float, np.ndarray]]
ProgressFn = Callable[[int, int, dict], None]


@dataclass
class Node:
    prior: float
    to_play: int
    N: int = 0
    W: float = 0.0
    Q: float = 0.5
    children: dict[int, "Node"] = field(default_factory=dict)
    is_expanded: bool = False

    def expand(self, legal_actions: list[int], priors: np.ndarray) -> None:
        self.children = {}
        next_player = -self.to_play
        for action in legal_actions:
            self.children[action] = Node(prior=float(priors[action]), to_play=next_player)
        self.is_expanded = True


def _dirichlet_alpha(game_id: str) -> float:
    if game_id == "othello":
        return 0.15
    return 0.3


def _add_dirichlet_noise(
    probs: np.ndarray, legal_actions: list[int], eps: float, alpha: float
) -> np.ndarray:
    if not legal_actions:
        return probs
    noise = np.random.dirichlet([alpha] * len(legal_actions)).astype(np.float32)
    out = probs.copy()
    for i, action in enumerate(legal_actions):
        out[action] = (1.0 - eps) * probs[action] + eps * noise[i]
    return normalize_probs(out)


def _select_child(node: Node, c_puct: float) -> tuple[int, Node]:
    best_action = -1
    best_child: Node | None = None
    best_score = -1e18
    parent_visits = max(1, node.N)
    for action, child in node.children.items():
        q_parent = 1.0 - child.Q
        u = c_puct * child.prior * (np.sqrt(parent_visits) / (1 + child.N))
        score = q_parent + u
        if score > best_score:
            best_score = score
            best_action = action
            best_child = child
    if best_child is None:
        raise RuntimeError("No child selected in MCTS.")
    return best_action, best_child


def _visit_counts(root: Node, action_size: int) -> np.ndarray:
    counts = np.zeros((action_size,), dtype=np.float32)
    for action, child in root.children.items():
        counts[action] = float(child.N)
    return counts


def _q_values(root: Node, action_size: int) -> np.ndarray:
    q = np.zeros((action_size,), dtype=np.float32)
    for action, child in root.children.items():
        q[action] = float(1.0 - child.Q)
    return q


def _visit_policy(root: Node, action_size: int, legal: list[int], temp: float) -> np.ndarray:
    counts = _visit_counts(root, action_size)
    if not legal:
        return counts
    if temp <= 1e-8:
        policy = np.zeros_like(counts)
        best = int(np.argmax(counts))
        policy[best] = 1.0
        return policy
    scaled = np.zeros_like(counts)
    for action in legal:
        scaled[action] = counts[action] ** (1.0 / temp)
    return normalize_probs(scaled)


def run_mcts(
    game: Game,
    root_state: GameState,
    evaluate: EvaluateFn,
    sims: int,
    c_puct: float = 1.5,
    temp: float = 0.0,
    dirichlet_eps: float = 0.25,
    emit_every: int = 0,
    progress_cb: ProgressFn | None = None,
) -> tuple[int, np.ndarray, dict]:
    action_size = game.spec.action_size
    root = Node(prior=1.0, to_play=root_state.to_play)

    root_logits, root_value, root_latent = evaluate(root_state)
    legal_root = game.legal_actions(root_state)
    root_net_policy = masked_softmax(root_logits, legal_root, action_size)
    noisy_priors = _add_dirichlet_noise(
        root_net_policy,
        legal_root,
        eps=dirichlet_eps,
        alpha=_dirichlet_alpha(game.spec.game_id),
    )
    root.expand(legal_root, noisy_priors)

    for sim in range(1, sims + 1):
        node = root
        state = game.clone(root_state)
        path = [node]

        while node.is_expanded and not game.is_terminal(state) and node.children:
            action, node = _select_child(node, c_puct)
            state = game.apply_action(state, action)
            path.append(node)

        if game.is_terminal(state):
            leaf_v = game.terminal_value(state, perspective=state.to_play)
        else:
            logits, leaf_v, _ = evaluate(state)
            legal = game.legal_actions(state)
            priors = masked_softmax(logits, legal, action_size)
            node.expand(legal, priors)

        v = float(leaf_v)
        for step_node in reversed(path):
            step_node.N += 1
            step_node.W += v
            step_node.Q = step_node.W / step_node.N
            v = 1.0 - v

        if progress_cb and emit_every > 0 and sim % emit_every == 0:
            live_counts = _visit_counts(root, action_size)
            live_total = float(live_counts.sum())
            live_pi = (live_counts / live_total).astype(np.float32) if live_total > 0 else live_counts
            progress_cb(
                sim,
                sims,
                {
                    "value": float(root_value),
                    "policy": root_net_policy.tolist(),
                    "latent": root_latent.tolist(),
                    "mcts": {
                        "visit_counts": live_counts.astype(np.int32).tolist(),
                        "q_values": _q_values(root, action_size).tolist(),
                        "visit_policy": live_pi.tolist(),
                    },
                },
            )

    pi = _visit_policy(root, action_size, legal_root, temp)
    best_action = int(np.argmax(pi))
    analysis = {
        "root_value": float(root_value),
        "policy": root_net_policy.tolist(),
        "latent": root_latent.tolist(),
        "mcts": {
            "visit_counts": _visit_counts(root, action_size).astype(np.int32).tolist(),
            "q_values": _q_values(root, action_size).tolist(),
            "visit_policy": pi.tolist(),
        },
    }
    return best_action, pi, analysis

