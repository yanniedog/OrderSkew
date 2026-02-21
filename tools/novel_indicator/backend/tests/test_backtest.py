from __future__ import annotations

import numpy as np

from app.research.backtest.engine import run_backtest_from_forecasts


def test_backtest_returns_metrics() -> None:
    close_ref = np.array([100, 102, 101, 103, 104], dtype=float)
    y_true = np.array([101, 103, 102, 104, 105], dtype=float)
    y_pred = np.array([101.5, 103.4, 101.8, 104.2, 104.8], dtype=float)

    result = run_backtest_from_forecasts(
        y_true=y_true,
        y_pred=y_pred,
        close_ref=close_ref,
        fee_bps=7.0,
        slippage_bps=5.0,
        threshold=0.0001,
    )

    assert 'pnl_total' in result
    assert 'max_drawdown' in result
    assert 'turnover' in result
    assert isinstance(result['equity_curve'], list)
