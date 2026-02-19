/// <reference lib="webworker" />

import type {
  BinanceCallDiagnostic,
  BinanceDiagnosticsFeed,
  PlotOptions,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunCreated,
  RunStageEnum,
  RunStatus,
  TelemetryFeed,
  TelemetrySnapshot,
} from '../api/types'
import { barsToMs, formatDurationMs, horizonLabel, minutesToBars, timeframeToMs } from '../utils/timeframe'
import {
  backtest,
  buildWalkForwardFolds,
  clamp,
  ema,
  fitLinear1D,
  linearFit,
  mae,
  mean,
  rmse,
  rollingMean,
  rollingStd,
  rsi,
  shiftTarget,
  std,
} from './worker-stats'
import { buildReportHtml, buildRunExportBundle } from './worker-export'
import { getAllRunStore, getKlineCache, putKlineCache, putRunStore } from './worker-db'

type RpcRequest = { id: string; method: string; params?: Record<string, unknown> }
type RpcResponse = { id: string; ok: boolean; result?: unknown; error?: string }

type RunBundle = {
  run: RunStatus
  config: RunConfig
  summary: ResultSummary | null
  plots: Record<string, PlotPayload>
  telemetry: TelemetrySnapshot[]
  binanceCalls: BinanceCallDiagnostic[]
  pineScripts: Record<string, string>
  context?: {
    bestSeries?: Array<{
      symbol: string
      timeframe: string
      timestamps: number[]
      yTrue: number[]
      yPred: number[]
      closeRef: number[]
      foldErrors: number[]
      calibrationX: number[]
      calibrationY: number[]
      expression: string
      indicatorId: string
    }>
    expressionToPine?: Record<string, string>
  }
}

