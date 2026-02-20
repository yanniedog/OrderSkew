const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const BINANCE_BASE = 'https://api.binance.com/api/v3';
const DAY_MS = 24 * 60 * 60 * 1000;
const MARKET_PAGE_SIZE = 250;
const TARGET_ASSET_COUNT = 20;
const MAJOR_CYCLE_MIN_RANGE_PCT = 60;
const MAJOR_CYCLE_MIN_ATH_TO_TROUGH_DAYS = 60;

const RUN_STATE = {
  token: 0,
  canceled: false,
  running: false,
};

self.addEventListener('message', function (event) {
  const msg = event.data || {};
  if (msg.type === 'START_ANALYSIS') {
    startAnalysis().catch(function (error) {
      postError(error && error.code ? String(error.code) : 'analysis_failed', error && error.message ? String(error.message) : 'Analysis failed.');
    });
    return;
  }
  if (msg.type === 'CANCEL_ANALYSIS') {
    RUN_STATE.canceled = true;
  }
});

async function startAnalysis() {
  RUN_STATE.token += 1;
  RUN_STATE.canceled = false;
  RUN_STATE.running = true;
  const token = RUN_STATE.token;

  try {
    postProgress(token, 0.02, 'Fetching stablecoin filter set...');
    const stableMeta = await fetchStablecoinSet(token);
    throwIfCanceled(token);

    postProgress(token, 0.07, 'Fetching market-cap ranking snapshot...');
    const marketSnapshot = await fetchTopMarkets(token);
    throwIfCanceled(token);

    const universe = buildUniverse(marketSnapshot, stableMeta.stableIds, stableMeta.stableSymbols);
    postProgress(token, 0.12, `Universe selected: ${universe.selected.length} assets.`);

    postProgress(token, 0.16, 'Fetching Binance exchange metadata...');
    const exchangeMap = await fetchBinanceExchangeMap(token);
    throwIfCanceled(token);

    const analyzedAssets = [];
    const skippedAssets = [];

    for (let i = 0; i < universe.selected.length; i += 1) {
      throwIfCanceled(token);
      const asset = universe.selected[i];
      const baseSymbol = String(asset.symbol || '').toUpperCase();
      const binanceSymbol = `${baseSymbol}USDT`;
      const progress = 0.18 + (0.78 * (i / Math.max(universe.selected.length, 1)));
      postProgress(token, progress, `Analyzing ${asset.name} (${baseSymbol}) [${i + 1}/${universe.selected.length}]...`);

      if (stableMeta.stableSymbols.has(baseSymbol)) {
        skippedAssets.push(makeSkip(asset, binanceSymbol, 'excluded_stablecoin_to_stablecoin_pair', 'Base asset resolved to stablecoin symbol.'));
        continue;
      }

      const symbolMeta = exchangeMap.get(binanceSymbol);
      if (!symbolMeta) {
        skippedAssets.push(makeSkip(asset, binanceSymbol, 'missing_binance_usdt_pair', 'Binance spot USDT pair does not exist.'));
        continue;
      }

      if (symbolMeta.status !== 'TRADING' || symbolMeta.isSpotTradingAllowed !== true) {
        skippedAssets.push(makeSkip(asset, binanceSymbol, 'binance_symbol_not_trading', 'Binance pair exists but is not actively tradable on spot.'));
        continue;
      }

      let candlesRaw;
      try {
        candlesRaw = await fetchAllDailyKlines(token, binanceSymbol);
      } catch (error) {
        if (isCanceledError(error)) throw error;
        skippedAssets.push(makeSkip(asset, binanceSymbol, 'binance_fetch_failed', error && error.message ? String(error.message) : 'Binance fetch failed.'));
        continue;
      }
      throwIfCanceled(token);

      const candles = normalizeCandles(candlesRaw);
      if (candles.length < 2) {
        skippedAssets.push(makeSkip(asset, binanceSymbol, 'insufficient_or_invalid_candle_history', 'Binance daily candle history is insufficient.'));
        continue;
      }

      const cycles = buildCycles(candles);
      if (!Number.isFinite(cycles.raw_ath_cycle_count) || cycles.raw_ath_cycle_count === 0) {
        skippedAssets.push(makeSkip(asset, binanceSymbol, 'insufficient_or_invalid_candle_history', 'Could not derive any ATH cycles from candle history.'));
        continue;
      }

      analyzedAssets.push({
        asset: {
          coingecko_id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          market_cap_rank: asset.market_cap_rank,
          market_cap_usd: safeNumber(asset.market_cap),
          current_price_usd: safeNumber(asset.current_price),
          binance_symbol: binanceSymbol,
          quote_symbol: 'USDT',
        },
        data_window: {
          first_candle_date_utc: candles[0].date_utc,
          last_candle_date_utc: candles[candles.length - 1].date_utc,
          candle_count: candles.length,
        },
        major_cycle_detection: cycles.majorCycleDetection,
        summary: buildSummary(cycles),
        cycles: cycles.cycles,
      });
    }

    throwIfCanceled(token);
    postProgress(token, 0.98, 'Finalizing structured JSON output...');

    const result = {
      generated_at_utc: new Date().toISOString(),
      methodology: {
        market_cap_ranking_source: 'coingecko:/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1',
        ranking_currency_proxy: 'usd_as_proxy_for_usdt',
        stablecoin_filter_source: 'coingecko:/coins/markets?category=stablecoins',
        universe_policy: 'top_20_non_stablecoins_by_market_cap',
        history_source: 'binance_spot:/api/v3/klines',
        binance_pair_policy: 'base_usdt_only',
        stable_to_stable_pair_policy: 'excluded',
        ath_definition: 'strict_new_ath_on_daily_high_for_cycle_windows',
        trough_definition: 'lowest_daily_close_between_ath_and_next_ath',
        drawdown_formula: '((trough_close / ath_high) - 1) * 100',
        recovery_formula: '((next_ath_high / trough_close) - 1) * 100',
        major_cycle_thresholding: {
          cycle_inclusion_rule: 'abs(drawdown_pct) >= major_cycle_min_range_pct AND days_ath_to_trough >= major_cycle_min_ath_to_trough_days',
          major_cycle_min_range_pct: MAJOR_CYCLE_MIN_RANGE_PCT,
          major_cycle_min_ath_to_trough_days: MAJOR_CYCLE_MIN_ATH_TO_TROUGH_DAYS,
        },
        duration_basis: 'utc_calendar_days',
        aggregate_mode: 'dual_reporting_completed_only_and_completed_plus_current',
        missing_asset_policy: 'skip_without_backfill',
      },
      universe: {
        target_asset_count: TARGET_ASSET_COUNT,
        selected_count: universe.selected.length,
        excluded_stablecoin_count: universe.excludedStable.length,
        stablecoin_id_count: stableMeta.stableIds.size,
        stablecoin_symbol_count: stableMeta.stableSymbols.size,
        selected_assets: universe.selected.map(function (asset) {
          return {
            coingecko_id: asset.id,
            symbol: asset.symbol,
            name: asset.name,
            market_cap_rank: asset.market_cap_rank,
            market_cap_usd: safeNumber(asset.market_cap),
          };
        }),
      },
      results: {
        analyzed_assets: analyzedAssets,
        skipped_assets: skippedAssets,
        counts: {
          requested_assets: universe.selected.length,
          analyzed_assets: analyzedAssets.length,
          skipped_assets: skippedAssets.length,
        },
      },
    };

    postProgress(token, 1, 'Completed.');
    postComplete(token, result);
  } catch (error) {
    if (isCanceledError(error)) {
      postError('analysis_canceled', 'Analysis canceled.');
      return;
    }
    throw error;
  } finally {
    if (token === RUN_STATE.token) {
      RUN_STATE.running = false;
    }
  }
}

