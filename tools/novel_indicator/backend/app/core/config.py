from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NI_", env_file=".env", extra="ignore")

    app_name: str = "Novel Indicator Platform"
    api_prefix: str = "/api"
    debug: bool = False

    root_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3])
    artifacts_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "artifacts")
    runs_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "artifacts" / "runs")
    db_path: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "artifacts" / "novel_indicator.sqlite3")

    random_seed: int = 42
    max_workers: int = 6
    request_timeout_seconds: int = 30

    binance_base_url: str = "https://api.binance.com"


settings = Settings()


def ensure_paths() -> None:
    settings.artifacts_dir.mkdir(parents=True, exist_ok=True)
    settings.runs_dir.mkdir(parents=True, exist_ok=True)
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
