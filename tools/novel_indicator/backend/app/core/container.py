from __future__ import annotations

from functools import lru_cache

from app.core.config import ensure_paths, settings
from app.data.binance import BinanceClient
from app.data.storage import ArtifactStore
from app.db.sqlite import Database
from app.research.manager import RunManager
from app.research.runner import ExperimentRunner, RunnerDeps


@lru_cache(maxsize=1)
def get_db() -> Database:
    ensure_paths()
    return Database(settings.db_path)


@lru_cache(maxsize=1)
def get_store() -> ArtifactStore:
    ensure_paths()
    return ArtifactStore(settings.runs_dir)


@lru_cache(maxsize=1)
def get_binance_client() -> BinanceClient:
    return BinanceClient(base_url=settings.binance_base_url, timeout_seconds=settings.request_timeout_seconds)


@lru_cache(maxsize=1)
def get_runner() -> ExperimentRunner:
    deps = RunnerDeps(db=get_db(), store=get_store(), binance=get_binance_client())
    return ExperimentRunner(deps)


@lru_cache(maxsize=1)
def get_run_manager() -> RunManager:
    return RunManager(get_runner(), max_workers=min(settings.max_workers, 3))
