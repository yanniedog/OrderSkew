import { useEffect, useMemo, useState } from 'react'
import {
  cancelRun,
  createRun,
  exportPine,
  generateReport,
  getApiBase,
  getHealth,
  getPlot,
  getResults,
  getTelemetry,
  listRuns,
  resetApiBaseToDefault,
  setApiBase,
} from '../api/client'
import type { PlotPayload, ResultSummary, RunConfig, RunStatus, TelemetrySnapshot } from '../api/types'
import { PlotPanel } from '../components/PlotPanel'

const PLOTS = ['horizon_heatmap', 'forecast_overlay', 'novelty_pareto', 'timeframe_error']
const TIMEFRAME_OPTIONS = ['5m', '1h', '4h'] as const

const PRESET_CONFIGS = {
  quick: {
    top_n_symbols: 3,
    timeframes: ['5m'],
    budget_minutes: 15,
    random_seed: 42,
  },
  balanced: {
    top_n_symbols: 6,
    timeframes: ['5m', '1h'],
    budget_minutes: 35,
    random_seed: 42,
  },
  deep: {
    top_n_symbols: 10,
    timeframes: ['5m', '1h', '4h'],
    budget_minutes: 90,
    random_seed: 42,
  },
} as const satisfies Record<string, RunConfig>

type PresetKey = keyof typeof PRESET_CONFIGS | 'custom'
type ConnectionState = 'checking' | 'online' | 'offline'

function fmtSecs(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return 'n/a'
  }
  const total = Math.round(value)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function loadDemoSummary(): Promise<{ summary: ResultSummary; plots: Record<string, PlotPayload>; run: RunStatus }> {
  const summary = (await fetch('./demo/result_summary.json').then((r) => r.json())) as ResultSummary
  const loadedPlots: Record<string, PlotPayload> = {}
  await Promise.all(
    PLOTS.map(async (plotId) => {
      const response = await fetch(`./demo/plots/${plotId}.json`)
      if (!response.ok) {
        return
      }
      const payload = (await response.json()) as { title?: string; [k: string]: unknown }
      loadedPlots[plotId] = {
        run_id: summary.run_id,
        plot_id: plotId,
        title: payload.title ?? plotId,
        payload,
      }
    }),
  )

  const now = new Date().toISOString()
  const run: RunStatus = {
    run_id: summary.run_id,
    status: 'completed',
    stage: 'finished',
    progress: 1,
    created_at: now,
    updated_at: now,
    config_hash: 'demo',
    logs: [{ timestamp: now, stage: 'finished', message: 'Demo dataset loaded from static artifacts.' }],
  }

  return { summary, plots: loadedPlots, run }
}

