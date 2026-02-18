from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

EPS = 1e-9


class Node(Protocol):
    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray: ...

    def to_expr(self) -> str: ...

    def to_pine(self) -> str: ...

    def signature(self) -> str: ...

    def complexity(self) -> int: ...


@dataclass(frozen=True)
class FieldNode:
    name: str

    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray:
        return ctx[self.name]

    def to_expr(self) -> str:
        return self.name

    def to_pine(self) -> str:
        mapping = {
            "open": "open",
            "high": "high",
            "low": "low",
            "close": "close",
            "volume": "volume",
            "hlc3": "hlc3",
            "ohlc4": "ohlc4",
            "logret": "log(close / close[1])",
            "range": "high - low",
        }
        return mapping.get(self.name, self.name)

    def signature(self) -> str:
        return f"F:{self.name}"

    def complexity(self) -> int:
        return 1


@dataclass(frozen=True)
class ConstNode:
    value: float

    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray:
        template = next(iter(ctx.values()))
        return np.full_like(template, fill_value=float(self.value), dtype=np.float64)

    def to_expr(self) -> str:
        return f"{self.value:.6g}"

    def to_pine(self) -> str:
        return f"{self.value:.6g}"

    def signature(self) -> str:
        return "C"

    def complexity(self) -> int:
        return 1


@dataclass(frozen=True)
class UnaryNode:
    op: str
    child: Node

    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray:
        x = self.child.eval(ctx)
        if self.op == "abs":
            return np.abs(x)
        if self.op == "neg":
            return -x
        if self.op == "log1p_abs":
            return np.log1p(np.abs(x))
        if self.op == "sqrt_abs":
            return np.sqrt(np.abs(x) + EPS)
        if self.op == "tanh":
            return np.tanh(x)
        if self.op == "sign":
            return np.sign(x)
        raise ValueError(f"unknown unary op: {self.op}")

    def to_expr(self) -> str:
        return f"{self.op}({self.child.to_expr()})"

    def to_pine(self) -> str:
        child = self.child.to_pine()
        mapping = {
            "abs": f"math.abs({child})",
            "neg": f"-({child})",
            "log1p_abs": f"math.log(1 + math.abs({child}))",
            "sqrt_abs": f"math.sqrt(math.abs({child}) + {EPS})",
            "tanh": f"math.tanh({child})",
            "sign": f"math.sign({child})",
        }
        if self.op not in mapping:
            raise ValueError(f"unknown unary op: {self.op}")
        return mapping[self.op]

    def signature(self) -> str:
        return f"U:{self.op}({self.child.signature()})"

    def complexity(self) -> int:
        return 1 + self.child.complexity()


@dataclass(frozen=True)
class BinaryNode:
    op: str
    left: Node
    right: Node

    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray:
        a = self.left.eval(ctx)
        b = self.right.eval(ctx)
        if self.op == "add":
            return a + b
        if self.op == "sub":
            return a - b
        if self.op == "mul":
            return a * b
        if self.op == "div":
            return a / (np.abs(b) + EPS)
        if self.op == "max":
            return np.maximum(a, b)
        if self.op == "min":
            return np.minimum(a, b)
        raise ValueError(f"unknown binary op: {self.op}")

    def to_expr(self) -> str:
        return f"{self.op}({self.left.to_expr()},{self.right.to_expr()})"

    def to_pine(self) -> str:
        a = self.left.to_pine()
        b = self.right.to_pine()
        mapping = {
            "add": f"({a}) + ({b})",
            "sub": f"({a}) - ({b})",
            "mul": f"({a}) * ({b})",
            "div": f"({a}) / (math.abs({b}) + {EPS})",
            "max": f"math.max({a}, {b})",
            "min": f"math.min({a}, {b})",
        }
        if self.op not in mapping:
            raise ValueError(f"unknown binary op: {self.op}")
        return mapping[self.op]

    def signature(self) -> str:
        return f"B:{self.op}({self.left.signature()},{self.right.signature()})"

    def complexity(self) -> int:
        return 1 + self.left.complexity() + self.right.complexity()


