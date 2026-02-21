from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_name: str = "BoardSpace Atlas RL API"
    api_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8008
    default_device: str = "cpu"
    cors_allow_origins: tuple[str, ...] = (
        "https://orderskew.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
        "http://localhost:8008",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8008",
    )


def _read_cors_origins(defaults: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv("ATLAS_CORS_ALLOW_ORIGINS", "").strip()
    if not raw:
        return defaults
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return tuple(parts) if parts else defaults


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


settings = Settings(cors_allow_origins=_read_cors_origins(Settings.cors_allow_origins))
