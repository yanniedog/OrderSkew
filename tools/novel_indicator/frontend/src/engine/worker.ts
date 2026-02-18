/// <reference lib="webworker" />

import type {
  BinanceCallDiagnostic,
  BinanceDiagnosticsFeed,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunCreated,
  RunStageEnum,
  RunStatus,
  TelemetryFeed,
  TelemetrySnapshot,
} from '../api/types'

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
}

type RunExportFile = {
  path: string
  content: string
  mime: string
}

type RunExportBundle = {
  run_id: string
  generated_at: string
  files: RunExportFile[]
}

type OhlcvRow = { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

const DEFAULT_CONFIG: RunConfig = {
  top_n_symbols: 6,
  timeframes: ['5m', '1h'],
  budget_minutes: 35,
  random_seed: 42,
}

const DB_NAME = 'novel-indicator-browser-db'
const STORE_NAME = 'runs'

let dbPromise: Promise<IDBDatabase> | null = null
let initialized = false
const runs = new Map<string, RunBundle>()
const cancelRuns = new Set<string>()

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

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB open error'))
  })
  return dbPromise
}

async function saveBundle(id: string, bundle: RunBundle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ id, bundle })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB write error'))
  })
}

async function loadBundles(): Promise<void> {
  if (initialized) return
  const db = await openDb()
  const rows = await new Promise<Array<{ id: string; bundle: RunBundle }>>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as Array<{ id: string; bundle: RunBundle }>)
    req.onerror = () => reject(req.error ?? new Error('IDB read error'))
  })
  for (const row of rows) {
    if (row?.id && row.bundle) {
      runs.set(row.id, row.bundle)
    }
  }
  initialized = true
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
    config,
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

function rollingMean(values: Float64Array, window: number): Float64Array {
  const out = new Float64Array(values.length)
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= window) sum -= values[i - window]
    out[i] = i >= window - 1 ? sum / window : values[i]
  }
  return out
}

function std(values: Float64Array): number {
  if (!values.length) return 1
  let mean = 0
  for (const v of values) mean += v
  mean /= values.length
  let acc = 0
  for (const v of values) {
    const d = v - mean
    acc += d * d
  }
  return Math.sqrt(Math.max(acc / values.length, 1e-9))
}

function mae(a: Float64Array, b: Float64Array): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i])
  return n ? sum / n : 9999
}

function rmse(a: Float64Array, b: Float64Array): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return n ? Math.sqrt(sum / n) : 9999
}

function shiftTarget(close: Float64Array, h: number): Float64Array {
  const out = new Float64Array(close.length)
  out.fill(Number.NaN)
  for (let i = 0; i < close.length - h; i += 1) out[i] = close[i + h]
  return out
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function rollingStd(values: Float64Array, window: number): Float64Array {
  const out = new Float64Array(values.length)
  const c1 = new Float64Array(values.length + 1)
  const c2 = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i += 1) {
    c1[i + 1] = c1[i] + values[i]
    c2[i + 1] = c2[i] + values[i] * values[i]
  }
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1)
    const count = i - start + 1
    const sum = c1[i + 1] - c1[start]
    const sum2 = c2[i + 1] - c2[start]
    const avg = sum / count
    out[i] = Math.sqrt(Math.max(sum2 / count - avg * avg, 0))
  }
  return out
}

function ema(values: Float64Array, window: number): Float64Array {
  const out = new Float64Array(values.length)
  if (!values.length) return out
  const alpha = 2 / (window + 1)
  out[0] = values[0]
  for (let i = 1; i < values.length; i += 1) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
  }
  return out
}

