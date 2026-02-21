from __future__ import annotations

import numpy as np

from app.research.indicators.dsl import BinaryNode, FieldNode, RollingNode, sanitize_series


def test_indicator_eval_and_pine_translation() -> None:
    node = BinaryNode(
        op='sub',
        left=RollingNode(op='ema', child=FieldNode('close'), window=8),
        right=RollingNode(op='sma', child=FieldNode('close'), window=21),
    )
    close = np.linspace(100.0, 150.0, 500)
    ctx = {
        'open': close,
        'high': close + 1,
        'low': close - 1,
        'close': close,
        'volume': np.linspace(1000, 2000, 500),
        'hlc3': close,
        'ohlc4': close,
        'logret': np.zeros_like(close),
        'range': np.ones_like(close),
    }
    output = sanitize_series(node.eval(ctx))
    assert output.shape == close.shape
    assert np.isfinite(output).all()
    pine = node.to_pine()
    assert 'ta.ema' in pine
    assert 'ta.sma' in pine