type OhlcvRow = { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

const DEFAULT_CONFIG: RunConfig = {
  top_n_symbols: 4,
  timeframes: ['5m', '1h'],
  budget_minutes: 8,
  seed_mode: 'auto',
  random_seed: 42,
  advanced: {
    performance_profile: 'fast',
    horizon: {
      min_bar: 3,
      max_bar: 180,
      coarse_step: 12,
      refine_radius: 8,
    },
    search: {
      candidate_pool_size: 140,
      stage_a_keep: 60,
      stage_b_keep: 20,
      tuning_trials: 4,
      max_combo_size: 3,
      novelty_similarity_threshold: 0.8,
      collinearity_threshold: 0.92,
      min_novelty_score: 0.2,
    },
    validation: {
      folds: 4,
      embargo_bars: 8,
      purge_bars: 8,
      search_split: 0.58,
      model_select_split: 0.22,
      holdout_split: 0.2,
      baseline_margin: 0.015,
    },
    objective_weights: {
      rmse: 0.37,
      mae: 0.3,
      calibration: 0.18,
      directional: 0.15,
    },
  },
}

const KLINE_CACHE_TTL_MS = 20 * 60 * 1000

let initialized = false
const runs = new Map<string, RunBundle>()
const cancelRuns = new Set<string>()
const pendingBundleSaves = new Map<string, RunBundle>()
let pendingBundleSaveTimer: number | null = null

function nowIso(): string {
  return new Date().toISOString()
}

function runId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function cfgHash(config: RunConfig): string {
  const raw = JSON.stringify(config)
  let h = 2166136261
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `cfg_${(h >>> 0).toString(16)}`
}

function stableSeed(base: number, symbol: string, timeframe: string): number {
  const raw = `${symbol}:${timeframe}`
  let h = 2166136261
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (base + (h >>> 0)) >>> 0
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeWeights(weights: NonNullable<RunConfig['advanced']>['objective_weights']): NonNullable<RunConfig['advanced']>['objective_weights'] {
  const rmse = Math.max(0.01, weights.rmse)
  const mae = Math.max(0.01, weights.mae)
  const calibration = Math.max(0.01, weights.calibration)
  const directional = Math.max(0.01, weights.directional)
  const total = rmse + mae + calibration + directional
  return {
    rmse: rmse / total,
    mae: mae / total,
    calibration: calibration / total,
    directional: directional / total,
  }
}

function mergeRunConfig(partial: Partial<RunConfig> | undefined): RunConfig {
  const incoming = partial ?? {}
  const incomingAdvanced: Partial<NonNullable<RunConfig['advanced']>> = incoming.advanced ?? {}
  const merged: RunConfig = {
    top_n_symbols: clampInt(Number(incoming.top_n_symbols ?? DEFAULT_CONFIG.top_n_symbols), 1, 30),
    timeframes: Array.isArray(incoming.timeframes)
      ? incoming.timeframes.filter((tf): tf is string => typeof tf === 'string' && ['5m', '1h', '4h'].includes(tf))
      : [...DEFAULT_CONFIG.timeframes],
    budget_minutes: clampInt(Number(incoming.budget_minutes ?? DEFAULT_CONFIG.budget_minutes), 5, 240),
    seed_mode: incoming.seed_mode === 'manual' ? 'manual' : 'auto',
    random_seed: clampInt(Number(incoming.random_seed ?? DEFAULT_CONFIG.random_seed ?? 42), 1, 1_000_000),
    advanced: {
      performance_profile:
        incomingAdvanced.performance_profile === 'deep' || incomingAdvanced.performance_profile === 'balanced'
          ? incomingAdvanced.performance_profile
          : 'fast',
      horizon: {
        min_bar: clampInt(Number(incomingAdvanced.horizon?.min_bar ?? DEFAULT_CONFIG.advanced?.horizon.min_bar ?? 3), 1, 400),
        max_bar: clampInt(Number(incomingAdvanced.horizon?.max_bar ?? DEFAULT_CONFIG.advanced?.horizon.max_bar ?? 180), 2, 600),
        coarse_step: clampInt(
          Number(incomingAdvanced.horizon?.coarse_step ?? DEFAULT_CONFIG.advanced?.horizon.coarse_step ?? 12),
          1,
          80,
        ),
        refine_radius: clampInt(
          Number(incomingAdvanced.horizon?.refine_radius ?? DEFAULT_CONFIG.advanced?.horizon.refine_radius ?? 8),
          1,
          40,
        ),
      },
      search: {
        candidate_pool_size: clampInt(
          Number(incomingAdvanced.search?.candidate_pool_size ?? DEFAULT_CONFIG.advanced?.search.candidate_pool_size ?? 140),
          32,
          500,
        ),
        stage_a_keep: clampInt(Number(incomingAdvanced.search?.stage_a_keep ?? DEFAULT_CONFIG.advanced?.search.stage_a_keep ?? 60), 8, 300),
        stage_b_keep: clampInt(Number(incomingAdvanced.search?.stage_b_keep ?? DEFAULT_CONFIG.advanced?.search.stage_b_keep ?? 20), 4, 160),
        tuning_trials: clampInt(Number(incomingAdvanced.search?.tuning_trials ?? DEFAULT_CONFIG.advanced?.search.tuning_trials ?? 4), 1, 16),
        max_combo_size: clampInt(Number(incomingAdvanced.search?.max_combo_size ?? DEFAULT_CONFIG.advanced?.search.max_combo_size ?? 3), 1, 6),
        novelty_similarity_threshold: Math.min(
          0.98,
          Math.max(0.4, Number(incomingAdvanced.search?.novelty_similarity_threshold ?? DEFAULT_CONFIG.advanced?.search.novelty_similarity_threshold ?? 0.8)),
        ),
        collinearity_threshold: Math.min(
          0.995,
          Math.max(0.65, Number(incomingAdvanced.search?.collinearity_threshold ?? DEFAULT_CONFIG.advanced?.search.collinearity_threshold ?? 0.92)),
        ),
        min_novelty_score: Math.min(
          1,
          Math.max(0, Number(incomingAdvanced.search?.min_novelty_score ?? DEFAULT_CONFIG.advanced?.search.min_novelty_score ?? 0.2)),
        ),
      },
      validation: {
        folds: clampInt(Number(incomingAdvanced.validation?.folds ?? DEFAULT_CONFIG.advanced?.validation.folds ?? 4), 2, 6),
        embargo_bars: clampInt(
          Number(incomingAdvanced.validation?.embargo_bars ?? DEFAULT_CONFIG.advanced?.validation.embargo_bars ?? 8),
          0,
          64,
        ),
        purge_bars: clampInt(Number(incomingAdvanced.validation?.purge_bars ?? DEFAULT_CONFIG.advanced?.validation.purge_bars ?? 8), 0, 64),
        search_split: Math.min(
          0.75,
          Math.max(0.35, Number(incomingAdvanced.validation?.search_split ?? DEFAULT_CONFIG.advanced?.validation.search_split ?? 0.58)),
        ),
        model_select_split: Math.min(
          0.4,
          Math.max(0.1, Number(incomingAdvanced.validation?.model_select_split ?? DEFAULT_CONFIG.advanced?.validation.model_select_split ?? 0.22)),
        ),
        holdout_split: Math.min(
          0.35,
          Math.max(0.1, Number(incomingAdvanced.validation?.holdout_split ?? DEFAULT_CONFIG.advanced?.validation.holdout_split ?? 0.2)),
        ),
        baseline_margin: Math.min(
          0.2,
          Math.max(0, Number(incomingAdvanced.validation?.baseline_margin ?? DEFAULT_CONFIG.advanced?.validation.baseline_margin ?? 0.015)),
        ),
      },
      objective_weights: normalizeWeights({
        rmse: Number(incomingAdvanced.objective_weights?.rmse ?? DEFAULT_CONFIG.advanced?.objective_weights.rmse ?? 0.37),
        mae: Number(incomingAdvanced.objective_weights?.mae ?? DEFAULT_CONFIG.advanced?.objective_weights.mae ?? 0.3),
        calibration: Number(incomingAdvanced.objective_weights?.calibration ?? DEFAULT_CONFIG.advanced?.objective_weights.calibration ?? 0.18),
        directional: Number(incomingAdvanced.objective_weights?.directional ?? DEFAULT_CONFIG.advanced?.objective_weights.directional ?? 0.15),
      }),
    },
  }
  if (merged.timeframes.length === 0) merged.timeframes = [...DEFAULT_CONFIG.timeframes]
  if ((merged.advanced?.horizon.max_bar ?? 2) <= (merged.advanced?.horizon.min_bar ?? 1)) {
    merged.advanced!.horizon.max_bar = merged.advanced!.horizon.min_bar + 1
  }
  if ((merged.advanced?.search.stage_b_keep ?? 4) > (merged.advanced?.search.stage_a_keep ?? 8)) {
    merged.advanced!.search.stage_b_keep = merged.advanced!.search.stage_a_keep
  }
  if (merged.seed_mode === 'auto') {
    merged.random_seed = DEFAULT_CONFIG.random_seed
  }
  return merged
}

async function saveBundleNow(id: string, bundle: RunBundle): Promise<void> {
  await putRunStore(id, { id, bundle })
}

function scheduleBundleSave(id: string, bundle: RunBundle): void {
  pendingBundleSaves.set(id, bundle)
  if (pendingBundleSaveTimer !== null) return
  pendingBundleSaveTimer = self.setTimeout(() => {
    void flushBundleSaves()
  }, 1000)
}

async function flushBundleSaves(): Promise<void> {
  if (pendingBundleSaveTimer !== null) {
    self.clearTimeout(pendingBundleSaveTimer)
    pendingBundleSaveTimer = null
  }
  if (pendingBundleSaves.size === 0) return
  const batch = Array.from(pendingBundleSaves.entries())
  pendingBundleSaves.clear()
  await Promise.all(batch.map(([id, bundle]) => saveBundleNow(id, bundle)))
}

async function loadBundles(): Promise<void> {
  if (initialized) return
  const rows = await getAllRunStore()
  for (const row of rows) {
    if (row?.id && row.bundle) {
      const bundle = row.bundle as RunBundle
      bundle.config = mergeRunConfig(bundle.config)
      bundle.context = bundle.context ?? {}
      runs.set(row.id, bundle)
    }
  }
  initialized = true
}

async function loadKlineCache(symbol: string, timeframe: string, days: number): Promise<OhlcvRow[] | null> {
  const key = `${symbol}|${timeframe}|${days}`
  const row = await getKlineCache(key)
  if (!row) return null
  if (Date.now() - row.fetched_at > KLINE_CACHE_TTL_MS) return null
  return row.rows as OhlcvRow[]
}

async function saveKlineCache(symbol: string, timeframe: string, days: number, rows: OhlcvRow[]): Promise<void> {
  const key = `${symbol}|${timeframe}|${days}`
  await putKlineCache(key, Date.now(), rows)
}

function makeBundle(id: string, config: RunConfig): RunBundle {
  const now = nowIso()
  return {
    run: {
      run_id: id,
      status: 'queued',
      stage: 'created',
      progress: 0,
      created_at: now,
      updated_at: now,
      config_hash: cfgHash(config),
      logs: [{ timestamp: now, stage: 'created', message: 'Run created in browser engine.' }],
    },
    config: mergeRunConfig(config),
    summary: null,
    plots: {},
    telemetry: [],
    binanceCalls: [],
    pineScripts: {},
  }
}

function updateRun(bundle: RunBundle, status: RunStatus['status'], stage: RunStageEnum, progress: number, message: string): void {
  bundle.run.status = status
  bundle.run.stage = stage
  bundle.run.progress = Math.max(0, Math.min(1, progress))
  bundle.run.updated_at = nowIso()
  bundle.run.logs.push({ timestamp: bundle.run.updated_at, stage, message })
  if (bundle.run.logs.length > 300) bundle.run.logs = bundle.run.logs.slice(-300)
}

function addTelemetry(bundle: RunBundle, input: Omit<TelemetrySnapshot, 'ts'>): void {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  bundle.telemetry.push({
    ...input,
    ts: nowIso(),
    logical_cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
    device_memory_gb: typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null : null,
    js_heap_used_mb: mem ? mem.usedJSHeapSize / (1024 * 1024) : null,
    js_heap_limit_mb: mem ? mem.jsHeapSizeLimit / (1024 * 1024) : null,
    js_heap_percent: mem ? (mem.usedJSHeapSize / Math.max(mem.jsHeapSizeLimit, 1)) * 100 : null,
    worker_busy_ratio: Math.max(0, Math.min(1, input.rate_units_per_sec / 30)),
    storage_used_mb: JSON.stringify(bundle).length / (1024 * 1024),
  })
  if (bundle.telemetry.length > 1200) bundle.telemetry = bundle.telemetry.slice(-1200)
}

function seeded(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function recordBinanceCall(bundle: RunBundle, endpoint: string, response: Response): void {
  const headerNames = [
    'x-mbx-used-weight',
    'x-mbx-used-weight-1m',
    'x-mbx-order-count-10s',
    'x-mbx-order-count-1m',
    'date',
    'content-type',
  ]
  const headers: Record<string, string> = {}
  for (const key of headerNames) {
    const value = response.headers.get(key)
    if (value !== null) {
      headers[key] = value
    }
  }
  bundle.binanceCalls.push({
    ts: nowIso(),
    endpoint,
    status: response.status,
    headers,
  })
  if (bundle.binanceCalls.length > 240) {
    bundle.binanceCalls = bundle.binanceCalls.slice(-240)
  }
}

async function fetchWithRetry(bundle: RunBundle, endpoint: string, url: string, attempts = 4): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      recordBinanceCall(bundle, endpoint, response)
      if (response.status === 429 || response.status >= 500) {
        const waitMs = 350 * Math.pow(2, attempt) + Math.floor(Math.random() * 140)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      return response
    } catch (error) {
      lastError = error as Error
      const waitMs = 350 * Math.pow(2, attempt) + Math.floor(Math.random() * 140)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  if (lastError) throw lastError
  throw new Error(`Binance request failed: ${endpoint}`)
}

async function fetchTopSymbols(bundle: RunBundle, topN: number): Promise<string[]> {
  const response = await fetchWithRetry(bundle, '/api/v3/ticker/24hr', 'https://api.binance.com/api/v3/ticker/24hr')
  if (!response.ok) throw new Error(`Binance universe request failed (${response.status})`)
  const rows = (await response.json()) as Array<{ symbol: string; quoteVolume: string; priceChangePercent: string; count: number }>
  const stableBases = new Set(['USDC', 'USDT', 'FDUSD', 'BUSD', 'TUSD', 'DAI', 'USDP', 'EUR', 'GBP'])
  return rows
    .filter((r) => r.symbol.endsWith('USDT'))
    .filter((r) => !/(UP|DOWN|BULL|BEAR)/.test(r.symbol))
    .filter((r) => !stableBases.has(r.symbol.slice(0, -4)))
    .map((r) => {
      const quoteVolume = Number(r.quoteVolume || '0')
      const move = Math.abs(Number(r.priceChangePercent || '0'))
      const trades = Number(r.count ?? 0)
      const score = Math.log10(quoteVolume + 1) * clamp(move / 5, 0.2, 2.2) * clamp(Math.log10(trades + 10) / 4, 0.3, 1.6)
      return { symbol: r.symbol, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((r) => r.symbol)
}

async function fetchKlines(bundle: RunBundle, symbol: string, timeframe: string, days: number): Promise<OhlcvRow[]> {
  const cached = await loadKlineCache(symbol, timeframe, days)
  if (cached && cached.length > 0) return cached

  const end = Date.now()
  const start = end - days * 24 * 60 * 60 * 1000
  const step = timeframeToMs(timeframe)
  let cursor = start
  const out: OhlcvRow[] = []

  while (cursor < end) {
    const params = new URLSearchParams({ symbol, interval: timeframe, startTime: String(cursor), endTime: String(end), limit: '1000' })
    const response = await fetchWithRetry(bundle, '/api/v3/klines', `https://api.binance.com/api/v3/klines?${params.toString()}`)
    if (!response.ok) throw new Error(`Binance klines failed (${response.status})`)
    const batch = (await response.json()) as Array<[number, string, string, string, string, string]>
    if (!batch.length) break
    for (const row of batch) {
      out.push({
        timestamp: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      })
    }
    const next = Number(batch[batch.length - 1][0]) + step
    if (next <= cursor) break
    cursor = next
    if (batch.length < 1000) break
  }

  out.sort((a, b) => a.timestamp - b.timestamp)
  if (out.length > 0) {
    await saveKlineCache(symbol, timeframe, days, out)
  }
  return out
}

type Outcome = {
  symbol: string
  timeframe: string
  timeframeMs: number
  candidateId: string
  expression: string
  pine: string
  family: string
  novelty: number
  complexity: number
  horizon: number
  normalizedRmse: number
  normalizedMae: number
  calibration: number
  composite: number
  hitRate: number
  pnl: number
  maxDrawdown: number
  turnover: number
  stability: number
  equityCurve: number[]
  horizonScores: Record<number, number>
  horizonDetails: Record<
    number,
    {
      normalizedRmse: number
      normalizedMae: number
      calibration: number
      composite: number
      hitRate: number
      pnl: number
      maxDrawdown: number
      turnover: number
      stability: number
    }
  >
  frontier: Array<{
    label: string
    expression: string
    family: string
    novelty: number
    complexity: number
    error: number
    hitRate: number
    pnl: number
    calibration: number
    horizon: number
    pine: string
  }>
  cubeRows: Array<{
    indicator_id: string
    expression: string
    family: string
    complexity: number
    novelty_score: number
    horizon_bar: number
    horizon_time_ms: number
    normalized_rmse: number
    normalized_mae: number
    calibration_error: number
    composite_error: number
    directional_hit_rate: number
    pnl_total: number
    max_drawdown: number
    turnover: number
    stability_score: number
  }>
  yTrue: Float64Array
  yPred: Float64Array
  closeRef: Float64Array
  timestamps: Float64Array
  foldErrors: number[]
  calibrationCurve: { x: number[]; y: number[] }
  validation: {
    holdoutRows: number
    holdoutPassed: boolean
    baselineComposite: number
    leakageSentinelTriggered: boolean
    warnings: string[]
  }
}

function evaluate(rows: OhlcvRow[], seed: number, config: RunConfig, timeframe: string): Outcome {
  const objective = config.advanced?.objective_weights ?? DEFAULT_CONFIG.advanced!.objective_weights
  const horizonCfg = config.advanced?.horizon ?? DEFAULT_CONFIG.advanced!.horizon
  const searchCfg = config.advanced?.search ?? DEFAULT_CONFIG.advanced!.search
  const validationCfg = config.advanced?.validation ?? DEFAULT_CONFIG.advanced!.validation

  const close = Float64Array.from(rows.map((r) => r.close))
  const open = Float64Array.from(rows.map((r) => r.open))
  const high = Float64Array.from(rows.map((r) => r.high))
  const low = Float64Array.from(rows.map((r) => r.low))
  const volume = Float64Array.from(rows.map((r) => r.volume))
  const timestamps = Float64Array.from(rows.map((r) => r.timestamp))
  for (let i = 1; i < rows.length; i += 1) {
    if (!(rows[i].timestamp > rows[i - 1].timestamp)) {
      throw new Error('Input timestamps must be strictly increasing')
    }
  }
  const rng = seeded(seed)

  const candidates: Array<{ id: string; expr: string; pine: string; family: string; complexity: number; feature: Float64Array; novelty: number }> = []
  const windows = [5, 8, 13, 21, 34, 55]
  const canonical = [
    'ret1(close)',
    'sub(ema(close,12),ema(close,26))',
    'div(sub(close,sma(close,20)),std(close,20))',
    'rsi(close,14)',
  ]

  const tokenize = (expr: string): Set<string> => new Set((expr.match(/[A-Za-z0-9_]+/g) ?? []).map((x) => x.toLowerCase()))
  const similarity = (a: string, b: string): number => {
    const ta = tokenize(a)
    const tb = tokenize(b)
    if (ta.size === 0 && tb.size === 0) return 1
    const union = new Set([...ta, ...tb])
    let inter = 0
    ta.forEach((token) => {
      if (tb.has(token)) inter += 1
    })
    return inter / Math.max(union.size, 1)
  }
  const seriesCorrAbs = (a: Float64Array, b: Float64Array): number => {
    const n = Math.min(a.length, b.length)
    if (n < 12) return 0
    let ma = 0
    let mb = 0
    for (let i = 0; i < n; i += 1) {
      ma += a[i]
      mb += b[i]
    }
    ma /= n
    mb /= n
    let num = 0
    let va = 0
    let vb = 0
    for (let i = 0; i < n; i += 1) {
      const da = a[i] - ma
      const db = b[i] - mb
      num += da * db
      va += da * da
      vb += db * db
    }
    return Math.abs(num / Math.sqrt(Math.max(va * vb, 1e-12)))
  }
  const sanitize = (values: Float64Array): Float64Array => {
    const out = new Float64Array(values.length)
    let last = 0
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i]
      if (!Number.isFinite(v)) {
        out[i] = last
        continue
      }
      const clipped = clamp(v, -50, 50)
      out[i] = clipped
      last = clipped
    }
    return out
  }

  const evaluateScore = (
    yTrue: Float64Array,
    yPred: Float64Array,
    closeRef: Float64Array,
    foldErrors: number[],
  ): {
    normalizedRmse: number
    normalizedMae: number
    calibration: number
    composite: number
    hitRate: number
    pnl: number
    maxDrawdown: number
    turnover: number
    stability: number
  } => {
    if (yTrue.length < 3) {
      return {
        normalizedRmse: 9999,
        normalizedMae: 9999,
        calibration: 9999,
        composite: 9999,
        hitRate: 0,
        pnl: 0,
        maxDrawdown: 0,
        turnover: 0,
        stability: 0,
      }
    }
    const nrmse = rmse(yTrue, yPred) / (std(yTrue) + 1e-9)
    let absTargetDelta = 0
    const predDelta = new Float64Array(yTrue.length)
    const trueDelta = new Float64Array(yTrue.length)
    for (let i = 0; i < yTrue.length; i += 1) {
      const td = (yTrue[i] - closeRef[i]) / (closeRef[i] + 1e-9)
      const pd = (yPred[i] - closeRef[i]) / (closeRef[i] + 1e-9)
      trueDelta[i] = td
      predDelta[i] = pd
      absTargetDelta += Math.abs(td)
    }
    const nmae = mae(yTrue, yPred) / (absTargetDelta / yTrue.length + 1e-9)
    let hits = 0
    for (let i = 0; i < yTrue.length; i += 1) {
      if (Math.sign(trueDelta[i]) === Math.sign(predDelta[i])) hits += 1
    }
    const hitRate = yTrue.length ? hits / yTrue.length : 0
    const calibration = Math.abs(mean(predDelta) - mean(trueDelta)) + Math.abs(std(predDelta) - std(trueDelta))
    const composite =
      objective.rmse * nrmse +
      objective.mae * nmae +
      objective.calibration * calibration +
      objective.directional * (1 - hitRate)
    const bt = backtest(yTrue, yPred, closeRef, 0.001)
    const stability = 1 / (std(Float64Array.from(foldErrors)) + 1e-6)
    return {
      normalizedRmse: nrmse,
      normalizedMae: nmae,
      calibration,
      composite,
      hitRate,
      pnl: bt.pnl,
      maxDrawdown: bt.maxDrawdown,
      turnover: bt.turnover,
      stability,
    }
  }

  const fitSegment = (
    feature: Float64Array,
    start: number,
    end: number,
    horizon: number,
    foldsCount: number,
    purgeBars: number,
    embargoBars: number,
  ): {
    yTrue: Float64Array
    yPred: Float64Array
    closeRef: Float64Array
    timestamps: Float64Array
    foldErrors: number[]
  } | null => {
    const segClose = close.slice(start, end)
    const segFeature = feature.slice(start, end)
    const target = shiftTarget(segClose, horizon)
    const usable = segClose.length - horizon - 1
    if (usable < 220) return null
    const chunk = Math.floor(usable / (foldsCount + 1))
    if (chunk < 45) return null
    const targetDelta = new Float64Array(segClose.length)
    targetDelta.fill(Number.NaN)
    for (let i = 0; i < segClose.length; i += 1) {
      if (!Number.isFinite(target[i])) continue
      targetDelta[i] = (target[i] - segClose[i]) / (segClose[i] + 1e-9)
    }
    const yTrue: number[] = []
    const yPred: number[] = []
    const closeRef: number[] = []
    const ts: number[] = []
    const foldErrors: number[] = []
    for (let fold = 0; fold < foldsCount; fold += 1) {
      const trainEnd = chunk * (fold + 1)
      const valStart = trainEnd + embargoBars
      const valEnd = Math.min(valStart + chunk, usable)
      const trainEndPurged = Math.max(0, trainEnd - purgeBars - horizon)
      if (valStart <= trainEndPurged) continue
      const trainLen = Math.max(0, trainEndPurged)
      const valLen = Math.max(0, valEnd - valStart)
      if (trainLen < 80 || valLen < 25) continue
      const trainIdx = new Int32Array(trainLen)
      for (let i = 0; i < trainLen; i += 1) trainIdx[i] = i
      const valIdx = new Int32Array(valLen)
      for (let i = 0; i < valLen; i += 1) valIdx[i] = valStart + i
      const model = fitLinear1D(segFeature, targetDelta, trainIdx)
      if (!model) continue
      const localTrue: number[] = []
      const localPred: number[] = []
      const localRef: number[] = []
      for (let i = 0; i < valIdx.length; i += 1) {
        const at = valIdx[i]
        if (!Number.isFinite(segFeature[at]) || !Number.isFinite(target[at])) continue
        const predDelta = clamp(model.alpha + model.beta * segFeature[at], -0.8, 0.8)
        const pred = segClose[at] * (1 + predDelta)
        localTrue.push(target[at])
        localPred.push(pred)
        localRef.push(segClose[at])
        ts.push(timestamps[start + at] ?? 0)
      }
      if (localTrue.length < 10) continue
      const localScore = evaluateScore(Float64Array.from(localTrue), Float64Array.from(localPred), Float64Array.from(localRef), [])
      foldErrors.push(localScore.composite)
      yTrue.push(...localTrue)
      yPred.push(...localPred)
      closeRef.push(...localRef)
    }
    if (yTrue.length < 40) return null
    return {
      yTrue: Float64Array.from(yTrue),
      yPred: Float64Array.from(yPred),
      closeRef: Float64Array.from(closeRef),
      timestamps: Float64Array.from(ts),
      foldErrors,
    }
  }

  const fitHoldout = (
    feature: Float64Array,
    horizon: number,
    holdoutStart: number,
    purgeBars: number,
  ): { yTrue: Float64Array; yPred: Float64Array; closeRef: Float64Array; timestamps: Float64Array } | null => {
    const target = shiftTarget(close, horizon)
    const targetDelta = new Float64Array(close.length)
    targetDelta.fill(Number.NaN)
    for (let i = 0; i < close.length; i += 1) {
      if (!Number.isFinite(target[i])) continue
      targetDelta[i] = (target[i] - close[i]) / (close[i] + 1e-9)
    }
    const trainEnd = Math.max(0, holdoutStart - purgeBars - horizon)
    const valEnd = close.length - horizon - 1
    if (trainEnd < 120 || valEnd - holdoutStart < 40) return null
    const trainIdx = new Int32Array(trainEnd)
    for (let i = 0; i < trainEnd; i += 1) trainIdx[i] = i
    const model = fitLinear1D(feature, targetDelta, trainIdx)
    if (!model) return null
    const yTrue: number[] = []
    const yPred: number[] = []
    const closeRef: number[] = []
    const ts: number[] = []
    for (let at = holdoutStart; at < valEnd; at += 1) {
      if (!Number.isFinite(feature[at]) || !Number.isFinite(target[at])) continue
      const predDelta = clamp(model.alpha + model.beta * feature[at], -0.8, 0.8)
      const pred = close[at] * (1 + predDelta)
      yTrue.push(target[at])
      yPred.push(pred)
      closeRef.push(close[at])
      ts.push(timestamps[at])
    }
    if (yTrue.length < 40) return null
    return {
      yTrue: Float64Array.from(yTrue),
      yPred: Float64Array.from(yPred),
      closeRef: Float64Array.from(closeRef),
      timestamps: Float64Array.from(ts),
    }
  }

  const pushCandidate = (cand: Omit<(typeof candidates)[number], 'novelty'>): void => {
    if (candidates.some((existing) => existing.id === cand.id)) return
    const series = sanitize(cand.feature)
    if (std(series) < 1e-8) return
    candidates.push({ ...cand, feature: series, novelty: 0 })
  }

  const ret1 = new Float64Array(close.length)
  for (let i = 1; i < close.length; i += 1) ret1[i] = (close[i] - close[i - 1]) / (close[i - 1] + 1e-9)
  pushCandidate({
    id: 'cand_ret1',
    expr: 'ret1(close)',
    pine: '(close - close[1]) / (close[1] + 1e-9)',
    family: 'regime_state',
    complexity: 2,
    feature: ret1,
  })
  const ret3 = new Float64Array(close.length)
  for (let i = 3; i < close.length; i += 1) ret3[i] = (close[i] - close[i - 3]) / (close[i - 3] + 1e-9)
  pushCandidate({
    id: 'cand_ret3',
    expr: 'ret3(close)',
    pine: '(close - close[3]) / (close[3] + 1e-9)',
    family: 'regime_state',
    complexity: 2,
    feature: ret3,
  })

  for (const w of windows) {
    const sma = rollingMean(close, w)
    const ratio = new Float64Array(close.length)
    for (let i = 0; i < close.length; i += 1) ratio[i] = close[i] / (sma[i] + 1e-9) - 1
    pushCandidate({
      id: `cand_sma_${w}`,
      expr: `div(close,sma(close,${w}))`,
      pine: `close / (ta.sma(close, ${w}) + 1e-9)`,
      family: 'trend_curvature',
      complexity: 4,
      feature: ratio,
    })
  }

  const ema8 = ema(close, 8)
  const ema21 = ema(close, 21)
  const emaGap = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) emaGap[i] = (ema8[i] - ema21[i]) / (Math.abs(ema21[i]) + 1e-9)
  pushCandidate({
    id: 'cand_ema_gap',
    expr: 'div(sub(ema(close,8),ema(close,21)),abs(ema(close,21)))',
    pine: '(ta.ema(close, 8) - ta.ema(close, 21)) / (math.abs(ta.ema(close, 21)) + 1e-9)',
    family: 'trend_curvature',
    complexity: 5,
    feature: emaGap,
  })

  const rsi14 = rsi(close, 14)
  const rsiCentered = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) rsiCentered[i] = (rsi14[i] - 50) / 50
  pushCandidate({
    id: 'cand_rsi14',
    expr: 'sub(rsi(close,14),50)',
    pine: '(ta.rsi(close, 14) - 50) / 50',
    family: 'regime_state',
    complexity: 4,
    feature: rsiCentered,
  })

  const retStd20 = rollingStd(ret1, 20)
  pushCandidate({
    id: 'cand_ret_std20',
    expr: 'std(ret1(close),20)',
    pine: 'ta.stdev((close-close[1])/(close[1]+1e-9), 20)',
    family: 'volatility_state',
    complexity: 4,
    feature: retStd20,
  })

  const range = new Float64Array(close.length)
  const rangeNorm = new Float64Array(close.length)
  const wickAsym = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) {
    range[i] = high[i] - low[i]
    rangeNorm[i] = range[i] / (Math.abs(close[i]) + 1e-9)
    const total = Math.max(range[i], 1e-9)
    const upper = high[i] - Math.max(open[i], close[i])
    const lower = Math.min(open[i], close[i]) - low[i]
    wickAsym[i] = (upper - lower) / total
  }

  const targetPool = Math.max(36, searchCfg.candidate_pool_size)
  const randomBudget = Math.max(24, targetPool - candidates.length)
  for (let i = 0; i < randomBudget; i += 1) {
    const mode = i % 5
    const a = windows[Math.floor(rng() * windows.length)]
    const b = windows[Math.floor(rng() * windows.length)]
    const c = windows[Math.floor(rng() * windows.length)]
    const fast = Math.min(a, b)
    const slow = Math.max(a, b)
    if (mode === 0) {
      const sa = rollingMean(close, fast)
      const sb = rollingMean(close, slow)
      const f = new Float64Array(close.length)
      for (let j = 0; j < close.length; j += 1) f[j] = (sa[j] - sb[j]) / (Math.abs(sb[j]) + 1e-9)
      pushCandidate({
        id: `cand_cross_${i}_${fast}_${slow}`,
        expr: `div(sub(sma(close,${fast}),sma(close,${slow})),abs(sma(close,${slow})))`,
        pine: `(ta.sma(close, ${fast}) - ta.sma(close, ${slow})) / (math.abs(ta.sma(close, ${slow})) + 1e-9)`,
        family: 'trend_curvature',
        complexity: 6,
        feature: f,
      })
      continue
    }
    if (mode === 1) {
      const s1 = rollingMean(close, Math.min(fast, c))
      const s2 = rollingMean(close, Math.max(fast, c))
      const s3 = rollingMean(close, Math.max(slow, c))
      const f = new Float64Array(close.length)
      for (let j = 0; j < close.length; j += 1) f[j] = (s1[j] - 2 * s2[j] + s3[j]) / (Math.abs(s3[j]) + 1e-9)
      pushCandidate({
        id: `cand_curve_${i}_${fast}_${slow}_${c}`,
        expr: `div(add(sub(sma(close,${fast}),mul(2,sma(close,${Math.max(fast, c)}))),sma(close,${Math.max(slow, c)})),abs(sma(close,${Math.max(slow, c)})))`,
        pine: `(ta.sma(close, ${fast}) - 2*ta.sma(close, ${Math.max(fast, c)}) + ta.sma(close, ${Math.max(slow, c)})) / (math.abs(ta.sma(close, ${Math.max(slow, c)})) + 1e-9)`,
        family: 'trend_curvature',
        complexity: 8,
        feature: f,
      })
      continue
    }
    if (mode === 2) {
      const vFast = rollingStd(ret1, fast)
      const vSlow = rollingStd(ret1, slow)
      const f = new Float64Array(close.length)
      for (let j = 0; j < close.length; j += 1) f[j] = vFast[j] / (vSlow[j] + 1e-9) - 1
      pushCandidate({
        id: `cand_vol_shift_${i}_${fast}_${slow}`,
        expr: `sub(div(std(ret1(close),${fast}),std(ret1(close),${slow})),1)`,
        pine: `(ta.stdev((close-close[1])/(close[1]+1e-9), ${fast}) / (ta.stdev((close-close[1])/(close[1]+1e-9), ${slow}) + 1e-9)) - 1`,
        family: 'volatility_state',
        complexity: 7,
        feature: f,
      })
      continue
    }
    if (mode === 3) {
      const rr = rollingMean(rangeNorm, Math.max(5, fast))
      const wr = ema(wickAsym, Math.max(5, slow))
      const f = new Float64Array(close.length)
      for (let j = 0; j < close.length; j += 1) f[j] = wr[j] * rr[j]
      pushCandidate({
        id: `cand_shape_${i}_${fast}_${slow}`,
        expr: `mul(ema(wick_asym,${Math.max(5, slow)}),sma(div(sub(high,low),close),${Math.max(5, fast)}))`,
        pine: `ta.ema(((high-math.max(open,close))-(math.min(open,close)-low))/(high-low+1e-9), ${Math.max(5, slow)}) * ta.sma((high-low)/(math.abs(close)+1e-9), ${Math.max(5, fast)})`,
        family: 'range_asymmetry',
        complexity: 8,
        feature: f,
      })
      continue
    }
    const volWindow = Math.max(5, fast)
    const volAvg = rollingMean(volume, volWindow)
    const f = new Float64Array(close.length)
    for (let j = 0; j < close.length; j += 1) {
      const volImpulse = volume[j] / (volAvg[j] + 1e-9) - 1
      f[j] = ret1[j] * volImpulse
    }
    pushCandidate({
      id: `cand_pv_${i}_${volWindow}`,
      expr: `mul(ret1(close),sub(div(volume,sma(volume,${volWindow})),1))`,
      pine: `((close-close[1])/(close[1]+1e-9)) * ((volume/(ta.sma(volume, ${volWindow})+1e-9))-1)`,
      family: 'price_volume_coupling',
      complexity: 7,
      feature: f,
    })
  }

  pushCandidate({ id: 'cand_range', expr: 'sub(high,low)', pine: 'high - low', family: 'range_asymmetry', complexity: 2, feature: range })
  pushCandidate({
    id: 'cand_range_norm',
    expr: 'div(sub(high,low),close)',
    pine: '(high-low)/(math.abs(close)+1e-9)',
    family: 'range_asymmetry',
    complexity: 3,
    feature: rangeNorm,
  })
  const volSma21 = rollingMean(volume, 21)
  const volRatio = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) volRatio[i] = volume[i] / (volSma21[i] + 1e-9) - 1
  pushCandidate({
    id: 'cand_volume_ratio',
    expr: 'div(volume,sma(volume,21))',
    pine: 'volume/(ta.sma(volume,21)+1e-9)',
    family: 'price_volume_coupling',
    complexity: 4,
    feature: volRatio,
  })
  pushCandidate({
    id: 'cand_wick_asym',
    expr: 'div(sub(upper_wick,lower_wick),range)',
    pine: '((high-math.max(open,close))-(math.min(open,close)-low))/(high-low+1e-9)',
    family: 'range_asymmetry',
    complexity: 5,
    feature: ema(wickAsym, 13),
  })

  const stageA: Array<{
    candidate: (typeof candidates)[number]
    horizon: number
    composite: number
  }> = []

  const acceptedExprs: string[] = []
  const acceptedSeries: Float64Array[] = []
  const totalBars = close.length
  const minTrainBars = 300
  const minModelBars = 140
  const minHoldoutBars = 120
  const holdoutBars = clampInt(Math.floor(totalBars * validationCfg.holdout_split), minHoldoutBars, Math.max(minHoldoutBars, totalBars - 220))
  const holdoutStart = Math.max(minTrainBars + minModelBars, totalBars - holdoutBars)
  const searchEndByRatio = Math.floor(totalBars * validationCfg.search_split)
  const searchEnd = clampInt(searchEndByRatio, minTrainBars, Math.max(minTrainBars, holdoutStart - minModelBars))
  const desiredModelBars = Math.max(minModelBars, Math.floor(totalBars * validationCfg.model_select_split))
  const modelStart = Math.max(searchEnd, holdoutStart - desiredModelBars)

  for (const candidate of candidates) {
    let maxSig = 0
    for (const expr of canonical) maxSig = Math.max(maxSig, similarity(candidate.expr, expr))
    for (const expr of acceptedExprs) maxSig = Math.max(maxSig, similarity(candidate.expr, expr))
    let maxCorr = 0
    for (const series of acceptedSeries) maxCorr = Math.max(maxCorr, seriesCorrAbs(candidate.feature, series))
    const orth = 1 - seriesCorrAbs(candidate.feature, ret1)
    candidate.novelty = clamp(0.45 * (1 - maxSig) + 0.35 * (1 - maxCorr) + 0.2 * orth, 0, 1)
    if (maxSig > searchCfg.novelty_similarity_threshold) continue
    if (maxCorr > searchCfg.collinearity_threshold) continue
    if (candidate.novelty < searchCfg.min_novelty_score) continue

    let bestH = 0
    let bestC = Number.POSITIVE_INFINITY
    for (let horizon = horizonCfg.min_bar; horizon <= horizonCfg.max_bar; horizon += Math.max(2, horizonCfg.coarse_step * 2)) {
      const fit = fitSegment(
        candidate.feature,
        0,
        searchEnd,
        horizon,
        2,
        Math.max(0, validationCfg.purge_bars),
        Math.max(0, validationCfg.embargo_bars),
      )
      if (!fit) continue
      const score = evaluateScore(fit.yTrue, fit.yPred, fit.closeRef, fit.foldErrors)
      if (score.composite < bestC) {
        bestC = score.composite
        bestH = horizon
      }
    }
    if (Number.isFinite(bestC) && bestH > 0) {
      stageA.push({ candidate, horizon: bestH, composite: bestC })
      acceptedExprs.push(candidate.expr)
      acceptedSeries.push(candidate.feature)
    }
  }

  stageA.sort((a, b) => a.composite - b.composite)
  const stageAKeep = stageA.slice(0, searchCfg.stage_a_keep)

  const evals: Array<{
    candidate: { id: string; expr: string; pine: string; family: string; novelty: number; complexity: number }
    horizon: number
    selectionComposite: number
    normalizedRmse: number
    normalizedMae: number
    calibration: number
    composite: number
    hitRate: number
    pnl: number
    maxDrawdown: number
    turnover: number
    stability: number
    yTrue: Float64Array
    yPred: Float64Array
    closeRef: Float64Array
    timestamps: Float64Array
    foldErrors: number[]
    baselineComposite: number
    holdoutPassed: boolean
    warnings: string[]
    horizonScores: Record<number, number>
    horizonDetails: Outcome['horizonDetails']
  }> = []

  for (const entry of stageAKeep.slice(0, Math.max(12, searchCfg.stage_b_keep * Math.max(2, searchCfg.tuning_trials)))) {
    const candidate = entry.candidate
    let bestLocal: {
      horizon: number
      selectionComposite: number
      normalizedRmse: number
      normalizedMae: number
      calibration: number
      composite: number
      hitRate: number
      pnl: number
      maxDrawdown: number
      turnover: number
      stability: number
      yTrue: Float64Array
      yPred: Float64Array
      closeRef: Float64Array
      timestamps: Float64Array
      foldErrors: number[]
      baselineComposite: number
      holdoutPassed: boolean
      warnings: string[]
    } | null = null
    const horizonScores: Record<number, number> = {}
    const horizonDetails: Outcome['horizonDetails'] = {}

    const refineStart = Math.max(horizonCfg.min_bar, entry.horizon - horizonCfg.refine_radius)
    const refineEnd = Math.min(horizonCfg.max_bar, entry.horizon + horizonCfg.refine_radius)
    for (let horizon = refineStart; horizon <= refineEnd; horizon += 1) {
      const fit = fitSegment(
        candidate.feature,
        modelStart,
        holdoutStart,
        horizon,
        validationCfg.folds,
        Math.max(0, validationCfg.purge_bars),
        Math.max(0, validationCfg.embargo_bars),
      )
      if (!fit) continue
      const modelScore = evaluateScore(fit.yTrue, fit.yPred, fit.closeRef, fit.foldErrors)
      const holdout = fitHoldout(candidate.feature, horizon, holdoutStart, Math.max(0, validationCfg.purge_bars))
      if (!holdout) continue
      const score = evaluateScore(holdout.yTrue, holdout.yPred, holdout.closeRef, fit.foldErrors)
      const baseline = evaluateScore(holdout.yTrue, holdout.closeRef, holdout.closeRef, [])
      const passed = score.composite <= baseline.composite - validationCfg.baseline_margin
      const warnings: string[] = []
      if (!passed) warnings.push('Holdout composite did not beat baseline margin.')
      horizonScores[horizon] = modelScore.composite
      horizonDetails[horizon] = {
        normalizedRmse: score.normalizedRmse,
        normalizedMae: score.normalizedMae,
        calibration: score.calibration,
        composite: score.composite,
        hitRate: score.hitRate,
        pnl: score.pnl,
        maxDrawdown: score.maxDrawdown,
        turnover: score.turnover,
        stability: score.stability,
      }
      if (!bestLocal || modelScore.composite < bestLocal.selectionComposite) {
        bestLocal = {
          horizon,
          selectionComposite: modelScore.composite,
          normalizedRmse: score.normalizedRmse,
          normalizedMae: score.normalizedMae,
          calibration: score.calibration,
          composite: score.composite,
          hitRate: score.hitRate,
          pnl: score.pnl,
          maxDrawdown: score.maxDrawdown,
          turnover: score.turnover,
          stability: score.stability,
          yTrue: holdout.yTrue,
          yPred: holdout.yPred,
          closeRef: holdout.closeRef,
          timestamps: holdout.timestamps,
          foldErrors: fit.foldErrors,
          baselineComposite: baseline.composite,
          holdoutPassed: passed,
          warnings,
        }
      }
    }
    if (!bestLocal) continue
    evals.push({
      candidate: {
        id: candidate.id,
        expr: candidate.expr,
        pine: candidate.pine,
        family: candidate.family,
        novelty: candidate.novelty,
        complexity: candidate.complexity,
      },
      horizon: bestLocal.horizon,
      selectionComposite: bestLocal.selectionComposite,
      normalizedRmse: bestLocal.normalizedRmse,
      normalizedMae: bestLocal.normalizedMae,
      calibration: bestLocal.calibration,
      composite: bestLocal.composite,
      hitRate: bestLocal.hitRate,
      pnl: bestLocal.pnl,
      maxDrawdown: bestLocal.maxDrawdown,
      turnover: bestLocal.turnover,
      stability: bestLocal.stability,
      yTrue: bestLocal.yTrue,
      yPred: bestLocal.yPred,
      closeRef: bestLocal.closeRef,
      timestamps: bestLocal.timestamps,
      foldErrors: bestLocal.foldErrors,
      baselineComposite: bestLocal.baselineComposite,
      holdoutPassed: bestLocal.holdoutPassed,
      warnings: bestLocal.warnings,
      horizonScores,
      horizonDetails,
    })
  }

  if (!evals.length) {
    throw new Error('No valid candidate found')
  }
  evals.sort((a, b) => a.selectionComposite - b.selectionComposite)
  const best = evals[0]
  const top = Float64Array.from(evals.slice(0, 6).map((entry) => entry.composite))
  const calibrationX = [-0.05, -0.03, -0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02, 0.03, 0.05]
  const calibrationY = new Array(calibrationX.length - 1).fill(0)
  const calibrationCount = new Array(calibrationX.length - 1).fill(0)
  for (let i = 0; i < best.yTrue.length; i += 1) {
    const pd = (best.yPred[i] - best.closeRef[i]) / (best.closeRef[i] + 1e-9)
    const td = (best.yTrue[i] - best.closeRef[i]) / (best.closeRef[i] + 1e-9)
    for (let b = 0; b < calibrationX.length - 1; b += 1) {
      if (pd >= calibrationX[b] && pd < calibrationX[b + 1]) {
        calibrationY[b] += td
        calibrationCount[b] += 1
        break
      }
    }
  }
  for (let i = 0; i < calibrationY.length; i += 1) {
    calibrationY[i] = calibrationCount[i] > 0 ? calibrationY[i] / calibrationCount[i] : 0
  }

  const cubeRows: Outcome['cubeRows'] = evals.flatMap((entry) =>
    Object.keys(entry.horizonDetails)
      .map((h) => Number(h))
      .filter((h) => Number.isFinite(h))
      .map((h) => ({
        indicator_id: entry.candidate.id,
        expression: entry.candidate.expr,
        family: entry.candidate.family,
        complexity: entry.candidate.complexity,
        novelty_score: entry.candidate.novelty,
        horizon_bar: h,
        horizon_time_ms: barsToMs(timeframe, h),
        normalized_rmse: entry.horizonDetails[h].normalizedRmse,
        normalized_mae: entry.horizonDetails[h].normalizedMae,
        calibration_error: entry.horizonDetails[h].calibration,
        composite_error: entry.horizonDetails[h].composite,
        directional_hit_rate: entry.horizonDetails[h].hitRate,
        pnl_total: entry.horizonDetails[h].pnl,
        max_drawdown: entry.horizonDetails[h].maxDrawdown,
        turnover: entry.horizonDetails[h].turnover,
        stability_score: entry.horizonDetails[h].stability,
      })),
  )

  const leakageFeature = new Float64Array(close.length)
  for (let i = 0; i < close.length - 1; i += 1) leakageFeature[i] = (close[i + 1] - close[i]) / (close[i] + 1e-9)
  const leakageFit = fitSegment(leakageFeature, 0, searchEnd, Math.max(horizonCfg.min_bar, 3), 2, 0, 0)
  const leakageTriggered = leakageFit ? evaluateScore(leakageFit.yTrue, leakageFit.yPred, leakageFit.closeRef, []).composite < best.composite * 0.8 : false
  const warnings: string[] = []
  if (!best.holdoutPassed) warnings.push('Selected indicator did not beat baseline margin on holdout.')
  if (!leakageTriggered) warnings.push('Leakage sentinel did not trigger strongly; review data leakage checks.')

  return {
    symbol: '',
    timeframe: '',
    timeframeMs: timeframeToMs(timeframe),
    candidateId: best.candidate.id,
    expression: best.candidate.expr,
    pine: best.candidate.pine,
    family: best.candidate.family,
    novelty: best.candidate.novelty,
    complexity: best.candidate.complexity,
    horizon: best.horizon,
    normalizedRmse: best.normalizedRmse,
    normalizedMae: best.normalizedMae,
    calibration: best.calibration,
    composite: best.composite,
    hitRate: best.hitRate,
    pnl: best.pnl,
    maxDrawdown: best.maxDrawdown,
    turnover: best.turnover,
    stability: 1 / (std(top) + 1e-6),
    equityCurve: backtest(best.yTrue, best.yPred, best.closeRef, 0.001).equity,
    horizonScores: best.horizonScores,
    horizonDetails: best.horizonDetails,
    frontier: evals.slice(0, 14).map((entry) => ({
      label: entry.candidate.id,
      expression: entry.candidate.expr,
      family: entry.candidate.family,
      novelty: entry.candidate.novelty,
      complexity: entry.candidate.complexity,
      error: entry.composite,
      hitRate: entry.hitRate,
      pnl: entry.pnl,
      calibration: entry.calibration,
      horizon: entry.horizon,
      pine: entry.candidate.pine,
    })),
    cubeRows,
    yTrue: best.yTrue,
    yPred: best.yPred,
    closeRef: best.closeRef,
    timestamps: best.timestamps,
    foldErrors: best.foldErrors,
    calibrationCurve: {
      x: calibrationX.slice(0, -1).map((v, i) => (v + calibrationX[i + 1]) / 2),
      y: calibrationY,
    },
    validation: {
      holdoutRows: best.yTrue.length,
      holdoutPassed: best.holdoutPassed,
      baselineComposite: best.baselineComposite,
      leakageSentinelTriggered: leakageTriggered,
      warnings,
    },
  }
}

