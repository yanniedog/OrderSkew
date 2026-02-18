from __future__ import annotations

import numpy as np


def run_backtest_from_forecasts(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    close_ref: np.ndarray,
    fee_bps: float,
    slippage_bps: float,
    threshold: float,
) -> dict[str, float | list[float]]:
    if len(y_true) == 0:
        return {
            "pnl_total": 0.0,
            "max_drawdown": 0.0,
            "turnover": 0.0,
            "equity_curve": [],
        }

    realized_return = (y_true - close_ref) / (close_ref + 1e-9)
    forecast_return = (y_pred - close_ref) / (close_ref + 1e-9)

    raw_signal = np.where(forecast_return > threshold, 1.0, np.where(forecast_return < -threshold, -1.0, 0.0))

    # Hold signal for each validation point and charge cost on position changes.
    position = np.copy(raw_signal)
    position_shifted = np.roll(position, 1)
    position_shifted[0] = 0.0
    turnover = np.abs(position - position_shifted)

    total_cost = (fee_bps + slippage_bps) / 10_000.0
    strategy_return = position_shifted * realized_return - turnover * total_cost

    equity = np.cumprod(1.0 + strategy_return)
    rolling_peak = np.maximum.accumulate(equity)
    drawdown = (equity - rolling_peak) / (rolling_peak + 1e-12)

    return {
        "pnl_total": float(equity[-1] - 1.0),
        "max_drawdown": float(np.min(drawdown)),
        "turnover": float(np.mean(turnover)),
        "equity_curve": equity.tolist(),
    }
