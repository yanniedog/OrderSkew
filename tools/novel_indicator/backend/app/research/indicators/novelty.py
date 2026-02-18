from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np

from app.research.search.candidate import CandidateIndicator


CANONICAL_SIGNATURES = {
    "R:sma:14(F:close)",
    "R:ema:12(F:close)",
    "B:sub(R:ema:12(F:close),R:ema:26(F:close))",
    "R:std:20(F:close)",
    "B:div(B:sub(F:close,R:sma:20(F:close)),R:std:20(F:close))",
}


_token_re = re.compile(r"[A-Za-z0-9_]+")


def _tokenize(signature: str) -> set[str]:
    return set(_token_re.findall(signature))


def signature_similarity(a: str, b: str) -> float:
    ta = _tokenize(a)
    tb = _tokenize(b)
    if not ta and not tb:
        return 1.0
    union = ta | tb
    if not union:
        return 0.0
    return len(ta & tb) / len(union)


@dataclass
class NoveltyFilter:
    similarity_threshold: float
    collinearity_threshold: float
    accepted_signatures: list[str] = field(default_factory=list)
    accepted_series: list[np.ndarray] = field(default_factory=list)

    def is_novel_signature(self, candidate: CandidateIndicator) -> bool:
        signature = candidate.signature()
        for canonical in CANONICAL_SIGNATURES:
            if signature_similarity(signature, canonical) >= self.similarity_threshold:
                return False
        for existing in self.accepted_signatures:
            if signature_similarity(signature, existing) >= self.similarity_threshold:
                return False
        return True

    def is_collinear(self, series: np.ndarray) -> bool:
        if not self.accepted_series:
            return False
        series = np.asarray(series, dtype=np.float64)
        if np.std(series) < 1e-12:
            return True
        for prior in self.accepted_series:
            prior_std = np.std(prior)
            if prior_std < 1e-12:
                continue
            corr = np.corrcoef(series, prior)[0, 1]
            if np.isnan(corr):
                continue
            if abs(corr) >= self.collinearity_threshold:
                return True
        return False

    def accept(self, candidate: CandidateIndicator, series: np.ndarray) -> None:
        self.accepted_signatures.append(candidate.signature())
        self.accepted_series.append(np.asarray(series, dtype=np.float64))
