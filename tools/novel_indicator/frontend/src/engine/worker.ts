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

type OhlcvRow = { timestamp: number; high: number; low: number; close: number; volume: number }

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

function linearFit(feature: Float64Array, close: Float64Array, target: Float64Array): { yTrue: Float64Array; yPred: Float64Array; closeRef: Float64Array } {
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < close.length; i += 1) {
    if (!Number.isFinite(target[i])) continue
    const f = feature[i]
    if (!Number.isFinite(f)) continue
    x.push(f)
    y.push((target[i] - close[i]) / (close[i] + 1e-9))
  }
  if (x.length < 50) {
    return { yTrue: new Float64Array(), yPred: new Float64Array(), closeRef: new Float64Array() }
  }

  let xx = 0
  let xy = 0
  for (let i = 0; i < x.length; i += 1) {
    xx += x[i] * x[i]
    xy += x[i] * y[i]
  }
  const beta = xy / (xx + 1e-9)

  const yTrue: number[] = []
  const yPred: number[] = []
  const closeRef: number[] = []
  for (let i = 0; i < close.length; i += 1) {
    if (!Number.isFinite(target[i]) || !Number.isFinite(feature[i])) continue
    const pred = close[i] * (1 + Math.max(-0.8, Math.min(0.8, beta * feature[i])))
    yTrue.push(target[i])
    yPred.push(pred)
    closeRef.push(close[i])
  }
  return {
    yTrue: Float64Array.from(yTrue),
    yPred: Float64Array.from(yPred),
    closeRef: Float64Array.from(closeRef),
  }
}

