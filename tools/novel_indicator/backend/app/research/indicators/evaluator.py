from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import polars as pl

from app.research.cv import Fold
from app.research.models.forecaster import RidgeForecaster, mae, rmse


@dataclass
class HorizonScore:
    horizon: int
    normalized_rmse: float
    normalized_mae: float
    composite_error: float
    directional_hit_rate: float
    y_true: np.ndarray
    y_pred: np.ndarray
    close_ref: np.ndarray


@dataclass
class CandidateEvaluation:
    best_horizon: int
    best_score: HorizonScore
    all_scores: dict[int, HorizonScore]


class EvalCache:
    def __init__(self) -> None:
        self.feature: dict[str, np.ndarray] = {}
        self.horizon_scores: dict[tuple[str, int], HorizonScore] = {}
        self.targets: dict[int, np.ndarray] = {}
        self.baseline_matrix: np.ndarray | None = None
        self.augmented_feature: dict[str, np.ndarray] = {}


def build_context(frame: pl.DataFrame) -> dict[str, np.ndarray]:
    close = frame["close"].to_numpy().astype(np.float64)
    open_ = frame["open"].to_numpy().astype(np.float64)
    high = frame["high"].to_numpy().astype(np.float64)
    low = frame["low"].to_numpy().astype(np.float64)
    volume = frame["volume"].to_numpy().astype(np.float64)

    logret = np.zeros_like(close)
    logret[1:] = np.log((close[1:] + 1e-9) / (close[:-1] + 1e-9))

    return {
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "hlc3": (high + low + close) / 3.0,
        "ohlc4": (open_ + high + low + close) / 4.0,
        "logret": logret,
        "range": high - low,
    }


def build_baseline_matrix(close: np.ndarray) -> np.ndarray:
    n = len(close)
    ret1 = np.zeros(n, dtype=np.float64)
    ret1[1:] = (close[1:] - close[:-1]) / (close[:-1] + 1e-9)

    mom5 = np.zeros(n, dtype=np.float64)
    if n > 5:
        mom5[5:] = (close[5:] - close[:-5]) / (close[:-5] + 1e-9)

    vol10 = rolling_std_fast(ret1, window=10)

    baseline = np.column_stack([ret1, mom5, vol10])
    baseline[~np.isfinite(baseline)] = 0.0
    return baseline