function rsi(close: Float64Array, window: number): Float64Array {
  const up = new Float64Array(close.length)
  const down = new Float64Array(close.length)
  for (let i = 1; i < close.length; i += 1) {
    const d = close[i] - close[i - 1]
    if (d > 0) up[i] = d
    else down[i] = -d
  }
  const upEma = ema(up, window)
  const downEma = ema(down, window)
  const out = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) {
    const rs = upEma[i] / (downEma[i] + 1e-9)
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

type Fold = { trainIdx: Int32Array; valIdx: Int32Array }

function buildWalkForwardFolds(n: number, horizon: number): Fold[] {
  const usable = n - horizon - 1
  if (usable < 320) return []
  const folds = 4
  const chunk = Math.floor(usable / (folds + 1))
  if (chunk < 60) return []
  const output: Fold[] = []
  for (let i = 0; i < folds; i += 1) {
    const trainEnd = chunk * (i + 1)
    const valStart = trainEnd + horizon
    const valEnd = Math.min(valStart + chunk, usable)
    const trainLen = Math.max(0, trainEnd - horizon)
    const valLen = Math.max(0, valEnd - valStart)
    if (trainLen < 120 || valLen < 40) continue
    const trainIdx = new Int32Array(trainLen)
    for (let j = 0; j < trainLen; j += 1) trainIdx[j] = j
    const valIdx = new Int32Array(valLen)
    for (let j = 0; j < valLen; j += 1) valIdx[j] = valStart + j
    output.push({ trainIdx, valIdx })
  }
  return output
}

function fitLinear1D(feature: Float64Array, targetDelta: Float64Array, idx: Int32Array): { alpha: number; beta: number } | null {
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let count = 0
  for (let i = 0; i < idx.length; i += 1) {
    const at = idx[i]
    const x = feature[at]
    const y = targetDelta[at]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
    count += 1
  }
  if (count < 80) return null
  const mx = sx / count
  const my = sy / count
  const varX = sxx - sx * mx
  if (Math.abs(varX) < 1e-9) return null
  const covXY = sxy - sx * my
  const beta = covXY / varX
  const alpha = my - beta * mx
  return { alpha, beta }
}

function linearFit(feature: Float64Array, close: Float64Array, target: Float64Array, horizon: number): { yTrue: Float64Array; yPred: Float64Array; closeRef: Float64Array } {
  const folds = buildWalkForwardFolds(close.length, horizon)
  if (!folds.length) return { yTrue: new Float64Array(), yPred: new Float64Array(), closeRef: new Float64Array() }

  const targetDelta = new Float64Array(close.length)
  targetDelta.fill(Number.NaN)
  for (let i = 0; i < close.length; i += 1) {
    if (!Number.isFinite(target[i])) continue
    targetDelta[i] = (target[i] - close[i]) / (close[i] + 1e-9)
  }

  const yTrue: number[] = []
  const yPred: number[] = []
  const closeRef: number[] = []
  for (const fold of folds) {
    const model = fitLinear1D(feature, targetDelta, fold.trainIdx)
    if (!model) continue
    for (let i = 0; i < fold.valIdx.length; i += 1) {
      const at = fold.valIdx[i]
      if (!Number.isFinite(feature[at]) || !Number.isFinite(target[at])) continue
      const predDelta = clamp(model.alpha + model.beta * feature[at], -0.8, 0.8)
      const pred = close[at] * (1 + predDelta)
      yTrue.push(target[at])
      yPred.push(pred)
      closeRef.push(close[at])
    }
  }

  return {
    yTrue: Float64Array.from(yTrue),
    yPred: Float64Array.from(yPred),
    closeRef: Float64Array.from(closeRef),
  }
}

function backtest(yTrue: Float64Array, yPred: Float64Array, closeRef: Float64Array, threshold: number): { pnl: number; maxDrawdown: number; turnover: number; equity: number[] } {
  const n = Math.min(yTrue.length, yPred.length, closeRef.length)
  if (n < 5) {
    return { pnl: 0, maxDrawdown: 0, turnover: 0, equity: [] }
  }
  const fee = 0.0012
  const signal = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const f = (yPred[i] - closeRef[i]) / (closeRef[i] + 1e-9)
    if (f > threshold) signal[i] = 1
    else if (f < -threshold) signal[i] = -1
    else signal[i] = 0
  }

  const returns = new Float64Array(n)
  let turnover = 0
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  const curve: number[] = []
  for (let i = 0; i < n; i += 1) {
    const prev = i > 0 ? signal[i - 1] : 0
    const turn = Math.abs(signal[i] - prev)
    turnover += turn
    const realized = (yTrue[i] - closeRef[i]) / (closeRef[i] + 1e-9)
    const value = prev * realized - fee * turn
    returns[i] = value
    equity *= 1 + value
    if (equity > peak) peak = equity
    const dd = (equity - peak) / (peak + 1e-12)
    if (dd < maxDrawdown) maxDrawdown = dd
    curve.push(equity)
  }

  return {
    pnl: equity - 1,
    maxDrawdown,
    turnover: turnover / n,
    equity: curve,
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
  const intervals: Record<string, number> = { '5m': 300_000, '1h': 3_600_000, '4h': 14_400_000 }
  const end = Date.now()
  const start = end - days * 24 * 60 * 60 * 1000
  const step = intervals[timeframe] ?? 60_000
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
  return out
}

type Outcome = {
  symbol: string
  timeframe: string
  candidateId: string
  expression: string
  pine: string
  complexity: number
  horizon: number
  normalizedRmse: number
  normalizedMae: number
  composite: number
  hitRate: number
  pnl: number
  maxDrawdown: number
  turnover: number
  stability: number
  equityCurve: number[]
  horizonScores: Record<number, number>
  frontier: Array<{ label: string; complexity: number; error: number; hitRate: number }>
  yTrue: Float64Array
  yPred: Float64Array
  closeRef: Float64Array
}

function evaluate(rows: OhlcvRow[], seed: number): Outcome {
  const close = Float64Array.from(rows.map((r) => r.close))
  const high = Float64Array.from(rows.map((r) => r.high))
  const low = Float64Array.from(rows.map((r) => r.low))
  const volume = Float64Array.from(rows.map((r) => r.volume))
  const rng = seeded(seed)

  const candidates: Array<{ id: string; expr: string; pine: string; complexity: number; feature: Float64Array }> = []
  const windows = [5, 8, 13, 21, 34, 55]

  const ret1 = new Float64Array(close.length)
  for (let i = 1; i < close.length; i += 1) ret1[i] = (close[i] - close[i - 1]) / (close[i - 1] + 1e-9)
  candidates.push({ id: 'cand_ret1', expr: 'ret1(close)', pine: '(close - close[1]) / (close[1] + 1e-9)', complexity: 2, feature: ret1 })
  const ret3 = new Float64Array(close.length)
  for (let i = 3; i < close.length; i += 1) ret3[i] = (close[i] - close[i - 3]) / (close[i - 3] + 1e-9)
  candidates.push({ id: 'cand_ret3', expr: 'ret3(close)', pine: '(close - close[3]) / (close[3] + 1e-9)', complexity: 2, feature: ret3 })

  for (const w of windows) {
    const sma = rollingMean(close, w)
    const ratio = new Float64Array(close.length)
    for (let i = 0; i < close.length; i += 1) ratio[i] = close[i] / (sma[i] + 1e-9) - 1
    candidates.push({ id: `cand_sma_${w}`, expr: `div(close,sma(close,${w}))`, pine: `close / (ta.sma(close, ${w}) + 1e-9)`, complexity: 4, feature: ratio })
  }

  const ema8 = ema(close, 8)
  const ema21 = ema(close, 21)
  const emaGap = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) emaGap[i] = (ema8[i] - ema21[i]) / (Math.abs(ema21[i]) + 1e-9)
  candidates.push({
    id: 'cand_ema_gap',
    expr: 'div(sub(ema(close,8),ema(close,21)),abs(ema(close,21)))',
    pine: '(ta.ema(close, 8) - ta.ema(close, 21)) / (math.abs(ta.ema(close, 21)) + 1e-9)',
    complexity: 5,
    feature: emaGap,
  })

  const rsi14 = rsi(close, 14)
  const rsiCentered = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) rsiCentered[i] = (rsi14[i] - 50) / 50
  candidates.push({ id: 'cand_rsi14', expr: 'sub(rsi(close,14),50)', pine: '(ta.rsi(close, 14) - 50) / 50', complexity: 4, feature: rsiCentered })

  const retStd20 = rollingStd(ret1, 20)
  candidates.push({ id: 'cand_ret_std20', expr: 'std(ret1(close),20)', pine: 'ta.stdev((close-close[1])/(close[1]+1e-9), 20)', complexity: 4, feature: retStd20 })

  for (let i = 0; i < 24; i += 1) {
    const a = windows[Math.floor(rng() * windows.length)]
    const b = windows[Math.floor(rng() * windows.length)]
    const sa = rollingMean(close, a)
    const sb = rollingMean(close, b)
    const f = new Float64Array(close.length)
    for (let j = 0; j < close.length; j += 1) f[j] = (sa[j] - sb[j]) / (Math.abs(sb[j]) + 1e-9)
    candidates.push({
      id: `cand_combo_${i}`,
      expr: `div(sub(sma(close,${a}),sma(close,${b})),abs(sma(close,${b})))`,
      pine: `(ta.sma(close, ${a}) - ta.sma(close, ${b})) / (math.abs(ta.sma(close, ${b})) + 1e-9)`,
      complexity: 6,
      feature: f,
    })
  }

  const range = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) range[i] = high[i] - low[i]
  candidates.push({ id: 'cand_range', expr: 'sub(high,low)', pine: 'high - low', complexity: 2, feature: range })
  const rangeNorm = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) rangeNorm[i] = range[i] / (Math.abs(close[i]) + 1e-9)
  candidates.push({ id: 'cand_range_norm', expr: 'div(sub(high,low),close)', pine: '(high-low)/(math.abs(close)+1e-9)', complexity: 3, feature: rangeNorm })
  const volSma21 = rollingMean(volume, 21)
  const volRatio = new Float64Array(close.length)
  for (let i = 0; i < close.length; i += 1) volRatio[i] = volume[i] / (volSma21[i] + 1e-9) - 1
  candidates.push({ id: 'cand_volume_ratio', expr: 'div(volume,sma(volume,21))', pine: 'volume/(ta.sma(volume,21)+1e-9)', complexity: 4, feature: volRatio })

  const evals: Array<{
    candidate: { id: string; expr: string; pine: string; complexity: number }
    horizon: number
    normalizedRmse: number
    normalizedMae: number
    composite: number
    hitRate: number
    yTrue: Float64Array
    yPred: Float64Array
    closeRef: Float64Array
    horizonScores: Record<number, number>
  }> = []

  for (const candidate of candidates) {
    let bestLocal: {
      horizon: number
      normalizedRmse: number
      normalizedMae: number
      composite: number
      hitRate: number
      yTrue: Float64Array
      yPred: Float64Array
      closeRef: Float64Array
    } | null = null
    const horizonScores: Record<number, number> = {}

    for (let horizon = 3; horizon <= 200; horizon += 10) {
      const target = shiftTarget(close, horizon)
      const fit = linearFit(candidate.feature, close, target, horizon)
      if (fit.yTrue.length < 120) continue
      const nrmse = rmse(fit.yTrue, fit.yPred) / (std(fit.yTrue) + 1e-9)
      let absTargetDelta = 0
      for (let i = 0; i < fit.yTrue.length; i += 1) {
        absTargetDelta += Math.abs(fit.yTrue[i] - fit.closeRef[i])
      }
      const nmae = mae(fit.yTrue, fit.yPred) / (absTargetDelta / fit.yTrue.length + 1e-9)
      let hits = 0
      for (let i = 0; i < fit.yTrue.length; i += 1) {
        const d1 = Math.sign(fit.yTrue[i] - fit.closeRef[i])
        const d2 = Math.sign(fit.yPred[i] - fit.closeRef[i])
        if (d1 === d2) hits += 1
      }
      const hitRate = fit.yTrue.length ? hits / fit.yTrue.length : 0
      const composite = 0.48 * nrmse + 0.34 * nmae + 0.18 * (1 - hitRate)
      horizonScores[horizon] = composite
      if (!bestLocal || composite < bestLocal.composite) {
        bestLocal = {
          horizon,
          normalizedRmse: nrmse,
          normalizedMae: nmae,
          composite,
          hitRate,
          yTrue: fit.yTrue,
          yPred: fit.yPred,
          closeRef: fit.closeRef,
        }
      }
    }
    if (!bestLocal) continue
    evals.push({
      candidate: { id: candidate.id, expr: candidate.expr, pine: candidate.pine, complexity: candidate.complexity },
      horizon: bestLocal.horizon,
      normalizedRmse: bestLocal.normalizedRmse,
      normalizedMae: bestLocal.normalizedMae,
      composite: bestLocal.composite,
      hitRate: bestLocal.hitRate,
      yTrue: bestLocal.yTrue,
      yPred: bestLocal.yPred,
      closeRef: bestLocal.closeRef,
      horizonScores,
    })
  }

  if (!evals.length) {
    throw new Error('No valid candidate found')
  }
  evals.sort((a, b) => a.composite - b.composite)
  const best = evals[0]
  const bt = backtest(best.yTrue, best.yPred, best.closeRef, 0.001)
  const top = Float64Array.from(evals.slice(0, 6).map((entry) => entry.composite))
  return {
    symbol: '',
    timeframe: '',
    candidateId: best.candidate.id,
    expression: best.candidate.expr,
    pine: best.candidate.pine,
    complexity: best.candidate.complexity,
    horizon: best.horizon,
    normalizedRmse: best.normalizedRmse,
    normalizedMae: best.normalizedMae,
    composite: best.composite,
    hitRate: best.hitRate,
    pnl: bt.pnl,
    maxDrawdown: bt.maxDrawdown,
    turnover: bt.turnover,
    stability: 1 / (std(top) + 1e-6),
    equityCurve: bt.equity,
    horizonScores: best.horizonScores,
    frontier: evals.slice(0, 14).map((entry) => ({
      label: entry.candidate.id,
      complexity: entry.candidate.complexity,
      error: entry.composite,
      hitRate: entry.hitRate,
    })),
    yTrue: best.yTrue,
    yPred: best.yPred,
    closeRef: best.closeRef,
  }
}

