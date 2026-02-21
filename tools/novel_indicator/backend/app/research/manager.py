from __future__ import annotations

import concurrent.futures as futures
import threading
from collections.abc import Callable

from app.core.schemas import RunConfig
from app.research.runner import ExperimentRunner


class RunManager:
    def __init__(self, runner: ExperimentRunner, max_workers: int = 2) -> None:
        self.runner = runner
        self.executor = futures.ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ni-run")
        self._futures: dict[str, futures.Future] = {}
        self._cancel_flags: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def submit(self, run_id: str, config: RunConfig) -> None:
        with self._lock:
            if run_id in self._futures and not self._futures[run_id].done():
                raise RuntimeError(f"Run {run_id} is already active")

            cancel_event = threading.Event()
            self._cancel_flags[run_id] = cancel_event
            future = self.executor.submit(self.runner.execute, run_id, config, cancel_event.is_set)
            self._futures[run_id] = future

    def resume(self, run_id: str, config: RunConfig) -> None:
        self.submit(run_id, config)

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            event = self._cancel_flags.get(run_id)
            if event is None:
                return False
            event.set()
            return True

    def is_active(self, run_id: str) -> bool:
        with self._lock:
            fut = self._futures.get(run_id)
            if fut is None:
                return False
            return not fut.done()

    def active_runs(self) -> list[str]:
        with self._lock:
            return [run_id for run_id, fut in self._futures.items() if not fut.done()]