type SliceMetric = NonNullable<PlotOptions['metric']>
type CubeRow = NonNullable<ResultSummary['indicator_cube']>[number]

function sliceMetricValue(row: CubeRow, metric: SliceMetric): number {
  switch (metric) {
    case 'directional_hit_rate':
      return row.directional_hit_rate
    case 'pnl_total':
      return row.pnl_total
    case 'calibration_error':
      return row.calibration_error
    case 'composite_error':
    default:
      return row.composite_error
  }
}

function lowerIsBetter(metric: SliceMetric): boolean {
  return metric === 'composite_error' || metric === 'calibration_error'
}

function metricLabel(metric: SliceMetric): string {
  switch (metric) {
    case 'directional_hit_rate':
      return 'Directional Hit Rate'
    case 'pnl_total':
      return 'PnL'
    case 'calibration_error':
      return 'Calibration Error'
    case 'composite_error':
    default:
      return 'Composite Error'
  }
}

function buildHorizonSlice(cubeRows: CubeRow[], options?: PlotOptions): {
  horizonMinutes: number
  metric: SliceMetric
  minNovelty: number
  rows: CubeRow[]
  assets: string[]
  indicators: string[]
  z: number[][]
} {
  const horizonMinutes = clampInt(Number(options?.horizon_minutes ?? 120), 5, 7 * 24 * 60)
  const metric: SliceMetric =
    options?.metric === 'directional_hit_rate' || options?.metric === 'pnl_total' || options?.metric === 'calibration_error'
      ? options.metric
      : 'composite_error'
  const minNovelty = Math.max(0, Math.min(1, Number(options?.min_novelty ?? 0)))
  const filtered = cubeRows.filter((row) => row.novelty_score >= minNovelty)
  const grouped = new Map<string, CubeRow[]>()
  for (const row of filtered) {
    const key = `${row.symbol}|${row.timeframe}|${row.indicator_id}`
    const bucket = grouped.get(key)
    if (!bucket) grouped.set(key, [row])
    else bucket.push(row)
  }
  const rows: CubeRow[] = []
  grouped.forEach((bucket) => {
    if (!bucket.length) return
    bucket.sort((a, b) => a.horizon_bar - b.horizon_bar)
    const targetBars = minutesToBars(bucket[0].timeframe, horizonMinutes)
    let best = bucket[0]
    let bestDist = Math.abs(best.horizon_bar - targetBars)
    for (let i = 1; i < bucket.length; i += 1) {
      const dist = Math.abs(bucket[i].horizon_bar - targetBars)
      if (dist < bestDist) {
        best = bucket[i]
        bestDist = dist
      }
    }
    rows.push(best)
  })

  const direction = lowerIsBetter(metric) ? 1 : -1
  rows.sort((a, b) => direction * (sliceMetricValue(a, metric) - sliceMetricValue(b, metric)))

  const assets = Array.from(new Set(rows.map((row) => `${row.symbol}:${row.timeframe}`))).sort()
  const indicators = Array.from(new Set(rows.map((row) => `${row.indicator_id} (${row.family})`)))
    .slice(0, 24)
    .sort()
  const z = assets.map((asset) =>
    indicators.map((indicator) => {
      const hit = rows.find((row) => `${row.symbol}:${row.timeframe}` === asset && `${row.indicator_id} (${row.family})` === indicator)
      return hit ? sliceMetricValue(hit, metric) : Number.NaN
    }),
  )

  return { horizonMinutes, metric, minNovelty, rows, assets, indicators, z }
}