function throwIfCanceled(token) {
  if (token !== RUN_STATE.token || RUN_STATE.canceled) {
    const error = new Error('Analysis canceled.');
    error.code = 'analysis_canceled';
    throw error;
  }
}

function isCanceledError(error) {
  return !!(error && (error.code === 'analysis_canceled' || error.message === 'Analysis canceled.'));
}

function postProgress(token, progress, message) {
  if (token !== RUN_STATE.token || RUN_STATE.canceled) return;
  self.postMessage({
    type: 'PROGRESS',
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0,
    message: String(message || ''),
  });
}

function postComplete(token, result) {
  if (token !== RUN_STATE.token || RUN_STATE.canceled) return;
  self.postMessage({
    type: 'COMPLETE',
    result: result,
  });
}

function postError(code, message) {
  self.postMessage({
    type: 'ERROR',
    code: String(code || 'analysis_failed'),
    message: String(message || 'Analysis failed.'),
  });
}

async function fetchJsonWithRetry(url, label, token, attempts) {
  const maxAttempts = Number.isFinite(attempts) ? attempts : 4;
  let lastError = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    throwIfCanceled(token);
    const ctrl = new AbortController();
    const timeout = setTimeout(function () { ctrl.abort(); }, 25000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`${label} temporary failure (${response.status})`);
        await waitMs(300 * Math.pow(2, i) + Math.floor(Math.random() * 120), token);
        continue;
      }

      const body = await safeReadText(response);
      throw new Error(`${label} failed (${response.status})${body ? `: ${body.slice(0, 220)}` : ''}`);
    } catch (error) {
      clearTimeout(timeout);
      if (isCanceledError(error)) throw error;
      lastError = error;
      if (i < maxAttempts - 1) {
        await waitMs(300 * Math.pow(2, i) + Math.floor(Math.random() * 120), token);
      }
    }
  }
  throw lastError || new Error(`${label} request failed.`);
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

