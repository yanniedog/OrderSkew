from __future__ import annotations

import numpy as np


def masked_softmax(logits: np.ndarray, legal_actions: list[int], action_size: int) -> np.ndarray:
    probs = np.zeros((action_size,), dtype=np.float32)
    if not legal_actions:
        return probs
    legal_logits = np.array([logits[a] for a in legal_actions], dtype=np.float64)
    legal_logits = legal_logits - legal_logits.max()
    exp = np.exp(legal_logits)
    denom = exp.sum()
    if denom <= 0:
        uniform = 1.0 / len(legal_actions)
        for a in legal_actions:
            probs[a] = uniform
        return probs
    soft = exp / denom
    for i, action in enumerate(legal_actions):
        probs[action] = float(soft[i])
    return probs


def normalize_probs(p: np.ndarray) -> np.ndarray:
    total = float(p.sum())
    if total <= 0:
        return np.zeros_like(p)
    return (p / total).astype(np.float32)