function buildArtifacts(runId: string, outcomes: Outcome[]): { summary: ResultSummary; plots: Record<string, PlotPayload>; pine: Record<string, string> } {
  const per = outcomes
    .map((o) => ({
      symbol: o.symbol,
      timeframe: o.timeframe,
      best_horizon: o.horizon,
      best_horizon_ms: barsToMs(o.timeframe, o.horizon),
      best_horizon_label: horizonLabel(o.timeframe, o.horizon),
      indicator_combo: [
        {
          indicator_id: o.candidateId,
          expression: o.expression,
          complexity: o.complexity,
          params: { family: o.family, novelty: Number(o.novelty.toFixed(4)) },
        },
      ],
      score: {
        normalized_rmse: o.normalizedRmse,
        normalized_mae: o.normalizedMae,
        calibration_error: o.calibration,
        composite_error: o.composite,
        directional_hit_rate: o.hitRate,
        pnl_total: o.pnl,
        max_drawdown: o.maxDrawdown,
        turnover: o.turnover,
        stability_score: o.stability,
      },
    }))
    .sort((a, b) => a.score.composite_error - b.score.composite_error)

  const universalCandidate = per[0]
  const summary: ResultSummary = {
    schema_version: 'v2',
    run_id: runId,
    universal_recommendation: {
      symbol: 'UNIVERSAL',
      timeframe: Array.from(new Set(outcomes.map((o) => o.timeframe))).join('|'),
      best_horizon: universalCandidate.best_horizon,
      best_horizon_ms: universalCandidate.best_horizon_ms,
      best_horizon_label: universalCandidate.best_horizon_label,
      indicator_combo: universalCandidate.indicator_combo,
      score: universalCandidate.score,
    },
    per_asset_recommendations: per,
    validation_report: {
      leakage_checks_passed: outcomes.every((o) => o.validation.leakageSentinelTriggered && o.validation.holdoutPassed),
      leakage_sentinel_triggered: outcomes.every((o) => o.validation.leakageSentinelTriggered),
      holdout_rows: outcomes.reduce((acc, o) => acc + o.validation.holdoutRows, 0),
      holdout_pass_ratio: outcomes.filter((o) => o.validation.holdoutPassed).length / Math.max(outcomes.length, 1),
      baseline_rejection_rate: outcomes.filter((o) => !o.validation.holdoutPassed).length / Math.max(outcomes.length, 1),
      warnings: outcomes.flatMap((o) => o.validation.warnings),
    },
    horizon_metadata: {
      timeframe_ms: {
        '5m': timeframeToMs('5m'),
        '1h': timeframeToMs('1h'),
        '4h': timeframeToMs('4h'),
      },
      note: 'Bars-ahead is translated to wall-clock time based on source timeframe.',
    },
    per_indicator_frontier: outcomes.flatMap((o) =>
      o.frontier.map((entry) => ({
        symbol: o.symbol,
        timeframe: o.timeframe,
        indicator_id: entry.label,
        expression: entry.expression,
        family: entry.family,
        complexity: entry.complexity,
        novelty_score: entry.novelty,
        best_horizon: entry.horizon,
        best_horizon_ms: barsToMs(o.timeframe, entry.horizon),
        score: {
          normalized_rmse: o.horizonDetails[entry.horizon]?.normalizedRmse ?? o.normalizedRmse,
          normalized_mae: o.horizonDetails[entry.horizon]?.normalizedMae ?? o.normalizedMae,
          calibration_error: o.horizonDetails[entry.horizon]?.calibration ?? o.calibration,
          composite_error: entry.error,
          directional_hit_rate: entry.hitRate,
          pnl_total: entry.pnl,
          max_drawdown: o.horizonDetails[entry.horizon]?.maxDrawdown ?? o.maxDrawdown,
          turnover: o.horizonDetails[entry.horizon]?.turnover ?? o.turnover,
          stability_score: o.horizonDetails[entry.horizon]?.stability ?? o.stability,
        },
      })),
    ),
    indicator_cube: outcomes.flatMap((o) =>
      o.cubeRows.map((row) => ({
        symbol: o.symbol,
        timeframe: o.timeframe,
        ...row,
      })),
    ),
    generated_at: nowIso(),
  }

  const defaultSlice = buildHorizonSlice(summary.indicator_cube ?? [], { horizon_minutes: 120, metric: 'composite_error', min_novelty: 0 })
  const horizonMinutes = defaultSlice.horizonMinutes
  const slice = defaultSlice.rows
  const assets = defaultSlice.assets
  const indicators = defaultSlice.indicators
  const heatmap = defaultSlice.z

  const first = outcomes[0]
  const plots: Record<string, PlotPayload> = {
    indicator_horizon_heatmap: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'indicator_horizon_heatmap',
      title: `Indicator Horizon Heatmap (${horizonMinutes}m ahead, ${metricLabel(defaultSlice.metric)})`,
      payload: {
        type: 'heatmap',
        x: indicators,
        y: assets,
        z: heatmap,
        x_title: 'Indicator',
        y_title: 'Asset / Timeframe',
        z_title: metricLabel(defaultSlice.metric),
        lower_is_better: lowerIsBetter(defaultSlice.metric),
        horizon_minutes: horizonMinutes,
        metric: defaultSlice.metric,
        min_novelty: defaultSlice.minNovelty,
      },
    },
    horizon_slice_table: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'horizon_slice_table',
      title: `Horizon Slice Leaderboard (${horizonMinutes}m ahead)`,
      payload: {
        type: 'table',
        rows: slice
          .sort((a, b) =>
            lowerIsBetter(defaultSlice.metric)
              ? sliceMetricValue(a, defaultSlice.metric) - sliceMetricValue(b, defaultSlice.metric)
              : sliceMetricValue(b, defaultSlice.metric) - sliceMetricValue(a, defaultSlice.metric),
          )
          .slice(0, 80)
          .map((row, idx) => ({
            rank: idx + 1,
            asset: `${row.symbol}:${row.timeframe}`,
            indicator_id: row.indicator_id,
            family: row.family,
            formula: row.expression,
            novelty: row.novelty_score,
            horizon: `${row.horizon_bar} bars (${formatDurationMs(row.horizon_time_ms)} @ ${row.timeframe})`,
            composite_error: row.composite_error,
            calibration_error: row.calibration_error,
            directional_hit_rate: row.directional_hit_rate,
            pnl_total: row.pnl_total,
            selected_metric: metricLabel(defaultSlice.metric),
            selected_value: sliceMetricValue(row, defaultSlice.metric),
          })),
      },
    },
    forecast_overlay: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'forecast_overlay',
      title: first ? `Forecast Overlay (${first.symbol}:${first.timeframe})` : 'Forecast Overlay',
      payload: {
        type: 'line_time',
        x: Array.from(first?.timestamps.slice(0, 900) ?? []),
        series: first
          ? [
              { name: 'y_true', values: Array.from(first.yTrue.slice(0, 900)) },
              { name: 'y_pred', values: Array.from(first.yPred.slice(0, 900)) },
              { name: 'close_ref', values: Array.from(first.closeRef.slice(0, 900)) },
            ]
          : [],
        x_title: 'Timestamp',
        y_title: 'Price',
      },
    },
    calibration_curve: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'calibration_curve',
      title: first ? `Calibration Curve (${first.symbol}:${first.timeframe})` : 'Calibration Curve',
      payload: {
        type: 'line',
        x: first?.calibrationCurve.x ?? [],
        series: first
          ? [
              { name: 'observed_return', values: first.calibrationCurve.y },
              { name: 'ideal_y=x', values: first.calibrationCurve.x },
            ]
          : [],
        x_title: 'Predicted Return Bin',
        y_title: 'Observed Return',
      },
    },
    indicator_horizon_profile: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'indicator_horizon_profile',
      title: first ? `Indicator vs Horizon (${first.symbol}:${first.timeframe})` : 'Indicator vs Horizon',
      payload: {
        type: 'line',
        x: first
          ? Object.keys(first.horizonDetails)
              .map((value) => Number(value))
              .sort((a, b) => a - b)
          : [],
        series: first
          ? [
              {
                name: `${first.candidateId} composite`,
                values: Object.keys(first.horizonDetails)
                  .map((value) => Number(value))
                  .sort((a, b) => a - b)
                  .map((h) => first.horizonDetails[h]?.composite ?? Number.NaN),
              },
            ]
          : [],
        x_title: 'Horizon (bars)',
        y_title: 'Composite Error',
      },
    },
    stability_folds: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'stability_folds',
      title: 'Fold Stability Overview',
      payload: {
        type: 'bar',
        categories: outcomes.slice(0, 10).map((o) => `${o.symbol}:${o.timeframe}`),
        values: outcomes.slice(0, 10).map((o) => {
          if (!o.foldErrors.length) return Number.NaN
          return o.foldErrors.reduce((acc, val) => acc + val, 0) / o.foldErrors.length
        }),
        x_title: 'Asset / Timeframe',
        y_title: 'Mean Fold Composite Error',
      },
    },
    novelty_pareto: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'novelty_pareto',
      title: 'Novelty/Complexity vs Accuracy',
      payload: {
        type: 'scatter',
        points: outcomes.flatMap((outcome) =>
          outcome.frontier.map((point) => ({
            label: `${outcome.symbol}:${outcome.timeframe}:${point.label}`,
            complexity: point.complexity,
            error: point.error,
            hit_rate: point.hitRate,
            pnl: point.pnl,
            novelty: point.novelty,
          })),
        ),
      },
    },
    leaderboard: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'leaderboard',
      title: 'Asset Leaderboard',
      payload: {
        type: 'table',
        rows: per.map((row) => ({
          asset: `${row.symbol}:${row.timeframe}`,
          horizon: row.best_horizon_label,
          composite_error: row.score.composite_error,
          calibration_error: row.score.calibration_error,
          hit_rate: row.score.directional_hit_rate,
          pnl: row.score.pnl_total,
          turnover: row.score.turnover,
        })),
      },
    },
    formula_inspector: {
      schema_version: 'v2',
      run_id: runId,
      plot_id: 'formula_inspector',
      title: 'Formula Inspector',
      payload: {
        type: 'table',
        rows: outcomes.flatMap((outcome) =>
          outcome.frontier.slice(0, 3).map((entry) => ({
            asset: `${outcome.symbol}:${outcome.timeframe}`,
            indicator_id: entry.label,
            family: entry.family,
            novelty_score: entry.novelty,
            complexity: entry.complexity,
            best_horizon: `${entry.horizon} bars (${formatDurationMs(barsToMs(outcome.timeframe, entry.horizon))} @ ${outcome.timeframe})`,
            formula_dsl: entry.expression,
            explanation: `Family ${entry.family} signal with novelty ${entry.novelty.toFixed(2)} and complexity ${entry.complexity}.`,
            pine: entry.pine,
          })),
        ),
      },
    },
  }

  const pine: Record<string, string> = {}
  for (const outcome of outcomes.slice(0, 3)) {
    pine[`${outcome.symbol}_${outcome.timeframe}_indicator.pine`] =
      `//@version=6\n` +
      `indicator("${outcome.symbol} ${outcome.timeframe}", overlay=false)\n` +
      `horizon = ${outcome.horizon}\n` +
      `value = ${outcome.pine}\n` +
      `plot(value)\n`
  }
  pine['universal_indicator.pine'] =
    `//@version=6\n` +
    `indicator("Novel Indicator Universal", overlay=false)\n` +
    `horizon = ${summary.universal_recommendation.best_horizon}\n` +
    `value = ${outcomes[0]?.pine ?? 'close'}\n` +
    `plot(value)\n`

  return { summary, plots, pine }
}

