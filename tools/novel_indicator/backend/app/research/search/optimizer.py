from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import numpy as np
import polars as pl

from app.core.schemas import RunConfig
from app.research.cv import Fold, assert_no_lookahead, build_purged_walk_forward_folds
from app.research.indicators.dsl import sanitize_series
from app.research.indicators.evaluator import (
    CandidateEvaluation,
    EvalCache,
    HorizonScore,
    build_context,
    evaluate_candidate_horizons,
    evaluate_feature_combo,
)
from app.research.indicators.generator import IndicatorGenerator
from app.research.indicators.novelty import NoveltyFilter
from app.research.search.candidate import CandidateIndicator


@dataclass
class SearchOutcome:
    symbol: str
    timeframe: str
    best_candidates: list[tuple[CandidateIndicator, CandidateEvaluation]]
    best_combo: list[CandidateIndicator]
    combo_score: HorizonScore
    folds: list[Fold]


def run_indicator_search(
    frame: pl.DataFrame,
    symbol: str,
    timeframe: str,
    config: RunConfig,
) -> SearchOutcome:
    ctx = build_context(frame)
    close = ctx["close"]
    timestamps = frame["timestamp"].to_numpy().astype(np.int64)

    assert_no_lookahead(
        feature_timestamps=timestamps[:- config.horizon.max_bar],
        target_timestamps=timestamps[config.horizon.max_bar :],
    )

    folds = build_purged_walk_forward_folds(
        n_rows=len(close),
        folds=config.cv.folds,
        max_horizon=config.horizon.max_bar,
        purge_bars=config.cv.purge_bars,
        embargo_bars=config.cv.embargo_bars,
    )

    generator = IndicatorGenerator(seed=config.random_seed + _stable_seed_suffix(symbol, timeframe))
    novelty = NoveltyFilter(
        similarity_threshold=config.search.novelty_similarity_threshold,
        collinearity_threshold=config.search.collinearity_threshold,
    )
    cache = EvalCache()

    pool = generator.generate_pool(size=config.search.candidate_pool_size)

    # Stage A: broad screening with novelty filter.
    stage_a: list[tuple[CandidateIndicator, CandidateEvaluation]] = []
    for cand in pool:
        feature = _feature_for_candidate(cand, ctx, cache)
        if not novelty.is_novel_signature(cand):
            continue
        if novelty.is_collinear(feature):
            continue

        eval_result = evaluate_candidate_horizons(
            indicator_id=cand.indicator_id,
            feature=feature,
            close=close,
            folds=folds[:2],
            horizon_min=config.horizon.min_bar,
            horizon_max=config.horizon.max_bar,
            coarse_step=max(config.horizon.coarse_step * 2, 16),
            refine_radius=max(1, config.horizon.refine_radius // 2),
            cache=cache,
        )
        stage_a.append((cand, eval_result))
        novelty.accept(cand, feature)

    stage_a.sort(key=lambda item: item[1].best_score.composite_error)
    stage_a = stage_a[: config.search.stage_a_keep]

    # Stage B: richer evaluation for survivors.
    stage_b_input_limit = min(len(stage_a), max(config.search.stage_b_keep * 2, 24))
    stage_a_for_stage_b = stage_a[:stage_b_input_limit]
    stage_b: list[tuple[CandidateIndicator, CandidateEvaluation]] = []
    for cand, stage_a_eval in stage_a_for_stage_b:
        feature = _feature_for_candidate(cand, ctx, cache)
        local_focus_span = max(18, config.horizon.refine_radius * 4)
        eval_result = evaluate_candidate_horizons(
            indicator_id=cand.indicator_id,
            feature=feature,
            close=close,
            folds=folds,
            horizon_min=config.horizon.min_bar,
            horizon_max=config.horizon.max_bar,
            coarse_step=config.horizon.coarse_step,
            refine_radius=config.horizon.refine_radius,
            cache=cache,
            focus_horizon=stage_a_eval.best_horizon,
            focus_span=local_focus_span,
        )
        stage_b.append((cand, eval_result))

    stage_b.sort(key=lambda item: item[1].best_score.composite_error)
    stage_b = stage_b[: config.search.stage_b_keep]
    best_stage_b_error = stage_b[0][1].best_score.composite_error if stage_b else 9_999.0

    # Stage C: parameter mutation tuning.
    tuned: list[tuple[CandidateIndicator, CandidateEvaluation]] = []
    for cand, base_eval in stage_b:
        best_pair = (cand, base_eval)
        trial_cap = config.search.tuning_trials
        if base_eval.best_score.composite_error > best_stage_b_error * 1.35:
            trial_cap = min(trial_cap, 2)

        no_improve = 0
        for trial in range(trial_cap):
            mutated = generator.mutate(cand, trial_id=trial)
            if mutated.complexity > 22:
                continue
            feature = _feature_for_candidate(mutated, ctx, cache)
            local_focus_span = max(16, config.horizon.refine_radius * 4)
            eval_result = evaluate_candidate_horizons(
                indicator_id=mutated.indicator_id,
                feature=feature,
                close=close,
                folds=folds,
                horizon_min=config.horizon.min_bar,
                horizon_max=config.horizon.max_bar,
                coarse_step=config.horizon.coarse_step,
                refine_radius=config.horizon.refine_radius,
                cache=cache,
                focus_horizon=best_pair[1].best_horizon,
                focus_span=local_focus_span,
            )
            if eval_result.best_score.composite_error < best_pair[1].best_score.composite_error:
                best_pair = (mutated, eval_result)
                no_improve = 0
            else:
                no_improve += 1
                if no_improve >= 2:
                    break
        tuned.append(best_pair)

    tuned.sort(key=lambda item: item[1].best_score.composite_error)
    tuned = tuned[: config.search.stage_b_keep]

    # Final global reevaluation on narrowed survivor set for reliable ranking across full horizon continuum.
    globally_scored: list[tuple[CandidateIndicator, CandidateEvaluation]] = []
    for cand, _ in tuned:
        feature = _feature_for_candidate(cand, ctx, cache)
        global_eval = evaluate_candidate_horizons(
            indicator_id=cand.indicator_id,
            feature=feature,
            close=close,
            folds=folds,
            horizon_min=config.horizon.min_bar,
            horizon_max=config.horizon.max_bar,
            coarse_step=config.horizon.coarse_step,
            refine_radius=config.horizon.refine_radius,
            cache=cache,
        )
        globally_scored.append((cand, global_eval))

    tuned = sorted(globally_scored, key=lambda item: item[1].best_score.composite_error)[: config.search.stage_b_keep]

    # Stage D: sparse combo search.
    best_combo, combo_score = _greedy_combo(
        candidates=tuned,
        close=close,
        folds=folds,
        cache=cache,
        context=ctx,
        max_size=config.search.max_combo_size,
    )

    return SearchOutcome(
        symbol=symbol,
        timeframe=timeframe,
        best_candidates=tuned[:10],
        best_combo=best_combo,
        combo_score=combo_score,
        folds=folds,
    )


def _feature_for_candidate(cand: CandidateIndicator, ctx: dict[str, np.ndarray], cache: EvalCache) -> np.ndarray:
    key = cand.expression()
    if key in cache.feature:
        return cache.feature[key]
    feature = sanitize_series(cand.root.eval(ctx))
    cache.feature[key] = feature
    return feature


def _greedy_combo(
    candidates: list[tuple[CandidateIndicator, CandidateEvaluation]],
    close: np.ndarray,
    folds: list[Fold],
    cache: EvalCache,
    context: dict[str, np.ndarray],
    max_size: int,
) -> tuple[list[CandidateIndicator], HorizonScore]:
    if not candidates:
        raise ValueError("No candidates available for combo search")

    sorted_candidates = sorted(candidates, key=lambda x: x[1].best_score.composite_error)
    sorted_candidates = sorted_candidates[: min(len(sorted_candidates), 12)]
    selected: list[CandidateIndicator] = [sorted_candidates[0][0]]
    best_horizon = sorted_candidates[0][1].best_horizon

    best_matrix = _build_matrix(selected, context, cache)
    best_score = evaluate_feature_combo(
        combo_id="combo_0",
        features=best_matrix,
        close=close,
        folds=folds,
        horizon=best_horizon,
    )

    for _ in range(1, max_size):
        improved = False
        best_candidate: CandidateIndicator | None = None
        best_candidate_score: HorizonScore | None = None

        for cand, cand_eval in sorted_candidates:
            if cand in selected:
                continue
            trial_selected = selected + [cand]
            matrix = _build_matrix(trial_selected, context, cache)
            score = evaluate_feature_combo(
                combo_id="combo_trial",
                features=matrix,
                close=close,
                folds=folds,
                horizon=cand_eval.best_horizon,
            )
            if score.composite_error + 1e-9 < best_score.composite_error:
                if best_candidate_score is None or score.composite_error < best_candidate_score.composite_error:
                    best_candidate = cand
                    best_candidate_score = score

        if best_candidate is not None and best_candidate_score is not None:
            selected.append(best_candidate)
            best_score = best_candidate_score
            improved = True

        if not improved:
            break

    return selected, best_score


def _build_matrix(selected: list[CandidateIndicator], context: dict[str, np.ndarray], cache: EvalCache) -> np.ndarray:
    cols: list[np.ndarray] = []
    for cand in selected:
        key = cand.expression()
        if key not in cache.feature:
            cache.feature[key] = sanitize_series(cand.root.eval(context))
        cols.append(cache.feature[key])
    matrix = np.column_stack(cols)
    return matrix


def _stable_seed_suffix(symbol: str, timeframe: str) -> int:
    digest = hashlib.sha256(f"{symbol}|{timeframe}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 10_000


def search_outcome_to_dict(outcome: SearchOutcome) -> dict[str, Any]:
    return {
        "symbol": outcome.symbol,
        "timeframe": outcome.timeframe,
        "best_combo_ids": [cand.indicator_id for cand in outcome.best_combo],
        "best_combo_expr": [cand.expression() for cand in outcome.best_combo],
        "combo_score": {
            "horizon": outcome.combo_score.horizon,
            "normalized_rmse": outcome.combo_score.normalized_rmse,
            "normalized_mae": outcome.combo_score.normalized_mae,
            "composite_error": outcome.combo_score.composite_error,
            "directional_hit_rate": outcome.combo_score.directional_hit_rate,
        },
        "best_candidates": [
            {
                "indicator_id": cand.indicator_id,
                "expression": cand.expression(),
                "best_horizon": evaluation.best_horizon,
                "composite_error": evaluation.best_score.composite_error,
            }
            for cand, evaluation in outcome.best_candidates
        ],
    }
