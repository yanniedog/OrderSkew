from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.schemas import RunStageEnum, RunStatusEnum


class Database:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress REAL NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    config_hash TEXT NOT NULL,
                    error TEXT
                );

                CREATE TABLE IF NOT EXISTS run_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    message TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS run_results (
                    run_id TEXT PRIMARY KEY,
                    result_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS run_plots (
                    run_id TEXT NOT NULL,
                    plot_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (run_id, plot_id),
                    FOREIGN KEY(run_id) REFERENCES runs(run_id)
                );

                CREATE TABLE IF NOT EXISTS run_artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES runs(run_id)
                );
                """
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def create_run(self, run_id: str, config_json: dict[str, Any], config_hash: str) -> None:
        now = self._now()
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO runs (run_id, status, stage, progress, created_at, updated_at, config_json, config_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    RunStatusEnum.queued.value,
                    RunStageEnum.created.value,
                    0.0,
                    now,
                    now,
                    json.dumps(config_json),
                    config_hash,
                ),
            )

    def get_run(self, run_id: str) -> sqlite3.Row | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
            return row

    def list_runs(self, limit: int = 50) -> list[sqlite3.Row]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return rows

    def update_run_status(
        self,
        run_id: str,
        status: RunStatusEnum,
        stage: RunStageEnum,
        progress: float,
        error: str | None = None,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                UPDATE runs
                SET status = ?, stage = ?, progress = ?, updated_at = ?, error = ?
                WHERE run_id = ?
                """,
                (status.value, stage.value, float(progress), self._now(), error, run_id),
            )

    def add_log(self, run_id: str, stage: RunStageEnum, message: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO run_logs (run_id, timestamp, stage, message)
                VALUES (?, ?, ?, ?)
                """,
                (run_id, self._now(), stage.value, message),
            )

    def get_logs(self, run_id: str, limit: int = 500) -> list[sqlite3.Row]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT timestamp, stage, message
                FROM run_logs
                WHERE run_id = ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (run_id, limit),
            ).fetchall()
            return rows

    def save_result(self, run_id: str, result_json: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO run_results (run_id, result_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    result_json = excluded.result_json,
                    updated_at = excluded.updated_at
                """,
                (run_id, json.dumps(result_json), self._now()),
            )

    def get_result(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT result_json FROM run_results WHERE run_id = ?", (run_id,)
            ).fetchone()
            if row is None:
                return None
            return json.loads(row["result_json"])

    def save_plot(self, run_id: str, plot_id: str, payload_json: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO run_plots (run_id, plot_id, payload_json)
                VALUES (?, ?, ?)
                ON CONFLICT(run_id, plot_id) DO UPDATE SET
                    payload_json = excluded.payload_json
                """,
                (run_id, plot_id, json.dumps(payload_json)),
            )

    def get_plot(self, run_id: str, plot_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload_json FROM run_plots WHERE run_id = ? AND plot_id = ?",
                (run_id, plot_id),
            ).fetchone()
            if row is None:
                return None
            return json.loads(row["payload_json"])

    def add_artifact(self, run_id: str, artifact_type: str, path: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO run_artifacts (run_id, artifact_type, path, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (run_id, artifact_type, path, self._now()),
            )

    def get_artifacts(self, run_id: str) -> list[sqlite3.Row]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT artifact_type, path, created_at FROM run_artifacts WHERE run_id = ? ORDER BY id ASC",
                (run_id,),
            ).fetchall()
            return rows