function resolvePlot(bundle: RunBundle, plotId: string, options?: PlotOptions): PlotPayload | null {
  if (!bundle.summary) return null
  if (plotId === 'indicator_horizon_heatmap' || plotId === 'horizon_slice_table') {
    const slice = buildHorizonSlice(bundle.summary.indicator_cube ?? [], options)
    if (plotId === 'indicator_horizon_heatmap') {
      return {
        schema_version: 'v2',
        run_id: bundle.run.run_id,
        plot_id: 'indicator_horizon_heatmap',
        title: `Indicator Horizon Heatmap (${slice.horizonMinutes}m ahead, ${metricLabel(slice.metric)})`,
        payload: {
          type: 'heatmap',
          x: slice.indicators,
          y: slice.assets,
          z: slice.z,
          x_title: 'Indicator',
          y_title: 'Asset / Timeframe',
          z_title: metricLabel(slice.metric),
          lower_is_better: lowerIsBetter(slice.metric),
          horizon_minutes: slice.horizonMinutes,
          metric: slice.metric,
          min_novelty: slice.minNovelty,
        },
      }
    }
    return {
      schema_version: 'v2',
      run_id: bundle.run.run_id,
      plot_id: 'horizon_slice_table',
      title: `Horizon Slice Leaderboard (${slice.horizonMinutes}m ahead)`,
      payload: {
        type: 'table',
        rows: slice.rows
          .sort((a, b) =>
            lowerIsBetter(slice.metric)
              ? sliceMetricValue(a, slice.metric) - sliceMetricValue(b, slice.metric)
              : sliceMetricValue(b, slice.metric) - sliceMetricValue(a, slice.metric),
          )
          .slice(0, 120)
          .map((row, idx) => ({
            rank: idx + 1,
            asset: `${row.symbol}:${row.timeframe}`,
            indicator_id: row.indicator_id,
            family: row.family,
            formula: row.expression,
            novelty: row.novelty_score,
            horizon: `${row.horizon_bar} bars (${formatDurationMs(row.horizon_time_ms)} @ ${row.timeframe})`,
            composite_error: row.composite_error,
            calibration_error: row.calibration_error,
            directional_hit_rate: row.directional_hit_rate,
            pnl_total: row.pnl_total,
            selected_metric: metricLabel(slice.metric),
            selected_value: sliceMetricValue(row, slice.metric),
          })),
      },
    }
  }

  return bundle.plots[plotId] ?? null
}

