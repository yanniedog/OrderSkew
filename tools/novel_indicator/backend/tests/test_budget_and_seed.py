from __future__ import annotations

import pytest

from app.core.schemas import RunConfig
from app.research.runner import _scaled_config_for_budget
from app.research.search.optimizer import _stable_seed_suffix


def test_stable_seed_suffix_is_deterministic() -> None:
    first = _stable_seed_suffix("BTCUSDT", "5m")
    second = _stable_seed_suffix("BTCUSDT", "5m")
    assert first == second
    assert 0 <= first < 10_000


def test_budget_scaling_reduces_search_when_budget_is_tight() -> None:
    cfg = RunConfig(budget_minutes=20)
    scaled = _scaled_config_for_budget(cfg, total_jobs=30)

    assert scaled.search.candidate_pool_size < cfg.search.candidate_pool_size
    assert scaled.search.stage_a_keep < cfg.search.stage_a_keep
    assert scaled.search.stage_b_keep <= scaled.search.stage_a_keep
    assert scaled.cv.folds >= 3
    assert scaled.history_windows["5m"] >= 60
    assert cfg.search.candidate_pool_size == 180


def test_budget_scaling_keeps_quality_for_large_budget() -> None:
    cfg = RunConfig(budget_minutes=120)
    scaled = _scaled_config_for_budget(cfg, total_jobs=4)
    assert scaled.search.candidate_pool_size == cfg.search.candidate_pool_size
    assert scaled.search.stage_a_keep == cfg.search.stage_a_keep


def test_run_config_rejects_empty_symbols() -> None:
    with pytest.raises(ValueError):
        RunConfig(symbols=[])
