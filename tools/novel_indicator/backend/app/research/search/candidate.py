from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.research.indicators.dsl import Node


@dataclass
class CandidateIndicator:
    indicator_id: str
    root: Node
    complexity: int
    params: dict[str, Any] = field(default_factory=dict)

    def expression(self) -> str:
        return self.root.to_expr()

    def signature(self) -> str:
        return self.root.signature()