async function executeRun(runIdValue: string): Promise<void> {
  const bundle = runs.get(runIdValue)
  if (!bundle) return

  const started = Date.now()
  let stageStart = Date.now()

  try {
    updateRun(bundle, 'running', 'universe', 0.05, 'Selecting Binance universe in browser...')
    addTelemetry(bundle, { stage: 'universe', working_on: 'Binance universe query', achieved: '0 symbols', remaining: 'pending', overall_progress: 0.05, stage_progress: 0.2, run_elapsed_sec: 0, stage_elapsed_sec: 0, eta_total_sec: null, eta_stage_sec: null, rate_units_per_sec: 0 })
    scheduleBundleSave(runIdValue, bundle)

    const symbols = await fetchTopSymbols(bundle, bundle.config.top_n_symbols)
    const outcomes: Outcome[] = []
    const totalJobs = Math.max(1, symbols.length * bundle.config.timeframes.length)
    const budgetSec = Math.max(60, bundle.config.budget_minutes * 60)
    let daysScale =
      bundle.config.advanced?.performance_profile === 'deep'
        ? 1.15
        : bundle.config.advanced?.performance_profile === 'balanced'
          ? 1
          : 0.85
    let done = 0

    updateRun(bundle, 'running', 'ingest', 0.15, `Ingesting ${symbols.length} symbols from Binance...`)
    scheduleBundleSave(runIdValue, bundle)

    for (const symbol of symbols) {
      for (const timeframe of bundle.config.timeframes) {
        if (cancelRuns.has(runIdValue)) throw new Error('Run canceled')
        stageStart = Date.now()
        updateRun(bundle, 'running', 'optimization', Math.min(0.85, 0.15 + done / totalJobs), `Optimizing ${symbol} ${timeframe} locally...`)
        const minPerJob = bundle.config.budget_minutes / Math.max(totalJobs, 1)
        const baseDays =
          timeframe === '5m'
            ? minPerJob < 3
              ? 70
              : minPerJob < 6
                ? 95
                : 130
            : timeframe === '1h'
              ? minPerJob < 3
                ? 260
                : minPerJob < 6
                  ? 380
                  : 620
              : minPerJob < 3
                ? 420
                : minPerJob < 6
                  ? 730
                  : 1_050
        const minDays = timeframe === '5m' ? 40 : timeframe === '1h' ? 160 : 280
        const days = Math.max(minDays, Math.floor(baseDays * daysScale))
        const rows = await fetchKlines(bundle, symbol, timeframe, days)
        if (rows.length > 600) {
          try {
            const seedBase = bundle.config.seed_mode === 'manual' ? bundle.config.random_seed ?? 42 : 42
            const outcome = evaluate(rows, stableSeed(seedBase, symbol, timeframe), bundle.config, timeframe)
            outcome.symbol = symbol
            outcome.timeframe = timeframe
            outcomes.push(outcome)
          } catch (error) {
            bundle.run.logs.push({
              timestamp: nowIso(),
              stage: 'optimization',
              message: `Skipped ${symbol} ${timeframe}: ${(error as Error).message}`,
            })
          }
        } else {
          bundle.run.logs.push({
            timestamp: nowIso(),
            stage: 'ingest',
            message: `Skipped ${symbol} ${timeframe}: insufficient candles (${rows.length}).`,
          })
        }
        done += 1
        const elapsedSec = Math.max((Date.now() - started) / 1000, 0.1)
        const avgPerJob = elapsedSec / Math.max(done, 1)
        const remainingJobs = Math.max(0, totalJobs - done)
        const projectedTotal = avgPerJob * totalJobs
        if (projectedTotal > budgetSec * 1.1 && daysScale > 0.55) {
          daysScale = Math.max(0.55, daysScale * 0.85)
          bundle.run.logs.push({
            timestamp: nowIso(),
            stage: 'optimization',
            message: `Adaptive downscale applied: reducing lookback depth to ${Math.round(daysScale * 100)}% to stay within budget.`,
          })
        }
        addTelemetry(bundle, {
          stage: 'optimization',
          working_on: `${symbol} ${timeframe}`,
          achieved: `${done}/${totalJobs} datasets`,
          remaining: `${remainingJobs} datasets`,
          overall_progress: Math.min(0.85, 0.15 + done / totalJobs),
          stage_progress: done / totalJobs,
          run_elapsed_sec: elapsedSec,
          stage_elapsed_sec: (Date.now() - stageStart) / 1000,
          eta_total_sec: avgPerJob * remainingJobs,
          eta_stage_sec: avgPerJob,
          rate_units_per_sec: done / elapsedSec,
        })
        scheduleBundleSave(runIdValue, bundle)
      }
    }

    if (!outcomes.length) throw new Error('No valid datasets produced results')

    updateRun(bundle, 'running', 'ranking', 0.92, 'Building summary and visual diagnostics...')
    const built = buildArtifacts(runIdValue, outcomes)
    bundle.summary = built.summary
    bundle.plots = built.plots
    bundle.pineScripts = built.pine
    updateRun(bundle, 'completed', 'finished', 1, 'Run completed fully in browser compute engine.')
    addTelemetry(bundle, { stage: 'finished', working_on: 'Complete', achieved: 'Run completed', remaining: '0', overall_progress: 1, stage_progress: 1, run_elapsed_sec: (Date.now() - started) / 1000, stage_elapsed_sec: (Date.now() - stageStart) / 1000, eta_total_sec: 0, eta_stage_sec: 0, rate_units_per_sec: done / Math.max((Date.now() - started) / 1000, 0.1) })
    scheduleBundleSave(runIdValue, bundle)
    await flushBundleSaves()
  } catch (error) {
    if ((error as Error).message === 'Run canceled') {
      updateRun(bundle, 'canceled', 'finished', 1, 'Run canceled by user.')
    } else {
      bundle.run.error = (error as Error).message
      updateRun(bundle, 'failed', 'finished', 1, `Run failed: ${(error as Error).message}`)
    }
    scheduleBundleSave(runIdValue, bundle)
    await flushBundleSaves()
  } finally {
    cancelRuns.delete(runIdValue)
  }
}

