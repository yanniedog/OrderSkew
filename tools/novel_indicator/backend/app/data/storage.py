from __future__ import annotations

from pathlib import Path
from typing import Any

import polars as pl


class ArtifactStore:
    def __init__(self, runs_dir: Path) -> None:
        self.runs_dir = runs_dir
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        path = self.runs_dir / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def data_dir(self, run_id: str) -> Path:
        path = self.run_dir(run_id) / "data"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def plot_dir(self, run_id: str) -> Path:
        path = self.run_dir(run_id) / "plots"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def report_dir(self, run_id: str) -> Path:
        path = self.run_dir(run_id) / "report"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def export_dir(self, run_id: str) -> Path:
        path = self.run_dir(run_id) / "exports"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_bars(self, run_id: str, symbol: str, timeframe: str, frame: pl.DataFrame) -> Path:
        path = self.data_dir(run_id) / f"bars_{symbol}_{timeframe}.parquet"
        frame.write_parquet(path)
        return path

    def load_bars(self, run_id: str, symbol: str, timeframe: str) -> pl.DataFrame:
        path = self.data_dir(run_id) / f"bars_{symbol}_{timeframe}.parquet"
        return pl.read_parquet(path)

    def save_json(self, path: Path, data: dict[str, Any]) -> None:
        import json

        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def load_json(self, path: Path) -> dict[str, Any]:
        import json

        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