async function fetchTopSymbols(bundle: RunBundle, topN: number): Promise<string[]> {
  const response = await fetch('https://api.binance.com/api/v3/ticker/24hr')
  recordBinanceCall(bundle, '/api/v3/ticker/24hr', response)
  if (!response.ok) throw new Error(`Binance universe request failed (${response.status})`)
  const rows = (await response.json()) as Array<{ symbol: string; quoteVolume: string }>
  return rows
    .filter((r) => r.symbol.endsWith('USDT'))
    .filter((r) => !/(UP|DOWN|BULL|BEAR)/.test(r.symbol))
    .map((r) => ({ symbol: r.symbol, quoteVolume: Number(r.quoteVolume || '0') }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
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
    const response = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`)
    recordBinanceCall(bundle, '/api/v3/klines', response)
    if (!response.ok) throw new Error(`Binance klines failed (${response.status})`)
    const batch = (await response.json()) as Array<[number, string, string, string, string, string]>
    if (!batch.length) break
    for (const row of batch) {
      out.push({ timestamp: Number(row[0]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) })
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
  composite: number
  hitRate: number
  yTrue: Float64Array
  yPred: Float64Array
  closeRef: Float64Array
}

function evaluate(rows: OhlcvRow[], seed: number): Outcome {
  const close = Float64Array.from(rows.map((r) => r.close))
  const high = Float64Array.from(rows.map((r) => r.high))
  const low = Float64Array.from(rows.map((r) => r.low))
  const rng = seeded(seed)

  const candidates: Array<{ id: string; expr: string; pine: string; complexity: number; feature: Float64Array }> = []
  const windows = [5, 8, 13, 21, 34, 55]

  const ret1 = new Float64Array(close.length)
  for (let i = 1; i < close.length; i += 1) ret1[i] = (close[i] - close[i - 1]) / (close[i - 1] + 1e-9)
  candidates.push({ id: 'cand_ret1', expr: 'ret1(close)', pine: '(close - close[1]) / (close[1] + 1e-9)', complexity: 2, feature: ret1 })

  for (const w of windows) {
    const sma = rollingMean(close, w)
    const ratio = new Float64Array(close.length)
    for (let i = 0; i < close.length; i += 1) ratio[i] = close[i] / (sma[i] + 1e-9)
    candidates.push({ id: `cand_sma_${w}`, expr: `div(close,sma(close,${w}))`, pine: `close / (ta.sma(close, ${w}) + 1e-9)`, complexity: 4, feature: ratio })
  }

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

  let best: Outcome | null = null
  for (const candidate of candidates) {
    for (let horizon = 3; horizon <= 200; horizon += 12) {
      const target = shiftTarget(close, horizon)
      const fit = linearFit(candidate.feature, close, target)
      const nrmse = rmse(fit.yTrue, fit.yPred) / (std(fit.yTrue) + 1e-9)
      const nmae = mae(fit.yTrue, fit.yPred) / (Math.max(std(fit.yTrue), 1e-9))
      const composite = 0.5 * (nrmse + nmae)
      let hits = 0
      for (let i = 0; i < fit.yTrue.length; i += 1) {
        const d1 = Math.sign(fit.yTrue[i] - fit.closeRef[i])
        const d2 = Math.sign(fit.yPred[i] - fit.closeRef[i])
        if (d1 === d2) hits += 1
      }
      const hitRate = fit.yTrue.length ? hits / fit.yTrue.length : 0
      if (!best || composite < best.composite) {
        best = {
          symbol: '',
          timeframe: '',
          candidateId: candidate.id,
          expression: candidate.expr,
          pine: candidate.pine,
          complexity: candidate.complexity,
          horizon,
          composite,
          hitRate,
          yTrue: fit.yTrue,
          yPred: fit.yPred,
          closeRef: fit.closeRef,
        }
      }
    }
  }

  if (!best) {
    throw new Error('No valid candidate found')
  }
  return best
}

function buildArtifacts(runId: string, outcomes: Outcome[]): { summary: ResultSummary; plots: Record<string, PlotPayload>; pine: Record<string, string> } {
  const per = outcomes
    .map((o) => ({
      symbol: o.symbol,
      timeframe: o.timeframe,
      best_horizon: o.horizon,
      indicator_combo: [{ indicator_id: o.candidateId, expression: o.expression, complexity: o.complexity, params: {} }],
      score: {
        normalized_rmse: o.composite,
        normalized_mae: o.composite,
        composite_error: o.composite,
        directional_hit_rate: o.hitRate,
        pnl_total: 0,
        max_drawdown: 0,
        turnover: 0,
        stability_score: 1 / (o.composite + 1e-6),
      },
    }))
    .sort((a, b) => a.score.composite_error - b.score.composite_error)

  const summary: ResultSummary = {
    run_id: runId,
    universal_recommendation: {
      symbol: 'UNIVERSAL',
      timeframe: '5m|1h|4h',
      best_horizon: per[0]?.best_horizon ?? 3,
      indicator_combo: per[0]?.indicator_combo ?? [],
      score: per[0]?.score ?? {
        normalized_rmse: 0,
        normalized_mae: 0,
        composite_error: 9999,
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
  const plots: Record<string, PlotPayload> = {
    horizon_heatmap: { run_id: runId, plot_id: 'horizon_heatmap', title: 'Error by Horizon', payload: { type: 'heatmap', x: [3, 15, 27, 39], y: per.map((r) => `${r.symbol}:${r.timeframe}`), z: per.map((r) => [r.score.composite_error, r.score.composite_error, r.score.composite_error, r.score.composite_error]) } },
    forecast_overlay: { run_id: runId, plot_id: 'forecast_overlay', title: 'Forecast Overlay', payload: { type: 'line', x: Array.from({ length: Math.min(500, first?.yTrue.length ?? 0) }, (_, i) => i), series: [{ name: 'y_true', values: Array.from(first?.yTrue?.slice(0, 500) ?? []) }, { name: 'y_pred', values: Array.from(first?.yPred?.slice(0, 500) ?? []) }] } },
    novelty_pareto: { run_id: runId, plot_id: 'novelty_pareto', title: 'Novelty/Complexity vs Accuracy', payload: { type: 'scatter', points: outcomes.map((o) => ({ label: `${o.symbol}:${o.timeframe}:${o.candidateId}`, complexity: o.complexity, error: o.composite })) } },
    timeframe_error: { run_id: runId, plot_id: 'timeframe_error', title: 'Composite Error by Timeframe', payload: { type: 'bar', categories: Array.from(new Set(per.map((r) => r.timeframe))), values: Array.from(new Set(per.map((r) => r.timeframe))).map((tf) => { const rows = per.filter((r) => r.timeframe === tf); return rows.reduce((acc, row) => acc + row.score.composite_error, 0) / Math.max(rows.length, 1) }) } },
  }

  const pine: Record<string, string> = {}
  for (const rec of per.slice(0, 3)) {
    const expr = rec.indicator_combo[0].expression
    pine[`${rec.symbol}_${rec.timeframe}_indicator.pine`] = `//@version=6\nindicator("${rec.symbol} ${rec.timeframe}", overlay=false)\nvalue = ${expr}\nplot(value)`
  }
  pine['universal_indicator.pine'] = `//@version=6\nindicator("Novel Indicator Universal", overlay=false)\nvalue = close\nplot(value)`

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
        const days = timeframe === '5m' ? 90 : timeframe === '1h' ? 365 : 365 * 2
        const rows = await fetchKlines(bundle, symbol, timeframe, days)
        if (rows.length > 600) {
          const outcome = evaluate(rows, stableSeed(bundle.config.random_seed, symbol, timeframe))
          outcome.symbol = symbol
          outcome.timeframe = timeframe
          outcomes.push(outcome)
        }
        done += 1
        addTelemetry(bundle, {
          stage: 'optimization',
          working_on: `${symbol} ${timeframe}`,
          achieved: `${done}/${totalJobs} datasets`,
          remaining: `${Math.max(0, totalJobs - done)} datasets`,
          overall_progress: Math.min(0.85, 0.15 + done / totalJobs),
          stage_progress: done / totalJobs,
          run_elapsed_sec: (Date.now() - started) / 1000,
          stage_elapsed_sec: (Date.now() - stageStart) / 1000,
          eta_total_sec: null,
          eta_stage_sec: null,
          rate_units_per_sec: done / Math.max((Date.now() - started) / 1000, 0.1),
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
    .map((r) => `<tr><td>${r.symbol}</td><td>${r.timeframe}</td><td>${r.best_horizon}</td><td>${r.score.composite_error.toFixed(6)}</td></tr>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Novel Indicator Report</title><style>body{font-family:Arial;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}</style></head><body><h1>Novel Indicator Report</h1><p>Run ${bundle.summary.run_id}</p><p>Generated ${bundle.summary.generated_at}</p><table><thead><tr><th>Symbol</th><th>TF</th><th>Horizon</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
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
    'composite_error',
    'directional_hit_rate',
    'pnl_total',
    'max_drawdown',
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
      rec.score.composite_error,
      rec.score.directional_hit_rate,
      rec.score.pnl_total,
      rec.score.max_drawdown,
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