@dataclass(frozen=True)
class RollingNode:
    op: str
    child: Node
    window: int

    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray:
        x = self.child.eval(ctx)
        if self.op == "sma":
            return rolling_mean(x, self.window)
        if self.op == "ema":
            return ema(x, self.window)
        if self.op == "std":
            return rolling_std(x, self.window)
        if self.op == "min":
            return rolling_min(x, self.window)
        if self.op == "max":
            return rolling_max(x, self.window)
        raise ValueError(f"unknown rolling op: {self.op}")

    def to_expr(self) -> str:
        return f"{self.op}({self.child.to_expr()},{self.window})"

    def to_pine(self) -> str:
        c = self.child.to_pine()
        mapping = {
            "sma": f"ta.sma({c}, {self.window})",
            "ema": f"ta.ema({c}, {self.window})",
            "std": f"ta.stdev({c}, {self.window})",
            "min": f"ta.lowest({c}, {self.window})",
            "max": f"ta.highest({c}, {self.window})",
        }
        if self.op not in mapping:
            raise ValueError(f"unknown rolling op: {self.op}")
        return mapping[self.op]

    def signature(self) -> str:
        return f"R:{self.op}:{self.window}({self.child.signature()})"

    def complexity(self) -> int:
        return 1 + self.child.complexity()


@dataclass(frozen=True)
class AdaptiveSmoothNode:
    child: Node
    fast: int
    slow: int

    def eval(self, ctx: dict[str, np.ndarray]) -> np.ndarray:
        x = self.child.eval(ctx)
        return adaptive_smooth(x, self.fast, self.slow)

    def to_expr(self) -> str:
        return f"adaptive({self.child.to_expr()},{self.fast},{self.slow})"

    def to_pine(self) -> str:
        c = self.child.to_pine()
        # TradingView has ta.kama; use a simple equivalent adaptive smoothing for deterministic portability.
        return f"ta.kama({c}, {self.fast})"

    def signature(self) -> str:
        return f"A:{self.fast}:{self.slow}({self.child.signature()})"

    def complexity(self) -> int:
        return 1 + self.child.complexity()


def rolling_mean(x: np.ndarray, window: int) -> np.ndarray:
    out = np.full_like(x, np.nan, dtype=np.float64)
    if window <= 1:
        return x.astype(np.float64)
    csum = np.cumsum(np.insert(x.astype(np.float64), 0, 0.0))
    out[window - 1 :] = (csum[window:] - csum[:-window]) / float(window)
    return out


def rolling_std(x: np.ndarray, window: int) -> np.ndarray:
    out = np.full_like(x, np.nan, dtype=np.float64)
    if window <= 1:
        return np.zeros_like(x, dtype=np.float64)
    for i in range(window - 1, len(x)):
        segment = x[i - window + 1 : i + 1]
        out[i] = float(np.std(segment))
    return out


def rolling_min(x: np.ndarray, window: int) -> np.ndarray:
    out = np.full_like(x, np.nan, dtype=np.float64)
    for i in range(window - 1, len(x)):
        out[i] = float(np.min(x[i - window + 1 : i + 1]))
    return out


def rolling_max(x: np.ndarray, window: int) -> np.ndarray:
    out = np.full_like(x, np.nan, dtype=np.float64)
    for i in range(window - 1, len(x)):
        out[i] = float(np.max(x[i - window + 1 : i + 1]))
    return out


def ema(x: np.ndarray, window: int) -> np.ndarray:
    alpha = 2.0 / (window + 1.0)
    out = np.full_like(x, np.nan, dtype=np.float64)
    if len(x) == 0:
        return out
    out[0] = float(x[0])
    for i in range(1, len(x)):
        out[i] = alpha * float(x[i]) + (1.0 - alpha) * out[i - 1]
    return out


def adaptive_smooth(x: np.ndarray, fast: int, slow: int) -> np.ndarray:
    out = np.full_like(x, np.nan, dtype=np.float64)
    if len(x) == 0:
        return out
    out[0] = float(x[0])
    fast_alpha = 2.0 / (fast + 1.0)
    slow_alpha = 2.0 / (slow + 1.0)
    for i in range(1, len(x)):
        delta = abs(float(x[i]) - float(x[i - 1]))
        norm = delta / (abs(float(x[i - 1])) + EPS)
        alpha = slow_alpha + min(1.0, norm) * (fast_alpha - slow_alpha)
        out[i] = out[i - 1] + alpha * (float(x[i]) - out[i - 1])
    return out


def sanitize_series(x: np.ndarray) -> np.ndarray:
    y = np.asarray(x, dtype=np.float64)
    if np.isnan(y).all():
        return np.zeros_like(y)
    nan_mask = np.isnan(y)
    if nan_mask.any():
        valid_idx = np.where(~nan_mask)[0]
        if len(valid_idx) == 0:
            return np.zeros_like(y)
        y[: valid_idx[0]] = y[valid_idx[0]]
        for i in range(valid_idx[0] + 1, len(y)):
            if np.isnan(y[i]):
                y[i] = y[i - 1]
    y[np.isinf(y)] = 0.0
    return y
