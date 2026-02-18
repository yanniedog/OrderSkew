from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Fold:
    train_idx: np.ndarray
    val_idx: np.ndarray


class LeakageError(RuntimeError):
    pass


def build_purged_walk_forward_folds(
    n_rows: int,
    folds: int,
    max_horizon: int,
    purge_bars: int,
    embargo_bars: int,
) -> list[Fold]:
    if n_rows < 500:
        raise ValueError("Insufficient rows for robust walk-forward CV; need at least 500 rows")

    usable_end = n_rows - max_horizon - 1
    if usable_end <= 0:
        raise ValueError("No usable rows after horizon truncation")

    chunk = usable_end // (folds + 1)
    if chunk < 100:
        raise ValueError("Insufficient rows per fold")

    generated: list[Fold] = []
    for i in range(folds):
        train_end = chunk * (i + 1)
        val_start = train_end + embargo_bars
        val_end = min(val_start + chunk, usable_end)
        train_end_purged = max(0, train_end - purge_bars - max_horizon)

        train_idx = np.arange(0, train_end_purged, dtype=np.int32)
        val_idx = np.arange(val_start, val_end, dtype=np.int32)

        if len(train_idx) == 0 or len(val_idx) < 50:
            continue

        if np.intersect1d(train_idx, val_idx).size > 0:
            raise LeakageError("Train/validation overlap detected")

        generated.append(Fold(train_idx=train_idx, val_idx=val_idx))

    if len(generated) < 2:
        raise ValueError("Unable to construct enough valid folds")

    return generated


def assert_no_lookahead(feature_timestamps: np.ndarray, target_timestamps: np.ndarray) -> None:
    if feature_timestamps.shape != target_timestamps.shape:
        raise LeakageError("Mismatched timestamp arrays")
    if np.any(feature_timestamps >= target_timestamps):
        raise LeakageError("Feature timestamp >= target timestamp detected")
