from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np


@dataclass
class ReplaySample:
    game_id: str
    state_planes: np.ndarray
    target_pi: np.ndarray
    target_z: float
    ply: int
    source: Literal["selfplay", "atlas_seed"]
    atlas_target: np.ndarray | None = None


class ReplayBuffer:
    def __init__(self, capacity: int = 200_000) -> None:
        self._data: deque[ReplaySample] = deque(maxlen=capacity)

    def add(self, sample: ReplaySample) -> None:
        self._data.append(sample)

    def extend(self, samples: list[ReplaySample]) -> None:
        for sample in samples:
            self.add(sample)

    def sample(self, batch_size: int) -> list[ReplaySample]:
        if not self._data:
            return []
        n = min(batch_size, len(self._data))
        idx = np.random.choice(len(self._data), size=n, replace=False)
        data = list(self._data)
        return [data[int(i)] for i in idx]

    def __len__(self) -> int:
        return len(self._data)


class ReplayDiskWriter:
    def __init__(self, base_dir: Path, game_id: str, shard_size: int = 2048) -> None:
        self.game_id = game_id
        self.shard_size = shard_size
        self.base_dir = base_dir / game_id
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.pending: list[ReplaySample] = []
        self.shard_index = self._next_index()

    def _next_index(self) -> int:
        existing = sorted(self.base_dir.glob("chunk_*.npz"))
        if not existing:
            return 0
        last = existing[-1].stem.split("_")[-1]
        try:
            return int(last) + 1
        except ValueError:
            return len(existing)

    def add(self, sample: ReplaySample) -> None:
        self.pending.append(sample)
        if len(self.pending) >= self.shard_size:
            self.flush()

    def extend(self, samples: list[ReplaySample]) -> None:
        for sample in samples:
            self.add(sample)

    def flush(self) -> None:
        if not self.pending:
            return
        states = np.stack([s.state_planes for s in self.pending], axis=0).astype(np.float32)
        pis = np.stack([s.target_pi for s in self.pending], axis=0).astype(np.float32)
        zs = np.array([s.target_z for s in self.pending], dtype=np.float32)
        ply = np.array([s.ply for s in self.pending], dtype=np.int32)
        source = np.array([s.source for s in self.pending], dtype=object)
        atlas = np.stack(
            [s.atlas_target if s.atlas_target is not None else np.full((8,), np.nan, dtype=np.float32) for s in self.pending],
            axis=0,
        ).astype(np.float32)

        path = self.base_dir / f"chunk_{self.shard_index:06d}.npz"
        np.savez_compressed(
            path,
            states=states,
            target_pi=pis,
            target_z=zs,
            ply=ply,
            source=source,
            atlas_target=atlas,
        )
        self.shard_index += 1
        self.pending = []