async function waitMs(ms, token) {
  throwIfCanceled(token);
  await new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
  throwIfCanceled(token);
}

async function fetchStablecoinSet(token) {
  const stableIds = new Set();
  const stableSymbols = new Set();
  let page = 1;
  while (page <= 6) {
    throwIfCanceled(token);
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=${MARKET_PAGE_SIZE}&page=${page}&sparkline=false`;
    const rows = await fetchJsonWithRetry(url, 'CoinGecko stablecoin list', token, 4);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      if (row.id) stableIds.add(String(row.id));
      if (row.symbol) stableSymbols.add(String(row.symbol).toUpperCase());
    }
    if (rows.length < MARKET_PAGE_SIZE) break;
    page += 1;
  }
  return { stableIds: stableIds, stableSymbols: stableSymbols };
}

async function fetchTopMarkets(token) {
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MARKET_PAGE_SIZE}&page=1&sparkline=false`;
  const rows = await fetchJsonWithRetry(url, 'CoinGecko market cap ranking', token, 4);
  if (!Array.isArray(rows)) throw new Error('CoinGecko ranking response is invalid.');
  return rows;
}

function buildUniverse(markets, stableIds, stableSymbols) {
  const selected = [];
  const excludedStable = [];
  for (let i = 0; i < markets.length; i += 1) {
    const row = markets[i] || {};
    const symbolUpper = String(row.symbol || '').toUpperCase();
    const isStable = stableIds.has(String(row.id || '')) || stableSymbols.has(symbolUpper);
    if (isStable) {
      excludedStable.push({
        coingecko_id: row.id || null,
        symbol: row.symbol || null,
        name: row.name || null,
        reason_code: 'excluded_stablecoin_asset',
      });
      continue;
    }
    selected.push(row);
    if (selected.length >= TARGET_ASSET_COUNT) break;
  }
  return { selected: selected, excludedStable: excludedStable };
}

async function fetchBinanceExchangeMap(token) {
  const url = `${BINANCE_BASE}/exchangeInfo`;
  const payload = await fetchJsonWithRetry(url, 'Binance exchange info', token, 4);
  if (!payload || !Array.isArray(payload.symbols)) throw new Error('Binance exchange info response is invalid.');
  const map = new Map();
  for (let i = 0; i < payload.symbols.length; i += 1) {
    const item = payload.symbols[i];
    if (!item || !item.symbol) continue;
    map.set(String(item.symbol), {
      status: String(item.status || ''),
      isSpotTradingAllowed: item.isSpotTradingAllowed === true,
    });
  }
  return map;
}

async function fetchAllDailyKlines(token, symbol) {
  let startTime = Date.UTC(2010, 0, 1, 0, 0, 0, 0);
  const endTime = Date.now();
  const limit = 1000;
  const out = [];

  while (startTime < endTime) {
    throwIfCanceled(token);
    const params = new URLSearchParams({
      symbol: symbol,
      interval: '1d',
      limit: String(limit),
      startTime: String(startTime),
      endTime: String(endTime),
    });
    const url = `${BINANCE_BASE}/klines?${params.toString()}`;
    const rows = await fetchJsonWithRetry(url, `Binance klines ${symbol}`, token, 4);
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!Array.isArray(row) || row.length < 5) continue;
      out.push({
        openTime: Number(row[0]),
        high: Number(row[2]),
        close: Number(row[4]),
      });
    }

    const lastRow = rows[rows.length - 1];
    const lastOpen = Array.isArray(lastRow) ? Number(lastRow[0]) : NaN;
    if (!Number.isFinite(lastOpen)) break;

    const nextStart = lastOpen + DAY_MS;
    if (!(nextStart > startTime)) break;
    startTime = nextStart;
    if (rows.length < limit) break;
  }

  return out;
}