def evaluate_candidate_horizons(
    indicator_id: str,
    feature: np.ndarray,
    close: np.ndarray,
    folds: list[Fold],
    horizon_min: int,
    horizon_max: int,
    coarse_step: int,
    refine_radius: int,
    cache: EvalCache,
    focus_horizon: int | None = None,
    focus_span: int | None = None,
) -> CandidateEvaluation:
    search_min = horizon_min
    search_max = horizon_max
    if focus_horizon is not None and focus_span is not None and focus_span > 0:
        search_min = max(horizon_min, focus_horizon - focus_span)
        search_max = min(horizon_max, focus_horizon + focus_span)

    coarse_horizons = sorted(set([search_min] + list(range(search_min, search_max + 1, coarse_step)) + [search_max]))
    coarse_scores: dict[int, HorizonScore] = {}
    for h in coarse_horizons:
        coarse_scores[h] = _score_horizon(indicator_id, feature, close, folds, h, cache)

    ranked = sorted(coarse_scores.values(), key=lambda s: s.composite_error)
    best_coarse = ranked[0].composite_error if ranked else 9_999.0
    seed_count = 7 if best_coarse <= 0.35 else 4
    seed_horizons = [x.horizon for x in ranked[: min(seed_count, len(ranked))]]
    local_refine_radius = refine_radius if best_coarse <= 0.35 else max(1, refine_radius // 2)

    fine_horizons: set[int] = set(coarse_horizons)
    for h in seed_horizons:
        for delta in range(-local_refine_radius, local_refine_radius + 1):
            cand = h + delta
            if search_min <= cand <= search_max:
                fine_horizons.add(cand)

    all_scores = dict(coarse_scores)
    for h in sorted(fine_horizons):
        if h not in all_scores:
            all_scores[h] = _score_horizon(indicator_id, feature, close, folds, h, cache)

    best = min(all_scores.values(), key=lambda s: s.composite_error)
    return CandidateEvaluation(best_horizon=best.horizon, best_score=best, all_scores=all_scores)


def evaluate_feature_combo(
    combo_id: str,
    features: np.ndarray,
    close: np.ndarray,
    folds: list[Fold],
    horizon: int,
) -> HorizonScore:
    return _score_horizon(combo_id, features, close, folds, horizon, cache=None)


def rolling_std_fast(x: np.ndarray, window: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    out = np.zeros_like(x)
    if window <= 1 or len(x) == 0:
        return out
    c1 = np.cumsum(np.insert(x, 0, 0.0))
    c2 = np.cumsum(np.insert(x * x, 0, 0.0))
    count = np.arange(1, len(x) + 1, dtype=np.float64)
    count = np.minimum(count, float(window))

    sum_w = c1[1:] - c1[np.maximum(0, np.arange(len(x)) - window + 1)]
    sum2_w = c2[1:] - c2[np.maximum(0, np.arange(len(x)) - window + 1)]
    mean = sum_w / count
    var = np.maximum((sum2_w / count) - (mean * mean), 0.0)
    out[:] = np.sqrt(var)
    return out


def _score_horizon(
    key: str,
    feature: np.ndarray,
    close: np.ndarray,
    folds: list[Fold],
    horizon: int,
    cache: EvalCache | None,
) -> HorizonScore:
    if cache is not None:
        cache_key = (key, horizon)
        if cache_key in cache.horizon_scores:
            return cache.horizon_scores[cache_key]

    if cache is not None and horizon in cache.targets:
        y = cache.targets[horizon]
    else:
        y = make_target(close, horizon)
        if cache is not None:
            cache.targets[horizon] = y

    if cache is not None and key in cache.augmented_feature:
        design = cache.augmented_feature[key]
    else:
        if cache is not None and cache.baseline_matrix is not None and len(cache.baseline_matrix) == len(close):
            baseline = cache.baseline_matrix
        else:
            baseline = build_baseline_matrix(close)
            if cache is not None:
                cache.baseline_matrix = baseline

        if feature.ndim == 1:
            design = np.column_stack([feature[:, None], baseline])
        else:
            design = np.column_stack([feature, baseline])
        if cache is not None:
            cache.augmented_feature[key] = design

    fold_true: list[np.ndarray] = []
    fold_pred: list[np.ndarray] = []
    fold_ref: list[np.ndarray] = []

    valid = np.all(np.isfinite(design), axis=1) & np.isfinite(y)

    for fold in folds:
        train_idx = fold.train_idx[valid[fold.train_idx]]
        val_idx = fold.val_idx[valid[fold.val_idx]]
        if len(train_idx) < 30 or len(val_idx) < 20:
            continue

        x_train = design[train_idx]
        x_val = design[val_idx]

        y_train = y[train_idx]
        y_val = y[val_idx]
        close_val = close[val_idx]
        y_train_delta = (y_train - close[train_idx]) / (close[train_idx] + 1e-9)

        model = RidgeForecaster(alpha=1.0)
        model.fit(x_train, y_train_delta)
        pred_delta = np.clip(model.predict(x_val), -0.8, 0.8)
        pred = close_val * (1.0 + pred_delta)

        fold_true.append(y_val)
        fold_pred.append(pred)
        fold_ref.append(close_val)

    if not fold_true:
        huge = HorizonScore(
            horizon=horizon,
            normalized_rmse=9_999.0,
            normalized_mae=9_999.0,
            composite_error=9_999.0,
            directional_hit_rate=0.0,
            y_true=np.array([]),
            y_pred=np.array([]),
            close_ref=np.array([]),
        )
        if cache is not None:
            cache.horizon_scores[(key, horizon)] = huge
        return huge

    y_true = np.concatenate(fold_true)
    y_pred = np.concatenate(fold_pred)
    close_ref = np.concatenate(fold_ref)

    nrmse = rmse(y_true, y_pred) / (np.std(y_true) + 1e-9)
    nmae = mae(y_true, y_pred) / (np.mean(np.abs(y_true)) + 1e-9)
    composite = 0.5 * (nrmse + nmae)

    direction_true = np.sign(y_true - close_ref)
    direction_pred = np.sign(y_pred - close_ref)
    hit_rate = float(np.mean(direction_true == direction_pred))

    score = HorizonScore(
        horizon=horizon,
        normalized_rmse=float(nrmse),
        normalized_mae=float(nmae),
        composite_error=float(composite),
        directional_hit_rate=hit_rate,
        y_true=y_true,
        y_pred=y_pred,
        close_ref=close_ref,
    )
    if cache is not None:
        cache.horizon_scores[(key, horizon)] = score
    return score


def make_target(close: np.ndarray, horizon: int) -> np.ndarray:
    out = np.full_like(close, np.nan, dtype=np.float64)
    if horizon >= len(close):
        return out
    out[:-horizon] = close[horizon:]
    return out


def _valid_indices(indices: np.ndarray, feature: np.ndarray, y: np.ndarray) -> np.ndarray:
    if feature.ndim == 1:
        mask_feature = np.isfinite(feature)
    else:
        mask_feature = np.all(np.isfinite(feature), axis=1)
    valid = mask_feature & np.isfinite(y)
    return indices[valid[indices]]
