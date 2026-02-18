from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone

import numpy as np

from app.core.schemas import AssetRecommendation, IndicatorSpec, ResultSummary, ScoreCard
from app.research.search.optimizer import SearchOutcome


def build_result_summary(
    run_id: str,
    outcomes: list[SearchOutcome],
    backtests: dict[tuple[str, str], dict[str, float | list[float]]],
) -> ResultSummary:
    per_asset: list[AssetRecommendation] = []

    for outcome in outcomes:
        bt = backtests.get((outcome.symbol, outcome.timeframe), {})
        combo_specs = [
            IndicatorSpec(
                indicator_id=c.indicator_id,
                expression=c.expression(),
                complexity=c.complexity,
                params=c.params,
            )
            for c in outcome.best_combo
        ]
        score = ScoreCard(
            normalized_rmse=outcome.combo_score.normalized_rmse,
            normalized_mae=outcome.combo_score.normalized_mae,
            composite_error=outcome.combo_score.composite_error,
            directional_hit_rate=outcome.combo_score.directional_hit_rate,
            pnl_total=float(bt.get("pnl_total", 0.0)),
            max_drawdown=float(bt.get("max_drawdown", 0.0)),
            turnover=float(bt.get("turnover", 0.0)),
            stability_score=_stability_from_outcome(outcome),
        )
        rec = AssetRecommendation(
            symbol=outcome.symbol,
            timeframe=outcome.timeframe,
            best_horizon=outcome.combo_score.horizon,
            indicator_combo=combo_specs,
            score=score,
        )
        per_asset.append(rec)

    universal = _build_universal_recommendation(per_asset)

    return ResultSummary(
        run_id=run_id,
        universal_recommendation=universal,
        per_asset_recommendations=sorted(per_asset, key=lambda x: x.score.composite_error),
        generated_at=datetime.now(timezone.utc),
    )


def _build_universal_recommendation(per_asset: list[AssetRecommendation]) -> AssetRecommendation:
    if not per_asset:
        raise ValueError("No per-asset recommendations available")

    combo_key_to_errors: dict[str, list[float]] = defaultdict(list)
    combo_counter: Counter[str] = Counter()
    combo_lookup: dict[str, list[IndicatorSpec]] = {}
    horizon_lookup: dict[str, list[int]] = defaultdict(list)
    diagnostics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    for rec in per_asset:
        key = "|".join([spec.expression for spec in rec.indicator_combo])
        combo_counter[key] += 1
        combo_lookup[key] = rec.indicator_combo
        combo_key_to_errors[key].append(rec.score.composite_error)
        horizon_lookup[key].append(rec.best_horizon)
        diagnostics[key]["rmse"].append(rec.score.normalized_rmse)
        diagnostics[key]["mae"].append(rec.score.normalized_mae)
        diagnostics[key]["hit"].append(rec.score.directional_hit_rate)
        diagnostics[key]["pnl"].append(rec.score.pnl_total)
        diagnostics[key]["dd"].append(rec.score.max_drawdown)
        diagnostics[key]["turnover"].append(rec.score.turnover)
        diagnostics[key]["stability"].append(rec.score.stability_score)

    def universal_rank(key: str) -> tuple[float, float, int]:
        avg_err = float(np.mean(combo_key_to_errors[key]))
        coverage_penalty = 1.0 / combo_counter[key]
        horizon_var = float(np.std(horizon_lookup[key]))
        return (avg_err + 0.05 * coverage_penalty + 0.001 * horizon_var, avg_err, -combo_counter[key])

    best_key = min(combo_key_to_errors.keys(), key=universal_rank)
    stats = diagnostics[best_key]
    universal_score = ScoreCard(
        normalized_rmse=float(np.mean(stats["rmse"])),
        normalized_mae=float(np.mean(stats["mae"])),
        composite_error=float(np.mean(combo_key_to_errors[best_key])),
        directional_hit_rate=float(np.mean(stats["hit"])),
        pnl_total=float(np.mean(stats["pnl"])),
        max_drawdown=float(np.mean(stats["dd"])),
        turnover=float(np.mean(stats["turnover"])),
        stability_score=float(np.mean(stats["stability"])),
    )

    return AssetRecommendation(
        symbol="UNIVERSAL",
        timeframe="5m|1h|4h",
        best_horizon=int(round(float(np.mean(horizon_lookup[best_key])))),
        indicator_combo=combo_lookup[best_key],
        score=universal_score,
    )


def _stability_from_outcome(outcome: SearchOutcome) -> float:
    top_errors = [ev.best_score.composite_error for _, ev in outcome.best_candidates[:5]]
    if len(top_errors) < 2:
        return 0.0
    return float(1.0 / (np.std(top_errors) + 1e-6))