function normalizeCandles(rows) {
  const unique = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const openTime = Number(row.openTime);
    const high = Number(row.high);
    const close = Number(row.close);
    if (!Number.isFinite(openTime) || !Number.isFinite(high) || !Number.isFinite(close)) continue;
    if (high <= 0 || close <= 0) continue;
    unique.set(openTime, {
      time_ms: openTime,
      date_utc: toUtcDate(openTime),
      high: high,
      close: close,
    });
  }
  return Array.from(unique.values()).sort(function (a, b) {
    return a.time_ms - b.time_ms;
  });
}

function buildCycles(candles) {
  const athIndices = [];
  let maxHigh = -Infinity;
  for (let i = 0; i < candles.length; i += 1) {
    const high = candles[i].high;
    if (high > maxHigh) {
      maxHigh = high;
      athIndices.push(i);
    }
  }

  if (athIndices.length === 0) {
    return {
      cycles: [],
      raw_ath_cycle_count: 0,
      majorCycleDetection: {
        major_cycle_min_range_pct: MAJOR_CYCLE_MIN_RANGE_PCT,
        raw_ath_events_found: 0,
        raw_ath_cycles_found: 0,
        major_cycles_retained: 0,
      },
    };
  }

  const cycles = [];
  let rawCycleCount = 0;
  for (let i = 0; i < athIndices.length; i += 1) {
    const athIndex = athIndices[i];
    const nextAthIndex = i + 1 < athIndices.length ? athIndices[i + 1] : null;
    const endIndex = nextAthIndex === null ? candles.length - 1 : nextAthIndex - 1;
    if (endIndex < athIndex) continue;
    rawCycleCount += 1;

    let troughIndex = athIndex;
    let troughClose = candles[athIndex].close;
    for (let j = athIndex + 1; j <= endIndex; j += 1) {
      if (candles[j].close < troughClose) {
        troughClose = candles[j].close;
        troughIndex = j;
      }
    }

    const ath = candles[athIndex];
    const trough = candles[troughIndex];
    const daysAthToTrough = utcDayDiff(ath.time_ms, trough.time_ms);
    const drawdownPct = ((trough.close / ath.high) - 1) * 100;
    const drawdownAbsPct = Math.abs(drawdownPct);
    if (drawdownAbsPct < MAJOR_CYCLE_MIN_RANGE_PCT) {
      continue;
    }
    if (daysAthToTrough < MAJOR_CYCLE_MIN_ATH_TO_TROUGH_DAYS) {
      continue;
    }
    const completed = nextAthIndex !== null;
    const cycle = {
      cycle_index: cycles.length + 1,
      ath_date_utc: ath.date_utc,
      ath_price_high: safeNumber(ath.high),
      trough_date_utc: trough.date_utc,
      trough_price_close: safeNumber(trough.close),
      drawdown_pct: safeNumber(drawdownPct),
      days_ath_to_trough: daysAthToTrough,
      is_completed_cycle: completed,
      next_ath_date_utc: null,
      next_ath_price_high: null,
      days_trough_to_next_ath: null,
      trough_to_next_ath_gain_pct: null,
    };

    if (completed) {
      const nextAth = candles[nextAthIndex];
      cycle.next_ath_date_utc = nextAth.date_utc;
      cycle.next_ath_price_high = safeNumber(nextAth.high);
      cycle.days_trough_to_next_ath = utcDayDiff(trough.time_ms, nextAth.time_ms);
      cycle.trough_to_next_ath_gain_pct = safeNumber(((nextAth.high / trough.close) - 1) * 100);
    }

    cycles.push(cycle);
  }

  return {
    cycles: cycles,
    raw_ath_cycle_count: rawCycleCount,
    majorCycleDetection: {
      major_cycle_min_range_pct: MAJOR_CYCLE_MIN_RANGE_PCT,
      major_cycle_min_ath_to_trough_days: MAJOR_CYCLE_MIN_ATH_TO_TROUGH_DAYS,
      raw_ath_events_found: athIndices.length,
      raw_ath_cycles_found: rawCycleCount,
      major_cycles_retained: cycles.length,
    },
  };
}

