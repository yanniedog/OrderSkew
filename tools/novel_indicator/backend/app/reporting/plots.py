from __future__ import annotations

from collections import defaultdict

import numpy as np

from app.research.search.optimizer import SearchOutcome


def build_plot_payloads(outcomes: list[SearchOutcome]) -> dict[str, dict]:
    payloads: dict[str, dict] = {}

    labels: list[str] = []
    horizons: list[int] = []
    z_rows: list[list[float]] = []

    for outcome in outcomes:
        labels.append(f"{outcome.symbol}:{outcome.timeframe}")
        cand, eval_result = outcome.best_candidates[0]
        hs = sorted(eval_result.all_scores.keys())
        if not horizons:
            horizons = hs
        row = [float(eval_result.all_scores.get(h, eval_result.best_score).composite_error) for h in horizons]
        z_rows.append(row)

    payloads["horizon_heatmap"] = {
        "title": "Error By Horizon",
        "type": "heatmap",
        "x": horizons,
        "y": labels,
        "z": z_rows,
    }

    leaderboard = sorted(
        [
            {
                "label": f"{o.symbol}:{o.timeframe}",
                "error": float(o.combo_score.composite_error),
                "hit_rate": float(o.combo_score.directional_hit_rate),
                "horizon": int(o.combo_score.horizon),
            }
            for o in outcomes
        ],
        key=lambda x: x["error"],
    )

    payloads["leaderboard"] = {
        "title": "Asset Leaderboard",
        "type": "table",
        "rows": leaderboard,
    }

    if outcomes:
        best = sorted(outcomes, key=lambda o: o.combo_score.composite_error)[0]
        n = min(len(best.combo_score.y_true), len(best.combo_score.y_pred), 500)
        payloads["forecast_overlay"] = {
            "title": f"Forecast vs Realized ({best.symbol}:{best.timeframe})",
            "type": "line",
            "x": list(range(n)),
            "series": [
                {"name": "y_true", "values": best.combo_score.y_true[:n].tolist()},
                {"name": "y_pred", "values": best.combo_score.y_pred[:n].tolist()},
            ],
        }

    # Novelty vs accuracy uses candidate complexity from top candidate per outcome.
    novelty_points: list[dict] = []
    for outcome in outcomes:
        for cand, ev in outcome.best_candidates[:15]:
            novelty_points.append(
                {
                    "label": f"{outcome.symbol}:{outcome.timeframe}:{cand.indicator_id}",
                    "complexity": cand.complexity,
                    "error": float(ev.best_score.composite_error),
                }
            )

    payloads["novelty_pareto"] = {
        "title": "Novelty/Complexity vs Accuracy",
        "type": "scatter",
        "points": novelty_points,
    }

    # Fold performance approximation by grouping outcomes.
    group_by_tf: dict[str, list[float]] = defaultdict(list)
    for outcome in outcomes:
        group_by_tf[outcome.timeframe].append(float(outcome.combo_score.composite_error))
    payloads["timeframe_error"] = {
        "title": "Composite Error by Timeframe",
        "type": "bar",
        "categories": list(group_by_tf.keys()),
        "values": [float(np.mean(vals)) for vals in group_by_tf.values()],
    }

    return payloads
