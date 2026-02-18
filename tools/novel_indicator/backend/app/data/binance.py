from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import requests


INTERVAL_MS = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


@dataclass
class BinanceClient:
    base_url: str
    timeout_seconds: int = 30
    max_retries: int = 3
    retry_backoff_seconds: float = 0.5
    _session: requests.Session = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "NovelIndicatorLab/0.1"})

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = self._session.get(url, params=params, timeout=self.timeout_seconds)
                if response.status_code == 429 and attempt < self.max_retries:
                    wait = self.retry_backoff_seconds * (attempt + 1)
                    time.sleep(wait)
                    continue
                response.raise_for_status()
                return response.json()
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                wait = self.retry_backoff_seconds * (attempt + 1)
                time.sleep(wait)
        raise RuntimeError(f"Binance request failed for {path}: {last_error}")

    def fetch_top_volume_symbols(self, top_n: int = 10, quote_asset: str = "USDT") -> list[str]:
        tickers = self._get("/api/v3/ticker/24hr")
        eligible: list[tuple[str, float]] = []
        for row in tickers:
            symbol = row.get("symbol", "")
            if not symbol.endswith(quote_asset):
                continue
            if "UP" in symbol or "DOWN" in symbol or "BULL" in symbol or "BEAR" in symbol:
                continue
            try:
                quote_volume = float(row.get("quoteVolume", 0.0))
            except Exception:
                continue
            eligible.append((symbol, quote_volume))
        eligible.sort(key=lambda item: item[1], reverse=True)
        return [symbol for symbol, _ in eligible[:top_n]]

    def fetch_klines(
        self,
        symbol: str,
        interval: str,
        start_time_ms: int,
        end_time_ms: int,
        limit: int = 1000,
    ) -> list[list[Any]]:
        rows: list[list[Any]] = []
        cursor = start_time_ms
        step_ms = INTERVAL_MS.get(interval, 60_000)
        iterations = 0
        max_iterations = 5_000
        while cursor < end_time_ms and iterations < max_iterations:
            batch = self._get(
                "/api/v3/klines",
                params={
                    "symbol": symbol,
                    "interval": interval,
                    "startTime": cursor,
                    "endTime": end_time_ms,
                    "limit": limit,
                },
            )
            if not batch:
                break
            rows.extend(batch)
            last_open_time = int(batch[-1][0])
            next_cursor = last_open_time + step_ms
            if next_cursor <= cursor:
                break
            cursor = next_cursor
            iterations += 1
            if len(batch) < limit:
                break
        return rows

    def fetch_lookback_klines(self, symbol: str, interval: str, days: int) -> list[list[Any]]:
        now = datetime.now(tz=timezone.utc)
        end_ts = int(now.timestamp() * 1000)
        start_ts = int((now - timedelta(days=days)).timestamp() * 1000)
        return self.fetch_klines(symbol=symbol, interval=interval, start_time_ms=start_ts, end_time_ms=end_ts)
