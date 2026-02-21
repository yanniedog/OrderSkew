from __future__ import annotations

import json
import math
import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil


def _fmt_seconds(value: float | None) -> str:
    if value is None or not math.isfinite(value) or value < 0:
        return "n/a"
    total = int(round(value))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _bar(progress: float, width: int) -> str:
    p = max(0.0, min(1.0, progress))
    filled = int(round(p * width))
    return "[" + ("#" * filled) + ("-" * (width - filled)) + "]"


def _fmt_rate(value: float | None, unit: str) -> str:
    if value is None or not math.isfinite(value):
        return f"n/a {unit}"
    return f"{value:.4f} {unit}"


class CpuTempReader:
    def __init__(self) -> None:
        self._last_read = 0.0
        self._cached_value: float | None = None

    def read(self) -> float | None:
        now = time.monotonic()
        if now - self._last_read < 5.0:
            return self._cached_value

        self._last_read = now

        # Primary path: psutil sensors API.
        try:
            temps = psutil.sensors_temperatures(fahrenheit=False)
            if temps:
                for entries in temps.values():
                    if entries:
                        valid = [float(e.current) for e in entries if e.current is not None]
                        if valid:
                            self._cached_value = sum(valid) / len(valid)
                            return self._cached_value
        except Exception:
            pass

        # Windows fallback via WMI thermal zone.
        if os.name == "nt":
            try:
                import subprocess

                cmd = [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -ExpandProperty CurrentTemperature)",
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
                if result.returncode == 0:
                    values = []
                    for line in result.stdout.splitlines():
                        line = line.strip()
                        if line.isdigit():
                            # Tenths of Kelvin.
                            kelvin = int(line) / 10.0
                            values.append(kelvin - 273.15)
                    if values:
                        self._cached_value = sum(values) / len(values)
                        return self._cached_value
            except Exception:
                pass

        self._cached_value = None
        return None


@dataclass
class TelemetryState:
    stage: str = "created"
    working_on: str = "initializing"
    achieved: str = "0"
    remaining: str = "unknown"
    overall_done: float = 0.0
    overall_total: float = 1.0
    stage_done: float = 0.0
    stage_total: float = 1.0


