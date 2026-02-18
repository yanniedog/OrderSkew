from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class RidgeForecaster:
    alpha: float = 1.0
    coef_: np.ndarray | None = None

    def fit(self, x: np.ndarray, y: np.ndarray) -> "RidgeForecaster":
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        if x.ndim != 2:
            raise ValueError("x must be 2D")

        x_aug = np.hstack([np.ones((x.shape[0], 1)), x])
        identity = np.eye(x_aug.shape[1])
        identity[0, 0] = 0.0
        gram = x_aug.T @ x_aug + self.alpha * identity
        target = x_aug.T @ y
        self.coef_ = np.linalg.solve(gram, target)
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.coef_ is None:
            raise RuntimeError("model is not fit")
        x = np.asarray(x, dtype=np.float64)
        x_aug = np.hstack([np.ones((x.shape[0], 1)), x])
        return x_aug @ self.coef_


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred)))