function buildSummary(cycles) {
  const rows = cycles.cycles || [];
  const completed = rows.filter(function (c) { return c.is_completed_cycle; });
  const allCycles = rows.slice();

  const completedDrawdowns = completed.map(function (c) { return c.drawdown_pct; }).filter(isFiniteNumber);
  const completedAthToTroughDays = completed.map(function (c) { return c.days_ath_to_trough; }).filter(isFiniteNumber);
  const completedRecoveryDays = completed.map(function (c) { return c.days_trough_to_next_ath; }).filter(isFiniteNumber);
  const completedRecoveryGain = completed.map(function (c) { return c.trough_to_next_ath_gain_pct; }).filter(isFiniteNumber);

  const allDrawdowns = allCycles.map(function (c) { return c.drawdown_pct; }).filter(isFiniteNumber);
  const allAthToTroughDays = allCycles.map(function (c) { return c.days_ath_to_trough; }).filter(isFiniteNumber);

  return {
    most_recent_cycle_drawdown_pct: allCycles.length ? allCycles[allCycles.length - 1].drawdown_pct : null,
    completed_only: {
      cycle_count: completed.length,
      worst_drawdown_pct: completedDrawdowns.length ? Math.min.apply(null, completedDrawdowns) : null,
      average_drawdown_pct: completedDrawdowns.length ? mean(completedDrawdowns) : null,
      ath_to_trough_days_stats: distributionStats(completedAthToTroughDays),
      trough_to_next_ath_days_stats: distributionStats(completedRecoveryDays),
      trough_to_next_ath_gain_pct_stats: distributionStats(completedRecoveryGain),
    },
    completed_plus_current: {
      cycle_count: allCycles.length,
      worst_drawdown_pct: allDrawdowns.length ? Math.min.apply(null, allDrawdowns) : null,
      average_drawdown_pct: allDrawdowns.length ? mean(allDrawdowns) : null,
      ath_to_trough_days_stats: distributionStats(allAthToTroughDays),
      trough_to_next_ath_days_stats: distributionStats(completedRecoveryDays),
      trough_to_next_ath_gain_pct_stats: distributionStats(completedRecoveryGain),
      not_applicable_current_cycle: true,
    },
  };
}

function distributionStats(values) {
  const filtered = values.filter(isFiniteNumber).sort(function (a, b) { return a - b; });
  if (!filtered.length) {
    return {
      count: 0,
      min: null,
      p25: null,
      median: null,
      mean: null,
      p75: null,
      max: null,
      stddev: null,
    };
  }

  const m = mean(filtered);
  let variance = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    const diff = filtered[i] - m;
    variance += diff * diff;
  }
  variance /= filtered.length;

  return {
    count: filtered.length,
    min: safeNumber(filtered[0]),
    p25: safeNumber(quantileSorted(filtered, 0.25)),
    median: safeNumber(quantileSorted(filtered, 0.5)),
    mean: safeNumber(m),
    p75: safeNumber(quantileSorted(filtered, 0.75)),
    max: safeNumber(filtered[filtered.length - 1]),
    stddev: safeNumber(Math.sqrt(variance)),
  };
}

function quantileSorted(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function mean(values) {
  if (!values.length) return null;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i];
  return total / values.length;
}

function utcDayDiff(startMs, endMs) {
  const a = Math.floor(startMs / DAY_MS);
  const b = Math.floor(endMs / DAY_MS);
  return Math.max(0, b - a);
}

function toUtcDate(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function makeSkip(asset, binanceSymbol, reasonCode, detail) {
  return {
    coingecko_id: asset.id || null,
    symbol: asset.symbol || null,
    name: asset.name || null,
    market_cap_rank: asset.market_cap_rank || null,
    market_cap_usd: safeNumber(asset.market_cap),
    binance_symbol: binanceSymbol || null,
    reason_code: reasonCode,
    detail: detail || '',
  };
}
