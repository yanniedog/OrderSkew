from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_name: str = "BoardSpace Atlas RL API"
    api_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8008
    default_device: str = "cpu"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def artifacts_root() -> Path:
    path = repo_root() / "artifacts" / "boardspace_atlas_rl"
    path.mkdir(parents=True, exist_ok=True)
    return path


def model_root() -> Path:
    path = artifacts_root() / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def replay_root() -> Path:
    path = artifacts_root() / "replay"
    path.mkdir(parents=True, exist_ok=True)
    return path


settings = Settings()