function listRuns(): RunStatus[] {
  return Array.from(runs.values())
    .map((bundle) => bundle.run)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

function storagePayload(bundle: RunBundle): Record<string, unknown> {
  return {
    run_id: bundle.run.run_id,
    source_version: 'web-local-v2',
    sync_state: 'synced',
    retained_at: nowIso(),
    config: bundle.config,
    summary: bundle.summary,
    plots: Object.values(bundle.plots).map((plot) => ({ plot_id: plot.plot_id, payload: plot.payload })),
  }
}

async function handle(req: RpcRequest): Promise<unknown> {
  await loadBundles()
  switch (req.method) {
    case 'init':
      return { ok: true }
    case 'createRun': {
      const activeRun = Array.from(runs.values()).find(
        (entry) => entry.run.status === 'queued' || entry.run.status === 'running',
      )
      if (activeRun) {
        throw new Error(`Run already active (${activeRun.run.run_id}). Cancel or wait before starting another.`)
      }
      const config = mergeRunConfig(req.params?.config as Partial<RunConfig> | undefined)
      const id = runId()
      const bundle = makeBundle(id, config)
      runs.set(id, bundle)
      await saveBundleNow(id, bundle)
      void executeRun(id)
      const created: RunCreated = { run_id: id, status: 'queued', created_at: bundle.run.created_at }
      return created
    }
    case 'listRuns':
      return listRuns()
    case 'getRun': {
      const id = String(req.params?.runId ?? '')
      const bundle = runs.get(id)
      if (!bundle) throw new Error('Run not found')
      return bundle.run
    }
    case 'getResults': {
      const id = String(req.params?.runId ?? '')
      const bundle = runs.get(id)
      if (!bundle?.summary) throw new Error('Results not found')
      return bundle.summary
    }
    case 'getPlot': {
      const id = String(req.params?.runId ?? '')
      const plotId = String(req.params?.plotId ?? '')
      const bundle = runs.get(id)
      if (!bundle) throw new Error('Run not found')
      const options = req.params?.options as PlotOptions | undefined
      const plot = resolvePlot(bundle, plotId, options)
      if (!plot) throw new Error('Plot not found')
      return plot
    }
    case 'getTelemetry': {
      const id = String(req.params?.runId ?? '')
      const limit = Number(req.params?.limit ?? 300)
      const bundle = runs.get(id)
      if (!bundle) throw new Error('Run not found')
      const feed: TelemetryFeed = { run_id: id, snapshots: bundle.telemetry.slice(-Math.max(1, Math.min(2000, limit))) }
      return feed
    }
    case 'getBinanceDiagnostics': {
      const id = String(req.params?.runId ?? '')
      const limit = Number(req.params?.limit ?? 40)
      const bundle = runs.get(id)
      if (!bundle) throw new Error('Run not found')
      const feed: BinanceDiagnosticsFeed = {
        run_id: id,
        calls: bundle.binanceCalls.slice(-Math.max(1, Math.min(240, limit))),
      }
      return feed
    }
    case 'cancelRun': {
      const id = String(req.params?.runId ?? '')
      if (!runs.has(id)) throw new Error('Run not found')
      cancelRuns.add(id)
      return { ok: true }
    }
    case 'generateReport': {
      const id = String(req.params?.runId ?? '')
      const bundle = runs.get(id)
      if (!bundle?.summary) throw new Error('Run not found')
      return { html: buildReportHtml(bundle) }
    }
    case 'exportPine': {
      const id = String(req.params?.runId ?? '')
      const bundle = runs.get(id)
      if (!bundle?.summary) throw new Error('Run not found')
      return { files: bundle.pineScripts }
    }
    case 'exportRunBundle': {
      const id = String(req.params?.runId ?? '')
      const bundle = runs.get(id)
      if (!bundle?.summary) throw new Error('Run not found')
      return buildRunExportBundle(bundle)
    }
    case 'getRunStoragePayload': {
      const id = String(req.params?.runId ?? '')
      const bundle = runs.get(id)
      if (!bundle?.summary) throw new Error('Run not found')
      return storagePayload(bundle)
    }
    default:
      throw new Error(`Unknown method ${req.method}`)
  }
}

self.onmessage = async (event: MessageEvent<RpcRequest>) => {
  const req = event.data
  if (!req?.id || !req.method) return
  try {
    const result = await handle(req)
    const response: RpcResponse = { id: req.id, ok: true, result }
    self.postMessage(response)
  } catch (error) {
    const response: RpcResponse = { id: req.id, ok: false, error: (error as Error).message }
    self.postMessage(response)
  }
}
