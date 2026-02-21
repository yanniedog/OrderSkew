from __future__ import annotations

import numpy as np

from app.research.cv import LeakageError, build_purged_walk_forward_folds


def test_purged_walk_forward_has_no_overlap() -> None:
    folds = build_purged_walk_forward_folds(
        n_rows=5000,
        folds=5,
        max_horizon=200,
        purge_bars=8,
        embargo_bars=8,
    )
    assert len(folds) >= 2
    for fold in folds:
        assert np.intersect1d(fold.train_idx, fold.val_idx).size == 0


def test_purged_walk_forward_rejects_small_dataset() -> None:
    try:
        build_purged_walk_forward_folds(
            n_rows=120,
            folds=5,
            max_horizon=30,
            purge_bars=8,
            embargo_bars=8,
        )
    except ValueError:
        return
    raise AssertionError('Expected ValueError for small dataset')