function buildArtifacts(runId: string, outcomes: Outcome[]): { summary: ResultSummary; plots: Record<string, PlotPayload>; pine: Record<string, string> } {
  const per = outcomes
    .map((o) => ({
      symbol: o.symbol,
      timeframe: o.timeframe,
      best_horizon: o.horizon,
      indicator_combo: [{ indicator_id: o.candidateId, expression: o.expression, complexity: o.complexity, params: {} }],
      score: {
        normalized_rmse: o.normalizedRmse,
        normalized_mae: o.normalizedMae,
        composite_error: o.composite,
        directional_hit_rate: o.hitRate,
        pnl_total: o.pnl,
        max_drawdown: o.maxDrawdown,
        turnover: o.turnover,
        stability_score: o.stability,
      },
    }))
    .sort((a, b) => a.score.composite_error - b.score.composite_error)

  const comboAggregate = new Map<
    string,
    {
      count: number
      totalError: number
      totalHit: number
      totalPnl: number
      totalHorizon: number
      sample: Outcome
    }
  >()
  for (const outcome of outcomes) {
    const key = outcome.expression
    const existing = comboAggregate.get(key)
    if (!existing) {
      comboAggregate.set(key, {
        count: 1,
        totalError: outcome.composite,
        totalHit: outcome.hitRate,
        totalPnl: outcome.pnl,
        totalHorizon: outcome.horizon,
        sample: outcome,
      })
      continue
    }
    existing.count += 1
    existing.totalError += outcome.composite
    existing.totalHit += outcome.hitRate
    existing.totalPnl += outcome.pnl
    existing.totalHorizon += outcome.horizon
  }
  const bestUniversal = Array.from(comboAggregate.values()).sort((a, b) => {
    const scoreA = a.totalError / a.count + 0.03 * (1 - a.totalHit / a.count) + 0.05 * Math.max(0, -(a.totalPnl / a.count))
    const scoreB = b.totalError / b.count + 0.03 * (1 - b.totalHit / b.count) + 0.05 * Math.max(0, -(b.totalPnl / b.count))
    return scoreA - scoreB
  })[0]

  const universal = bestUniversal?.sample ?? outcomes[0]
  const summary: ResultSummary = {
    run_id: runId,
    universal_recommendation: {
      symbol: 'UNIVERSAL',
      timeframe: Array.from(new Set(outcomes.map((o) => o.timeframe))).join('|'),
      best_horizon: bestUniversal ? Math.round(bestUniversal.totalHorizon / bestUniversal.count) : universal?.horizon ?? 3,
      indicator_combo: universal ? [{ indicator_id: `${universal.candidateId}_u`, expression: universal.expression, complexity: universal.complexity, params: {} }] : [],
      score: universal
        ? {
            normalized_rmse: bestUniversal ? bestUniversal.totalError / bestUniversal.count : universal.normalizedRmse,
            normalized_mae: bestUniversal ? bestUniversal.totalError / bestUniversal.count : universal.normalizedMae,
            composite_error: bestUniversal ? bestUniversal.totalError / bestUniversal.count : universal.composite,
            directional_hit_rate: bestUniversal ? bestUniversal.totalHit / bestUniversal.count : universal.hitRate,
            pnl_total: bestUniversal ? bestUniversal.totalPnl / bestUniversal.count : universal.pnl,
            max_drawdown: universal.maxDrawdown,
            turnover: universal.turnover,
            stability_score: universal.stability,
          }
        : {
            normalized_rmse: 9_999,
            normalized_mae: 9_999,
            composite_error: 9_999,
            directional_hit_rate: 0,
            pnl_total: 0,
            max_drawdown: 0,
            turnover: 0,
            stability_score: 0,
          },
    },
    per_asset_recommendations: per,
    generated_at: nowIso(),
  }

  const first = outcomes[0]
  const allHorizons = Array.from(
    new Set(
      outcomes.flatMap((outcome) =>
        Object.keys(outcome.horizonScores)
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value)),
      ),
    ),
  ).sort((a, b) => a - b)

  const timeframeCategories = Array.from(new Set(per.map((entry) => entry.timeframe)))
  const timeframeValues = timeframeCategories.map((tf) => {
    const rows = per.filter((entry) => entry.timeframe === tf)
    return rows.reduce((acc, row) => acc + row.score.composite_error, 0) / Math.max(rows.length, 1)
  })

  const equityLength = Math.min(900, ...outcomes.slice(0, 3).map((outcome) => outcome.equityCurve.length))
  const residualBins = [-0.06, -0.04, -0.025, -0.015, -0.0075, 0, 0.0075, 0.015, 0.025, 0.04, 0.06]
  const residualCounts = Array.from({ length: residualBins.length - 1 }, () => 0)
  if (first) {
    for (let i = 0; i < first.yTrue.length; i += 1) {
      const residual = (first.yPred[i] - first.yTrue[i]) / (Math.abs(first.closeRef[i]) + 1e-9)
      for (let b = 0; b < residualBins.length - 1; b += 1) {
        if (residual >= residualBins[b] && residual < residualBins[b + 1]) {
          residualCounts[b] += 1
          break
        }
      }
    }
  }

  const plots: Record<string, PlotPayload> = {
    horizon_heatmap: {
      run_id: runId,
      plot_id: 'horizon_heatmap',
      title: 'Error by Horizon',
      payload: {
        type: 'heatmap',
        x: allHorizons,
        y: per.map((row) => `${row.symbol}:${row.timeframe}`),
        z: outcomes.map((outcome) => allHorizons.map((h) => outcome.horizonScores[h] ?? Number.NaN)),
      },
    },
    forecast_overlay: {
      run_id: runId,
      plot_id: 'forecast_overlay',
      title: first ? `Forecast Overlay (${first.symbol}:${first.timeframe})` : 'Forecast Overlay',
      payload: {
        type: 'line',
        x: Array.from({ length: Math.min(700, first?.yTrue.length ?? 0) }, (_, i) => i),
        series: first
          ? [
              { name: 'y_true', values: Array.from(first.yTrue.slice(0, 700)) },
              { name: 'y_pred', values: Array.from(first.yPred.slice(0, 700)) },
              { name: 'close_ref', values: Array.from(first.closeRef.slice(0, 700)) },
            ]
          : [],
      },
    },
    novelty_pareto: {
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
            pnl: outcome.pnl,
          })),
        ),
      },
    },
    timeframe_error: {
      run_id: runId,
      plot_id: 'timeframe_error',
      title: 'Composite Error by Timeframe',
      payload: { type: 'bar', categories: timeframeCategories, values: timeframeValues },
    },
    leaderboard: {
      run_id: runId,
      plot_id: 'leaderboard',
      title: 'Asset Leaderboard',
      payload: {
        type: 'table',
        rows: per.map((row) => ({
          asset: `${row.symbol}:${row.timeframe}`,
          error: row.score.composite_error,
          hit_rate: row.score.directional_hit_rate,
          horizon: row.best_horizon,
          pnl: row.score.pnl_total,
          max_drawdown: row.score.max_drawdown,
          turnover: row.score.turnover,
          stability: row.score.stability_score,
        })),
      },
    },
    equity_curve: {
      run_id: runId,
      plot_id: 'equity_curve',
      title: 'Equity Curve (Top 3)',
      payload: {
        type: 'line',
        x: Array.from({ length: Math.max(0, equityLength) }, (_, i) => i),
        series: outcomes.slice(0, 3).map((outcome) => ({
          name: `${outcome.symbol}:${outcome.timeframe}`,
          values: outcome.equityCurve.slice(0, Math.max(0, equityLength)),
        })),
      },
    },
    residual_histogram: {
      run_id: runId,
      plot_id: 'residual_histogram',
      title: first ? `Residual Distribution (${first.symbol}:${first.timeframe})` : 'Residual Distribution',
      payload: {
        type: 'bar',
        categories: residualBins.slice(0, -1).map((left, idx) => `${left.toFixed(3)}..${residualBins[idx + 1].toFixed(3)}`),
        values: residualCounts,
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
  if (universal) {
    pine['universal_indicator.pine'] =
      `//@version=6\n` +
      `indicator("Novel Indicator Universal", overlay=false)\n` +
      `horizon = ${universal.horizon}\n` +
      `value = ${universal.pine}\n` +
      `plot(value)\n`
  } else {
    pine['universal_indicator.pine'] = `//@version=6\nindicator("Novel Indicator Universal", overlay=false)\nvalue = close\nplot(value)\n`
  }

  return { summary, plots, pine }
}

async function executeRun(runIdValue: string): Promise<void> {
  const bundle = runs.get(runIdValue)
  if (!bundle) return

  const started = Date.now()
  let stageStart = Date.now()

  try {
    updateRun(bundle, 'running', 'universe', 0.05, 'Selecting Binance universe in browser...')
    addTelemetry(bundle, { stage: 'universe', working_on: 'Binance universe query', achieved: '0 symbols', remaining: 'pending', overall_progress: 0.05, stage_progress: 0.2, run_elapsed_sec: 0, stage_elapsed_sec: 0, eta_total_sec: null, eta_stage_sec: null, rate_units_per_sec: 0 })
    await saveBundle(runIdValue, bundle)

    const symbols = await fetchTopSymbols(bundle, bundle.config.top_n_symbols)
    const outcomes: Outcome[] = []
    const totalJobs = Math.max(1, symbols.length * bundle.config.timeframes.length)
    let done = 0

    updateRun(bundle, 'running', 'ingest', 0.15, `Ingesting ${symbols.length} symbols from Binance...`)
    await saveBundle(runIdValue, bundle)

    for (const symbol of symbols) {
      for (const timeframe of bundle.config.timeframes) {
        if (cancelRuns.has(runIdValue)) throw new Error('Run canceled')
        stageStart = Date.now()
        updateRun(bundle, 'running', 'optimization', Math.min(0.85, 0.15 + done / totalJobs), `Optimizing ${symbol} ${timeframe} locally...`)
        const minPerJob = bundle.config.budget_minutes / Math.max(totalJobs, 1)
        const days = timeframe === '5m' ? (minPerJob < 3 ? 70 : minPerJob < 6 ? 95 : 130) : timeframe === '1h' ? (minPerJob < 3 ? 260 : minPerJob < 6 ? 380 : 620) : minPerJob < 3 ? 420 : minPerJob < 6 ? 730 : 1_050
        const rows = await fetchKlines(bundle, symbol, timeframe, days)
        if (rows.length > 600) {
          try {
            const outcome = evaluate(rows, stableSeed(bundle.config.random_seed, symbol, timeframe))
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
        await saveBundle(runIdValue, bundle)
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
    await saveBundle(runIdValue, bundle)
  } catch (error) {
    if ((error as Error).message === 'Run canceled') {
      updateRun(bundle, 'canceled', 'finished', 1, 'Run canceled by user.')
    } else {
      bundle.run.error = (error as Error).message
      updateRun(bundle, 'failed', 'finished', 1, `Run failed: ${(error as Error).message}`)
    }
    await saveBundle(runIdValue, bundle)
  } finally {
    cancelRuns.delete(runIdValue)
  }
}

function listRuns(): RunStatus[] {
  return Array.from(runs.values())
    .map((bundle) => bundle.run)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

function buildReportHtml(bundle: RunBundle): string {
  if (!bundle.summary) return '<html><body><h1>No report data.</h1></body></html>'
  const rows = bundle.summary.per_asset_recommendations
    .map(
      (r) =>
        `<tr><td>${r.symbol}</td><td>${r.timeframe}</td><td>${r.best_horizon}</td><td>${r.score.composite_error.toFixed(6)}</td><td>${r.score.directional_hit_rate.toFixed(3)}</td><td>${r.score.pnl_total.toFixed(4)}</td><td>${r.score.max_drawdown.toFixed(4)}</td><td>${r.score.turnover.toFixed(4)}</td><td>${r.score.stability_score.toFixed(3)}</td></tr>`,
    )
    .join('')
  const per = bundle.summary.per_asset_recommendations
  const avgError = per.length ? per.reduce((acc, row) => acc + row.score.composite_error, 0) / per.length : 0
  const avgHit = per.length ? per.reduce((acc, row) => acc + row.score.directional_hit_rate, 0) / per.length : 0
  const avgPnl = per.length ? per.reduce((acc, row) => acc + row.score.pnl_total, 0) / per.length : 0
  const positive = per.length ? per.filter((row) => row.score.pnl_total > 0).length / per.length : 0
  const warnings: string[] = []
  if (avgHit < 0.52) warnings.push('Directional hit rate below robust threshold.')
  if (avgPnl <= 0) warnings.push('Average post-cost pnl is non-positive.')
  if (avgError > 1.2) warnings.push('Composite error remains elevated.')
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>Novel Indicator Report</title>
      <style>
        :root{--ink:#122033;--muted:#455467;--line:#d8dfeb;--accent:#0b6bcb;--accent2:#d65a31}
        body{font-family:"Segoe UI",Arial,sans-serif;padding:24px;color:var(--ink)}
        h1,h2{margin:0 0 10px}
        p{margin:0 0 8px}
        .row{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px;margin:14px 0}
        .card{border:1px solid var(--line);border-radius:10px;padding:10px}
        .card label{display:block;color:var(--muted);font-size:12px}
        .card b{font-size:17px}
        table{width:100%;border-collapse:collapse;margin-top:14px}
        th,td{border:1px solid var(--line);padding:7px;font-size:12px;text-align:left}
        th{background:#f3f7fc}
        .pill{display:inline-block;background:#eef5ff;border:1px solid #d5e5fb;border-radius:999px;padding:4px 10px;font-size:12px;margin-right:6px}
        .warn{border:1px solid #f1c8b8;background:#fff6f1;border-radius:10px;padding:10px;margin-top:12px}
      </style>
    </head>
    <body>
      <h1>Novel Indicator Report</h1>
      <p>Run <b>${bundle.summary.run_id}</b> | Generated ${bundle.summary.generated_at}</p>
      <div class="row">
        <div class="card"><label>Avg Composite Error</label><b>${avgError.toFixed(5)}</b></div>
        <div class="card"><label>Avg Hit Rate</label><b>${(avgHit * 100).toFixed(2)}%</b></div>
        <div class="card"><label>Avg PnL</label><b>${avgPnl.toFixed(4)}</b></div>
        <div class="card"><label>Positive-PnL Assets</label><b>${(positive * 100).toFixed(1)}%</b></div>
      </div>
      <h2>Universal Recommendation</h2>
      <p>Horizon: <b>${bundle.summary.universal_recommendation.best_horizon}</b> bars | Composite Error: <b>${bundle.summary.universal_recommendation.score.composite_error.toFixed(6)}</b></p>
      <p>Hit Rate: <b>${bundle.summary.universal_recommendation.score.directional_hit_rate.toFixed(3)}</b> | PnL: <b>${bundle.summary.universal_recommendation.score.pnl_total.toFixed(4)}</b></p>
      <p>${bundle.summary.universal_recommendation.indicator_combo.map((entry) => `<span class="pill">${entry.indicator_id}</span>`).join('')}</p>
      <table>
        <thead><tr><th>Symbol</th><th>TF</th><th>Horizon</th><th>Error</th><th>Hit</th><th>PnL</th><th>MaxDD</th><th>Turnover</th><th>Stability</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${warnings.length ? `<div class="warn"><b>Quality warnings</b><ul>${warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul></div>` : ''}
    </body>
  </html>`
}

function csvCell(value: unknown): string {
  if (value == null) return ''
  const input = String(value)
  if (!/[,"\n]/.test(input)) return input
  return `"${input.replace(/"/g, '""')}"`
}

function buildRecommendationsCsv(summary: ResultSummary): string {
  const header = [
    'symbol',
    'timeframe',
    'best_horizon',
    'normalized_rmse',
    'normalized_mae',
    'composite_error',
    'directional_hit_rate',
    'pnl_total',
    'max_drawdown',
    'turnover',
    'stability_score',
    'indicator_ids',
    'indicator_expressions',
  ]
  const rows = summary.per_asset_recommendations.map((rec) => {
    const ids = rec.indicator_combo.map((entry) => entry.indicator_id).join('|')
    const expressions = rec.indicator_combo.map((entry) => entry.expression).join('|')
    return [
      rec.symbol,
      rec.timeframe,
      rec.best_horizon,
      rec.score.normalized_rmse,
      rec.score.normalized_mae,
      rec.score.composite_error,
      rec.score.directional_hit_rate,
      rec.score.pnl_total,
      rec.score.max_drawdown,
      rec.score.turnover,
      rec.score.stability_score,
      ids,
      expressions,
    ]
  })
  return [header, ...rows].map((row) => row.map((value) => csvCell(value)).join(',')).join('\n')
}

function toJsonl(rows: unknown[]): string {
  if (!rows.length) return ''
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
}

function buildRunExportBundle(bundle: RunBundle): RunExportBundle {
  if (!bundle.summary) {
    throw new Error('Run not found')
  }
  const generatedAt = nowIso()
  const files: RunExportFile[] = [
    {
      path: 'report/report.html',
      content: buildReportHtml(bundle),
      mime: 'text/html;charset=utf-8',
    },
    {
      path: 'run/run_status.json',
      content: JSON.stringify(bundle.run, null, 2),
      mime: 'application/json;charset=utf-8',
    },
    {
      path: 'run/config.json',
      content: JSON.stringify(bundle.config, null, 2),
      mime: 'application/json;charset=utf-8',
    },
    {
      path: 'results/summary.json',
      content: JSON.stringify(bundle.summary, null, 2),
      mime: 'application/json;charset=utf-8',
    },
    {
      path: 'results/per_asset_recommendations.csv',
      content: buildRecommendationsCsv(bundle.summary),
      mime: 'text/csv;charset=utf-8',
    },
  ]

  const sortedPlots = Object.values(bundle.plots).sort((a, b) => a.plot_id.localeCompare(b.plot_id))
  for (const plot of sortedPlots) {
    files.push({
      path: `plots/${plot.plot_id}.json`,
      content: JSON.stringify({ run_id: plot.run_id, plot_id: plot.plot_id, title: plot.title, payload: plot.payload }, null, 2),
      mime: 'application/json;charset=utf-8',
    })
  }

  const sortedPine = Object.entries(bundle.pineScripts).sort(([a], [b]) => a.localeCompare(b))
  for (const [name, content] of sortedPine) {
    files.push({
      path: `pine/${name}`,
      content,
      mime: 'text/plain;charset=utf-8',
    })
  }

  if (bundle.telemetry.length > 0) {
    files.push({
      path: 'telemetry/telemetry.jsonl',
      content: toJsonl(bundle.telemetry),
      mime: 'application/x-ndjson;charset=utf-8',
    })
  }

  if (bundle.binanceCalls.length > 0) {
    files.push({
      path: 'diagnostics/binance_calls.jsonl',
      content: toJsonl(bundle.binanceCalls),
      mime: 'application/x-ndjson;charset=utf-8',
    })
  }

  const manifest = {
    run_id: bundle.run.run_id,
    generated_at: generatedAt,
    file_count: files.length + 1,
    files: files.map((file) => ({ path: file.path, mime: file.mime })),
  }
  files.unshift({
    path: 'manifest.json',
    content: JSON.stringify(manifest, null, 2),
    mime: 'application/json;charset=utf-8',
  })

  return {
    run_id: bundle.run.run_id,
    generated_at: generatedAt,
    files,
  }
}

function storagePayload(bundle: RunBundle): Record<string, unknown> {
  return {
    run_id: bundle.run.run_id,
    source_version: 'web-local-v1',
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
      const config = { ...DEFAULT_CONFIG, ...(req.params?.config as Partial<RunConfig> | undefined) }
      const id = runId()
      const bundle = makeBundle(id, config)
      runs.set(id, bundle)
      await saveBundle(id, bundle)
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
      const plot = runs.get(id)?.plots[plotId]
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