export function App() {
  const [runs, setRuns] = useState<RunStatus[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [summary, setSummary] = useState<ResultSummary | null>(null)
  const [summaryRunId, setSummaryRunId] = useState<string | null>(null)
  const [plots, setPlots] = useState<Record<string, PlotPayload>>({})
  const [plotsRunId, setPlotsRunId] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingCreate, setLoadingCreate] = useState(false)
  const [loadingPlots, setLoadingPlots] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [ecoMode, setEcoMode] = useState(true)
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase())
  const [preset, setPreset] = useState<PresetKey>('balanced')
  const [runConfig, setRunConfig] = useState<RunConfig>(PRESET_CONFIGS.balanced)

  const selectedRun = useMemo(() => runs.find((r) => r.run_id === selectedRunId) ?? null, [runs, selectedRunId])
  const latestTelemetry = useMemo(() => telemetry[telemetry.length - 1] ?? null, [telemetry])
  const canStartRun = connectionState === 'online' && !demoMode
  const plotsLoaded = plotsRunId === selectedRunId && Object.keys(plots).length > 0

  const refreshRunsOnce = async (signal?: AbortSignal): Promise<void> => {
    try {
      const data = await listRuns({ signal, timeoutMs: 9_000, retries: 1 })
      setRuns(data)
      if (!selectedRunId && data.length > 0) {
        setSelectedRunId(data[0].run_id)
      }
      setError(null)
    } catch (e) {
      if (!isAbortError(e)) {
        setError((e as Error).message)
      }
    }
  }

  const checkConnection = async (): Promise<boolean> => {
    setConnectionState('checking')
    try {
      await getHealth({ timeoutMs: 3_000, retries: 0 })
      setConnectionState('online')
      return true
    } catch {
      setConnectionState('offline')
      return false
    }
  }

  useEffect(() => {
    let active = true
    const init = async () => {
      const online = await checkConnection()
      if (!active) {
        return
      }
      if (online) {
        const controller = new AbortController()
        await refreshRunsOnce(controller.signal)
      }
    }
    void init()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (demoMode || connectionState !== 'online') {
      return
    }

    let active = true
    let timer: number | null = null
    let controller: AbortController | null = null

    const loop = async () => {
      if (!active) {
        return
      }
      controller?.abort()
      controller = new AbortController()
      await refreshRunsOnce(controller.signal)
      if (!active) {
        return
      }
      const hidden = document.visibilityState !== 'visible'
      const interval = hidden ? 15_000 : ecoMode ? 8_000 : 4_000
      timer = window.setTimeout(loop, interval)
    }

    void loop()
    return () => {
      active = false
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      controller?.abort()
    }
  }, [demoMode, connectionState, ecoMode, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || demoMode || connectionState !== 'online') {
      setTelemetry([])
      return
    }

    let active = true
    let timer: number | null = null
    let controller: AbortController | null = null

    const loop = async () => {
      if (!active) {
        return
      }
      controller?.abort()
      controller = new AbortController()
      try {
        const feed = await getTelemetry(selectedRunId, ecoMode ? 120 : 240, {
          signal: controller.signal,
          timeoutMs: 7_000,
          retries: 1,
        })
        setTelemetry(feed.snapshots)
      } catch (e) {
        if (!isAbortError(e)) {
          setTelemetry([])
        }
      }
      if (!active) {
        return
      }
      const hidden = document.visibilityState !== 'visible'
      const interval = hidden ? 12_000 : ecoMode ? 5_000 : 2_500
      timer = window.setTimeout(loop, interval)
    }

    void loop()
    return () => {
      active = false
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      controller?.abort()
    }
  }, [selectedRunId, demoMode, connectionState, ecoMode])

  useEffect(() => {
    if (!selectedRunId || demoMode || connectionState !== 'online') {
      return
    }
    const run = runs.find((r) => r.run_id === selectedRunId)
    if (!run || run.status !== 'completed') {
      setSummary(null)
      setSummaryRunId(null)
      setPlots({})
      setPlotsRunId(null)
      return
    }
    if (summaryRunId === selectedRunId) {
      return
    }

    const controller = new AbortController()
    const load = async () => {
      try {
        const result = await getResults(selectedRunId, { signal: controller.signal, timeoutMs: 9_000, retries: 1 })
        setSummary(result)
        setSummaryRunId(selectedRunId)
        setPlots({})
        setPlotsRunId(null)
      } catch (e) {
        if (!isAbortError(e)) {
          setError((e as Error).message)
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [runs, selectedRunId, summaryRunId, demoMode, connectionState])

  const loadPlots = async (): Promise<void> => {
    if (!selectedRunId || !summary || loadingPlots || (connectionState !== 'online' && !demoMode)) {
      return
    }
    setLoadingPlots(true)
    setError(null)
    try {
      const loaded: Record<string, PlotPayload> = {}
      await Promise.all(
        PLOTS.map(async (plotId) => {
          try {
            loaded[plotId] = await getPlot(selectedRunId, plotId, { timeoutMs: 10_000, retries: 1 })
          } catch {
            // optional payloads
          }
        }),
      )
      setPlots(loaded)
      setPlotsRunId(selectedRunId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingPlots(false)
    }
  }

  const onCreate = async () => {
    if (!canStartRun) {
      setError('Local compute engine is offline. Start the backend and retry.')
      return
    }
    setLoadingCreate(true)
    setError(null)
    try {
      const created = await createRun(runConfig, { timeoutMs: 30_000 })
      setSelectedRunId(created.run_id)
      await refreshRunsOnce()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingCreate(false)
    }
  }

  const onLoadDemo = async () => {
    setError(null)
    try {
      const demo = await loadDemoSummary()
      setDemoMode(true)
      setRuns([demo.run])
      setSelectedRunId(demo.run.run_id)
      setSummary(demo.summary)
      setSummaryRunId(demo.run.run_id)
      setPlots(demo.plots)
      setPlotsRunId(demo.run.run_id)
      setTelemetry([])
    } catch (e) {
      setError(`Unable to load bundled demo data: ${(e as Error).message}`)
    }
  }

  const onRetryConnection = async () => {
    setDemoMode(false)
    setError(null)
    const online = await checkConnection()
    if (online) {
      await refreshRunsOnce()
    }
  }

  const onApplyEndpoint = async () => {
    const normalized = setApiBase(apiBaseInput)
    setApiBaseInput(normalized)
    setDemoMode(false)
    setError(null)
    const online = await checkConnection()
    if (online) {
      await refreshRunsOnce()
    }
  }

  const onResetEndpoint = async () => {
    const normalized = resetApiBaseToDefault()
    setApiBaseInput(normalized)
    setDemoMode(false)
    setError(null)
    const online = await checkConnection()
    if (online) {
      await refreshRunsOnce()
    }
  }

  const applyPreset = (nextPreset: Exclude<PresetKey, 'custom'>) => {
    setPreset(nextPreset)
    setRunConfig({ ...PRESET_CONFIGS[nextPreset] })
  }

  const updateConfigNumber = (key: keyof Pick<RunConfig, 'top_n_symbols' | 'budget_minutes' | 'random_seed'>, value: number) => {
    setPreset('custom')
    setRunConfig((prev) => ({ ...prev, [key]: value }))
  }

  const toggleTimeframe = (timeframe: (typeof TIMEFRAME_OPTIONS)[number]) => {
    setPreset('custom')
    setRunConfig((prev) => {
      const current = new Set(prev.timeframes)
      if (current.has(timeframe)) {
        current.delete(timeframe)
      } else {
        current.add(timeframe)
      }
      const next = TIMEFRAME_OPTIONS.filter((tf) => current.has(tf))
      return { ...prev, timeframes: next.length > 0 ? next : [timeframe] }
    })
  }

  return (
    <div className="page-shell">
      <div className="aurora" />
      <header className="top-header">
        <div className="header-line">
          <div>
            <h1>Novel Indicator Lab</h1>
            <p>Static public UI + local compute engine. Heavy processing stays on the user machine, not your web server.</p>
          </div>
          <span className={`status-pill ${connectionState}`}>{demoMode ? 'DEMO MODE' : connectionState.toUpperCase()}</span>
        </div>

        <div className="endpoint-row">
          <label>
            Local API endpoint
            <input
              value={apiBaseInput}
              onChange={(e) => setApiBaseInput(e.target.value)}
              placeholder="http://127.0.0.1:8000/api"
              spellCheck={false}
            />
          </label>
          <button onClick={onApplyEndpoint}>Apply Endpoint</button>
          <button className="secondary" onClick={onResetEndpoint}>
            Reset
          </button>
          <button className="secondary" onClick={onRetryConnection}>
            Retry Engine
          </button>
        </div>

        <div className="run-config-grid">
          <label>
            Preset
            <select value={preset} onChange={(e) => applyPreset(e.target.value as Exclude<PresetKey, 'custom'>)}>
              <option value="quick">Quick</option>
              <option value="balanced">Balanced</option>
              <option value="deep">Deep</option>
              <option value="custom" disabled>
                Custom
              </option>
            </select>
          </label>
          <label>
            Symbols
            <input
              type="number"
              min={1}
              max={30}
              value={runConfig.top_n_symbols}
              onChange={(e) => updateConfigNumber('top_n_symbols', clampInt(Number(e.target.value), 1, 30))}
            />
          </label>
          <label>
            Budget (min)
            <input
              type="number"
              min={5}
              max={240}
              value={runConfig.budget_minutes}
              onChange={(e) => updateConfigNumber('budget_minutes', clampInt(Number(e.target.value), 5, 240))}
            />
          </label>
          <label>
            Random seed
            <input
              type="number"
              min={1}
              max={99999}
              value={runConfig.random_seed}
              onChange={(e) => updateConfigNumber('random_seed', clampInt(Number(e.target.value), 1, 99999))}
            />
          </label>
        </div>

        <div className="timeframe-row">
          <span>Timeframes</span>
          <div className="chips">
            {TIMEFRAME_OPTIONS.map((tf) => (
              <button key={tf} className={`chip ${runConfig.timeframes.includes(tf) ? 'chip-on' : ''}`} onClick={() => toggleTimeframe(tf)}>
                {tf}
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={ecoMode} onChange={(e) => setEcoMode(e.target.checked)} />
            <span>Eco polling mode</span>
          </label>
        </div>

        <div className="controls">
          <button onClick={onCreate} disabled={loadingCreate || !canStartRun}>
            {loadingCreate ? 'Launching...' : 'Start Run'}
          </button>
          {selectedRunId && !demoMode && (
            <button className="secondary" onClick={() => cancelRun(selectedRunId)}>
              Cancel Run
            </button>
          )}
          {selectedRunId && !demoMode && (
            <button className="secondary" onClick={() => generateReport(selectedRunId)}>
              Rebuild PDF
            </button>
          )}
          {selectedRunId && !demoMode && (
            <button className="secondary" onClick={() => exportPine(selectedRunId, 3)}>
              Export Pine
            </button>
          )}
          {connectionState === 'offline' && (
            <button className="secondary" onClick={onLoadDemo}>
              Load Demo Dataset
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel runs-panel">
        <h2>Runs</h2>
        <div className="run-list">
          {runs.map((run) => (
            <button
              key={run.run_id}
              className={`run-item ${selectedRunId === run.run_id ? 'selected' : ''}`}
              onClick={() => setSelectedRunId(run.run_id)}
            >
              <div>
                <strong>{run.run_id}</strong>
                <span>{run.status.toUpperCase()}</span>
              </div>
              <div>
                <small>{run.stage}</small>
                <small>{Math.round(run.progress * 100)}%</small>
              </div>
            </button>
          ))}
          {runs.length === 0 && <p className="inline-note">No runs available yet.</p>}
        </div>
      </section>

      <section className="panel monitor-panel">
        <h2>Run Monitor</h2>
        {selectedRun ? (
          <>
            <div className="kpis">
              <div>
                <label>Status</label>
                <span>{selectedRun.status}</span>
              </div>
              <div>
                <label>Stage</label>
                <span>{selectedRun.stage}</span>
              </div>
              <div>
                <label>Progress</label>
                <span>{Math.round(selectedRun.progress * 100)}%</span>
              </div>
              <div>
                <label>Updated</label>
                <span>{new Date(selectedRun.updated_at).toLocaleString()}</span>
              </div>
            </div>
            <div className="log-panel">
              {selectedRun.logs.slice(-30).map((log, idx) => (
                <div key={`${log.timestamp}-${idx}`} className="log-row">
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <b>{log.stage}</b>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>No run selected.</p>
        )}
      </section>

      <section className="panel telemetry-panel">
        <h2>Live Telemetry</h2>
        {latestTelemetry ? (
          <>
            <div className="telemetry-bars">
              <div>
                <label>Overall {Math.round(latestTelemetry.overall_progress * 100)}%</label>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, latestTelemetry.overall_progress * 100))}%` }} />
                </div>
              </div>
              <div>
                <label>Current Task {Math.round(latestTelemetry.stage_progress * 100)}%</label>
                <div className="bar-track">
                  <div className="bar-fill bar-fill-alt" style={{ width: `${Math.max(0, Math.min(100, latestTelemetry.stage_progress * 100))}%` }} />
                </div>
              </div>
            </div>
            <div className="kpis">
              <div>
                <label>Working On</label>
                <span>{latestTelemetry.working_on}</span>
              </div>
              <div>
                <label>Elapsed / ETA</label>
                <span>
                  {fmtSecs(latestTelemetry.run_elapsed_sec)} / {fmtSecs(latestTelemetry.eta_total_sec)}
                </span>
              </div>
              <div>
                <label>Task Elapsed / ETA</label>
                <span>
                  {fmtSecs(latestTelemetry.stage_elapsed_sec)} / {fmtSecs(latestTelemetry.eta_stage_sec)}
                </span>
              </div>
              <div>
                <label>Rate</label>
                <span>{latestTelemetry.rate_units_per_sec.toFixed(4)} u/s</span>
              </div>
              <div>
                <label>CPU (sys/proc)</label>
                <span>
                  {latestTelemetry.system_cpu_percent.toFixed(1)}% / {latestTelemetry.process_cpu_percent.toFixed(1)}%
                </span>
              </div>
              <div>
                <label>RAM</label>
                <span>
                  {latestTelemetry.ram_used_gb.toFixed(2)} / {latestTelemetry.ram_total_gb.toFixed(2)} GB (
                  {latestTelemetry.ram_percent.toFixed(1)}%)
                </span>
              </div>
              <div>
                <label>CPU Temp</label>
                <span>{latestTelemetry.cpu_temp_c == null ? 'n/a' : `${latestTelemetry.cpu_temp_c.toFixed(1)} C`}</span>
              </div>
            </div>
            <div className="telemetry-footnote">
              <strong>Achieved:</strong> {latestTelemetry.achieved}
              <br />
              <strong>Remaining:</strong> {latestTelemetry.remaining}
            </div>
          </>
        ) : (
          <p>Telemetry appears once the selected run starts writing snapshots.</p>
        )}
      </section>

      <section className="panel results-panel">
        <div className="results-header">
          <h2>Results Explorer</h2>
          {summary && !plotsLoaded && (
            <button className="secondary" onClick={loadPlots} disabled={loadingPlots}>
              {loadingPlots ? 'Loading Plots...' : 'Load Plots'}
            </button>
          )}
        </div>
        {summary ? (
          <>
            <div className="universal-card">
              <h3>Universal Recommendation</h3>
              <p>
                Horizon: <b>{summary.universal_recommendation.best_horizon}</b> bars | Composite Error:{' '}
                <b>{summary.universal_recommendation.score.composite_error.toFixed(6)}</b>
              </p>
              <ul>
                {summary.universal_recommendation.indicator_combo.map((i) => (
                  <li key={i.indicator_id}>
                    <code>{i.indicator_id}</code> {i.expression}
                  </li>
                ))}
              </ul>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>TF</th>
                    <th>Horizon</th>
                    <th>Error</th>
                    <th>HitRate</th>
                    <th>PnL</th>
                    <th>MaxDD</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.per_asset_recommendations.slice(0, 30).map((rec) => (
                    <tr key={`${rec.symbol}-${rec.timeframe}`}>
                      <td>{rec.symbol}</td>
                      <td>{rec.timeframe}</td>
                      <td>{rec.best_horizon}</td>
                      <td>{rec.score.composite_error.toFixed(6)}</td>
                      <td>{rec.score.directional_hit_rate.toFixed(3)}</td>
                      <td>{rec.score.pnl_total.toFixed(4)}</td>
                      <td>{rec.score.max_drawdown.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Results will appear when the selected run is completed.</p>
        )}
      </section>

      <section className="panel plots-panel">
        <h2>Visual Diagnostics</h2>
        {plotsLoaded ? (
          <div className="plot-grid">
            {Object.values(plots).map((plot) => (
              <PlotPanel key={plot.plot_id} plot={plot} />
            ))}
          </div>
        ) : (
          <p>Plot payloads are not loaded yet. Use the Load Plots button to reduce browser memory usage.</p>
        )}
      </section>
    </div>
  )
}