class LiveTelemetry:
    def __init__(self, run_id: str, run_dir: Path, tick_seconds: float = 1.0) -> None:
        self.run_id = run_id
        self.run_dir = run_dir
        self.tick_seconds = tick_seconds

        self._state = TelemetryState()
        self._run_started_at = time.monotonic()
        self._stage_started_at = self._run_started_at

        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        self._cpu_temp_reader = CpuTempReader()
        self._process = psutil.Process()
        self._logical_cores = max(1, psutil.cpu_count(logical=True) or 1)

        self.log_path = self.run_dir / "telemetry.log"
        self.jsonl_path = self.run_dir / "telemetry.jsonl"

        self.run_dir.mkdir(parents=True, exist_ok=True)
        if not self.log_path.exists():
            self.log_path.write_text("", encoding="utf-8")
        if not self.jsonl_path.exists():
            self.jsonl_path.write_text("", encoding="utf-8")

        # Prime CPU counters.
        psutil.cpu_percent(interval=None)
        self._process.cpu_percent(interval=None)

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True, name=f"telemetry-{self.run_id}")
        self._thread.start()

    def stop(self, final_status: str, final_message: str) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
        self._write_line(f"FINAL | status={final_status} | message={final_message}")

    def update(
        self,
        *,
        stage: str,
        working_on: str,
        achieved: str,
        remaining: str,
        overall_done: float,
        overall_total: float,
        stage_done: float,
        stage_total: float,
    ) -> None:
        with self._lock:
            if stage != self._state.stage:
                self._stage_started_at = time.monotonic()
            self._state.stage = stage
            self._state.working_on = working_on
            self._state.achieved = achieved
            self._state.remaining = remaining
            self._state.overall_done = max(0.0, overall_done)
            self._state.overall_total = max(1.0, overall_total)
            self._state.stage_done = max(0.0, stage_done)
            self._state.stage_total = max(1.0, stage_total)

        # Emit immediately on state transitions and progress updates, not only on timer ticks.
        snapshot = self._snapshot()
        self._emit(snapshot)

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self._stop.wait(self.tick_seconds):
                break
            snapshot = self._snapshot()
            self._emit(snapshot)

    def _snapshot(self) -> dict[str, Any]:
        now_monotonic = time.monotonic()
        now_utc = datetime.now(timezone.utc).isoformat()

        with self._lock:
            state = TelemetryState(**vars(self._state))
            run_elapsed = now_monotonic - self._run_started_at
            stage_elapsed = now_monotonic - self._stage_started_at

        overall_progress = state.overall_done / max(1.0, state.overall_total)
        stage_progress = state.stage_done / max(1.0, state.stage_total)

        total_rate = state.overall_done / run_elapsed if run_elapsed > 0 else 0.0
        stage_rate = state.stage_done / stage_elapsed if stage_elapsed > 0 else 0.0

        remaining_total_units = max(0.0, state.overall_total - state.overall_done)
        remaining_stage_units = max(0.0, state.stage_total - state.stage_done)

        eta_total = remaining_total_units / total_rate if total_rate > 1e-9 else None
        eta_stage = remaining_stage_units / stage_rate if stage_rate > 1e-9 else None

        system_cpu_percent = psutil.cpu_percent(interval=None)
        process_cpu_percent = self._process.cpu_percent(interval=None)
        vm = psutil.virtual_memory()

        if process_cpu_percent >= 0.1:
            cpu_cores_used = process_cpu_percent / 100.0
            rate_per_core: float | None = total_rate / cpu_cores_used
            rate_per_cpu_pct: float | None = total_rate / process_cpu_percent
        else:
            rate_per_core = None
            rate_per_cpu_pct = None

        cpu_temp_c = self._cpu_temp_reader.read()

        return {
            "ts": now_utc,
            "run_id": self.run_id,
            "stage": state.stage,
            "working_on": state.working_on,
            "achieved": state.achieved,
            "remaining": state.remaining,
            "overall_done": state.overall_done,
            "overall_total": state.overall_total,
            "overall_progress": overall_progress,
            "stage_done": state.stage_done,
            "stage_total": state.stage_total,
            "stage_progress": stage_progress,
            "run_elapsed_sec": run_elapsed,
            "stage_elapsed_sec": stage_elapsed,
            "eta_total_sec": eta_total,
            "eta_stage_sec": eta_stage,
            "rate_units_per_sec": total_rate,
            "rate_stage_units_per_sec": stage_rate,
            "rate_units_per_core_sec": rate_per_core,
            "rate_units_per_cpu_pct_sec": rate_per_cpu_pct,
            "system_cpu_percent": system_cpu_percent,
            "process_cpu_percent": process_cpu_percent,
            "logical_cores": self._logical_cores,
            "ram_used_gb": vm.used / (1024**3),
            "ram_total_gb": vm.total / (1024**3),
            "ram_percent": vm.percent,
            "cpu_temp_c": cpu_temp_c,
        }

    def _emit(self, snapshot: dict[str, Any]) -> None:
        total_bar = _bar(snapshot["overall_progress"], width=34)
        stage_bar = _bar(snapshot["stage_progress"], width=22)
        temp_text = "n/a" if snapshot["cpu_temp_c"] is None else f"{snapshot['cpu_temp_c']:.1f}C"

        line = (
            f"[{snapshot['ts']}] run={snapshot['run_id']} stage={snapshot['stage']} "
            f"work='{snapshot['working_on']}'\n"
            f"  overall {total_bar} {snapshot['overall_progress'] * 100:6.2f}% "
            f"({snapshot['overall_done']:.2f}/{snapshot['overall_total']:.2f}) "
            f"elapsed={_fmt_seconds(snapshot['run_elapsed_sec'])} eta={_fmt_seconds(snapshot['eta_total_sec'])}\n"
            f"  task    {stage_bar} {snapshot['stage_progress'] * 100:6.2f}% "
            f"({snapshot['stage_done']:.2f}/{snapshot['stage_total']:.2f}) "
            f"elapsed={_fmt_seconds(snapshot['stage_elapsed_sec'])} eta={_fmt_seconds(snapshot['eta_stage_sec'])}\n"
            f"  achieved='{snapshot['achieved']}' left='{snapshot['remaining']}'\n"
            f"  rate={snapshot['rate_units_per_sec']:.4f} u/s | "
            f"{_fmt_rate(snapshot['rate_units_per_core_sec'], 'u/core-s')} | "
            f"{_fmt_rate(snapshot['rate_units_per_cpu_pct_sec'], 'u/%cpu-s')}\n"
            f"  cpu sys={snapshot['system_cpu_percent']:.1f}% proc={snapshot['process_cpu_percent']:.1f}% "
            f"ram={snapshot['ram_used_gb']:.2f}/{snapshot['ram_total_gb']:.2f}GB ({snapshot['ram_percent']:.1f}%) "
            f"cpu_temp={temp_text}"
        )

        print(line, flush=True)
        self._write_line(line)
        with self.jsonl_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(snapshot) + "\n")

    def _write_line(self, line: str) -> None:
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
