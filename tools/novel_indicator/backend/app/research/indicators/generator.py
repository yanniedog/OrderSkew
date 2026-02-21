from __future__ import annotations

import random
from dataclasses import replace

from app.research.indicators.dsl import (
    AdaptiveSmoothNode,
    BinaryNode,
    ConstNode,
    FieldNode,
    Node,
    RollingNode,
    UnaryNode,
)
from app.research.search.candidate import CandidateIndicator


FIELDS = ["open", "high", "low", "close", "volume", "hlc3", "ohlc4", "logret", "range"]
UNARY_OPS = ["abs", "neg", "log1p_abs", "sqrt_abs", "tanh", "sign"]
BINARY_OPS = ["add", "sub", "mul", "div", "max", "min"]
ROLLING_OPS = ["sma", "ema", "std", "min", "max"]
WINDOWS = [3, 5, 8, 13, 21, 34, 55]


class IndicatorGenerator:
    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)

    def generate_pool(self, size: int, max_depth: int = 4) -> list[CandidateIndicator]:
        pool: list[CandidateIndicator] = []
        for i in range(size):
            root = self._build_random_node(depth=0, max_depth=max_depth)
            pool.append(
                CandidateIndicator(
                    indicator_id=f"cand_{i:04d}",
                    root=root,
                    complexity=root.complexity(),
                )
            )
        return pool

    def mutate(self, candidate: CandidateIndicator, trial_id: int) -> CandidateIndicator:
        mutated_root = self._mutate_node(candidate.root, p=0.33)
        return CandidateIndicator(
            indicator_id=f"{candidate.indicator_id}_m{trial_id}",
            root=mutated_root,
            complexity=mutated_root.complexity(),
            params={"trial": trial_id},
        )

    def _build_random_node(self, depth: int, max_depth: int) -> Node:
        if depth >= max_depth:
            return self._leaf()

        roll = self.rng.random()
        if roll < 0.25:
            return self._leaf()
        if roll < 0.45:
            return UnaryNode(op=self.rng.choice(UNARY_OPS), child=self._build_random_node(depth + 1, max_depth))
        if roll < 0.75:
            return BinaryNode(
                op=self.rng.choice(BINARY_OPS),
                left=self._build_random_node(depth + 1, max_depth),
                right=self._build_random_node(depth + 1, max_depth),
            )
        if roll < 0.93:
            return RollingNode(
                op=self.rng.choice(ROLLING_OPS),
                child=self._build_random_node(depth + 1, max_depth),
                window=self.rng.choice(WINDOWS),
            )
        return AdaptiveSmoothNode(
            child=self._build_random_node(depth + 1, max_depth),
            fast=self.rng.choice([2, 3, 5, 8]),
            slow=self.rng.choice([13, 21, 34]),
        )

    def _leaf(self) -> Node:
        if self.rng.random() < 0.82:
            return FieldNode(name=self.rng.choice(FIELDS))
        return ConstNode(value=round(self.rng.uniform(-2.0, 2.0), 4))

    def _mutate_node(self, node: Node, p: float) -> Node:
        if self.rng.random() < p:
            if isinstance(node, ConstNode):
                return ConstNode(value=round(node.value + self.rng.uniform(-0.35, 0.35), 4))
            if isinstance(node, RollingNode):
                window = max(2, min(89, node.window + self.rng.choice([-5, -3, -1, 1, 3, 5])))
                return replace(node, window=window)
            if isinstance(node, AdaptiveSmoothNode):
                fast = max(2, min(12, node.fast + self.rng.choice([-1, 1, 2])))
                slow = max(fast + 1, min(55, node.slow + self.rng.choice([-5, -3, 3, 5])))
                return AdaptiveSmoothNode(node.child, fast=fast, slow=slow)

        if isinstance(node, UnaryNode):
            return UnaryNode(node.op, self._mutate_node(node.child, p))
        if isinstance(node, BinaryNode):
            return BinaryNode(node.op, self._mutate_node(node.left, p), self._mutate_node(node.right, p))
        if isinstance(node, RollingNode):
            return RollingNode(node.op, self._mutate_node(node.child, p), node.window)
        if isinstance(node, AdaptiveSmoothNode):
            return AdaptiveSmoothNode(self._mutate_node(node.child, p), node.fast, node.slow)
        return node
