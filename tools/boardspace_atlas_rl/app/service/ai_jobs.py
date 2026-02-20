from __future__ import annotations

import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Lock

from app.service.session_manager import SessionManager


@dataclass
class JobState:
    job_id: str
    session_id: str
    status: str = "running"
    progress: dict[str, int] = field(default_factory=lambda: {"done": 0, "total": 0})
    analysis: dict | None = None
    move: dict | None = None
    state_after: dict | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    lock: Lock = field(default_factory=Lock)
    future: Future | None = None


class AiJobManager:
    def __init__(self, session_manager: SessionManager, max_workers: int = 4) -> None:
        self.session_manager = session_manager
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="atlas-ai")
        self.jobs: dict[str, JobState] = {}
        self.lock = Lock()

    def start_job(self, session_id: str, sims: int, temperature: float, emit_every: int) -> JobState:
        job = JobState(job_id="job_" + uuid.uuid4().hex[:12], session_id=session_id)
        with self.lock:
            self.jobs[job.job_id] = job

        def _progress(done: int, total: int, analysis: dict) -> None:
            with job.lock:
                job.progress = {"done": int(done), "total": int(total)}
                job.analysis = analysis

        def _run() -> None:
            try:
                result = self.session_manager.run_ai_move(
                    session_id=session_id,
                    sims=sims,
                    temperature=temperature,
                    emit_every=emit_every,
                    progress_cb=_progress,
                )
                with job.lock:
                    job.status = "done"
                    job.move = result["move"]
                    job.state_after = result["state_after"]
                    job.analysis = result["analysis"]
                    if job.progress.get("total", 0) == 0:
                        job.progress = {"done": int(sims), "total": int(sims)}
                    job.finished_at = time.time()
            except Exception as exc:
                with job.lock:
                    job.status = "error"
                    job.error = str(exc)
                    job.finished_at = time.time()

        fut = self.executor.submit(_run)
        job.future = fut
        return job

    def get_job(self, job_id: str) -> JobState:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise KeyError("Unknown job id")
        return job

    def job_count(self) -> int:
        with self.lock:
            return len(self.jobs)
