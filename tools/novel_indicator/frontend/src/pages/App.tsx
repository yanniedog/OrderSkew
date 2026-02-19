import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelRun,
  createRun,
  downloadRunBundle,
  exportPine,
  getBinanceDiagnostics,
  generateReport,
  getPlot,
  getResults,
  getTelemetry,
  listRuns,
} from '../api/client'
import type {
  AdvancedRunConfig,
  BinanceCallDiagnostic,
  PlotOptions,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunStatus,
  TelemetrySnapshot,
} from '../api/types'
import { PlotPanel } from '../components/PlotPanel'
import { barsToMs, formatDurationMs } from '../utils/timeframe'
import {
  clampFloat,
  clampInt,
  DEFAULT_ADVANCED,
  LOCAL_PREFS_KEY,
  PLOTS,
  PRESET_CONFIGS,
  type PresetKey,
  TIMEFRAME_OPTIONS,
  withDefaults,
} from './App.constants'

function fmtSecs(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return 'n/a'
  const total = Math.round(value)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function fmtNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return 'n/a'
  return value.toFixed(digits)
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(2)}%`
}

function horizonLabel(row: { timeframe: string; best_horizon: number; best_horizon_ms?: number; best_horizon_label?: string }): string {
  if (row.best_horizon_label) return row.best_horizon_label
  const ms = row.best_horizon_ms ?? barsToMs(row.timeframe, row.best_horizon)
  return `${row.best_horizon} bars (${formatDurationMs(ms)} @ ${row.timeframe})`
}

export function App() {
  const [runs, setRuns] = useState<RunStatus[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [summary, setSummary] = useState<ResultSummary | null>(null)
  const [summaryRunId, setSummaryRunId] = useState<string | null>(null)
  const [plots, setPlots] = useState<Record<string, PlotPayload>>({})
  const [plotsRunId, setPlotsRunId] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot[]>([])
  const [binanceCalls, setBinanceCalls] = useState<BinanceCallDiagnostic[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingCreate, setLoadingCreate] = useState(false)
  const [loadingPlots, setLoadingPlots] = useState(false)
  const [downloadingBundle, setDownloadingBundle] = useState(false)
  const [ecoMode, setEcoMode] = useState(true)
  const [preset, setPreset] = useState<PresetKey>('fast')
  const [runConfig, setRunConfig] = useState<RunConfig>(withDefaults(PRESET_CONFIGS.fast))
  const [horizonMinutes, setHorizonMinutes] = useState(120)
  const [sliceMetric, setSliceMetric] = useState<NonNullable<PlotOptions['metric']>>('composite_error')
  const [minNovelty, setMinNovelty] = useState(0.15)

  const savePreferenceTimer = useRef<number | null>(null)

  const selectedRun = useMemo(() => runs.find((r) => r.run_id === selectedRunId) ?? null, [runs, selectedRunId])
  const latestTelemetry = useMemo(() => telemetry[telemetry.length - 1] ?? null, [telemetry])
  const plotsLoaded = plotsRunId === selectedRunId && Object.keys(plots).length > 0
  const summaryInsights = useMemo(() => {
    if (!summary || summary.per_asset_recommendations.length === 0) return null
    const rows = summary.per_asset_recommendations
    const avgError = rows.reduce((acc, row) => acc + row.score.composite_error, 0) / rows.length
    const avgHit = rows.reduce((acc, row) => acc + row.score.directional_hit_rate, 0) / rows.length
    const avgPnl = rows.reduce((acc, row) => acc + row.score.pnl_total, 0) / rows.length
    const avgCal = rows.reduce((acc, row) => acc + (row.score.calibration_error ?? 0), 0) / rows.length
    const positivePnl = rows.filter((row) => row.score.pnl_total > 0).length
    const best = rows[0]
    const worst = rows[rows.length - 1]
    const qualityFlags: string[] = []
    if (avgHit < 0.52) qualityFlags.push('Directional edge is weak (<52%).')
    if (avgPnl <= 0) qualityFlags.push('Average post-cost pnl is non-positive.')
    if (avgError > 1.2) qualityFlags.push('Composite forecasting error is high.')
    return {
      avgError,
      avgHit,
      avgPnl,
      avgCal,
      positivePnlRatio: positivePnl / rows.length,
      best,
      worst,
      qualityFlags,
    }
  }, [summary])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_PREFS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        runConfig?: Partial<RunConfig>
        ecoMode?: boolean
        horizonMinutes?: number
        sliceMetric?: NonNullable<PlotOptions['metric']>
        minNovelty?: number
      }
      if (parsed.runConfig) {
        const merged = withDefaults(parsed.runConfig)
        setRunConfig(merged)
        const fast = JSON.stringify(withDefaults(PRESET_CONFIGS.fast))
        const balanced = JSON.stringify(withDefaults(PRESET_CONFIGS.balanced))
        const deep = JSON.stringify(withDefaults(PRESET_CONFIGS.deep))
        const current = JSON.stringify(merged)
        if (current === fast) setPreset('fast')
        else if (current === balanced) setPreset('balanced')
        else if (current === deep) setPreset('deep')
        else setPreset('custom')
      }
      if (typeof parsed.ecoMode === 'boolean') setEcoMode(parsed.ecoMode)
      if (typeof parsed.horizonMinutes === 'number') setHorizonMinutes(clampInt(parsed.horizonMinutes, 5, 10080))
      if (parsed.sliceMetric) setSliceMetric(parsed.sliceMetric)
      if (typeof parsed.minNovelty === 'number') setMinNovelty(clampFloat(parsed.minNovelty, 0, 1))
    } catch {
      // ignore malformed local preference payloads
    }
  }, [])

  useEffect(() => {
    if (savePreferenceTimer.current !== null) window.clearTimeout(savePreferenceTimer.current)
    savePreferenceTimer.current = window.setTimeout(() => {
      const prefs = {
        runConfig,
        ecoMode,
        horizonMinutes,
        sliceMetric,
        minNovelty,
      }
      window.localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs))
    }, 500)
    return () => {
      if (savePreferenceTimer.current !== null) window.clearTimeout(savePreferenceTimer.current)
    }
  }, [runConfig, ecoMode, horizonMinutes, sliceMetric, minNovelty])

  const refreshRunsOnce = async (signal?: AbortSignal): Promise<void> => {
    try {
      const data = await listRuns()
      if (signal?.aborted) return
      setRuns(data)
      if (!selectedRunId && data.length > 0) setSelectedRunId(data[0].run_id)
      setError(null)
    } catch (e) {
      if (!isAbortError(e)) setError((e as Error).message)
    }
  }

  useEffect(() => {
    let active = true
    let timer: number | null = null

    const loop = async () => {
      if (!active) return
      await refreshRunsOnce()
      if (!active) return
      const hidden = document.visibilityState !== 'visible'
      timer = window.setTimeout(loop, hidden ? 15_000 : ecoMode ? 8_000 : 4_000)
    }

    void loop()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [ecoMode, selectedRunId])

  useEffect(() => {
    if (!selectedRunId) {
      setTelemetry([])
      setBinanceCalls([])
      return
    }
    let active = true
    let timer: number | null = null

    const loop = async () => {
      if (!active) return
      try {
        const [feed, diagnostics] = await Promise.all([
          getTelemetry(selectedRunId, ecoMode ? 120 : 240),
          getBinanceDiagnostics(selectedRunId, ecoMode ? 24 : 48),
        ])
        if (!active) return
        setTelemetry(feed.snapshots)
        setBinanceCalls(diagnostics.calls)
      } catch {
        if (!active) return
        setTelemetry([])
        setBinanceCalls([])
      }
      const hidden = document.visibilityState !== 'visible'
      timer = window.setTimeout(loop, hidden ? 12_000 : ecoMode ? 5_000 : 2_500)
    }

    void loop()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [selectedRunId, ecoMode])

  useEffect(() => {
    if (!selectedRunId) return
    const run = runs.find((r) => r.run_id === selectedRunId)
    if (!run || run.status !== 'completed') {
      setSummary(null)
      setSummaryRunId(null)
      setPlots({})
      setPlotsRunId(null)
      return
    }
    if (summaryRunId === selectedRunId) return

    const load = async () => {
      try {
        const result = await getResults(selectedRunId)
        setSummary(result)
        setSummaryRunId(selectedRunId)
        setPlots({})
        setPlotsRunId(null)
      } catch (e) {
        setError((e as Error).message)
      }
    }
    void load()
  }, [runs, selectedRunId, summaryRunId])

  const loadPlots = useCallback(
    async (forceRefresh = false): Promise<void> => {
      if (!selectedRunId || !summary || (!forceRefresh && loadingPlots)) return
      if (!forceRefresh) setLoadingPlots(true)
      setError(null)
      try {
        const loaded: Record<string, PlotPayload> = {}
        await Promise.all(
          PLOTS.map(async (plotId) => {
            try {
              const options =
                plotId === 'indicator_horizon_heatmap' || plotId === 'horizon_slice_table'
                  ? ({ horizon_minutes: horizonMinutes, metric: sliceMetric, min_novelty: minNovelty } satisfies PlotOptions)
                  : undefined
              loaded[plotId] = await getPlot(selectedRunId, plotId, options)
            } catch {
              // optional
            }
          }),
        )
        setPlots(loaded)
        setPlotsRunId(selectedRunId)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        if (!forceRefresh) setLoadingPlots(false)
      }
    },
    [selectedRunId, summary, loadingPlots, horizonMinutes, sliceMetric, minNovelty],
  )

  useEffect(() => {
    if (!plotsLoaded || !selectedRunId || !summary) return
    const timer = window.setTimeout(() => {
      void loadPlots(true)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [horizonMinutes, sliceMetric, minNovelty, plotsLoaded, selectedRunId, summary, loadPlots])

  const onCreate = async () => {
    setLoadingCreate(true)
    setError(null)
    try {
      const created = await createRun(runConfig)
      setSelectedRunId(created.run_id)
      await refreshRunsOnce()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingCreate(false)
    }
  }

  const onDownloadBundle = async (): Promise<void> => {
    if (!selectedRunId) return
    setDownloadingBundle(true)
    try {
      await downloadRunBundle(selectedRunId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDownloadingBundle(false)
    }
  }

  const applyPreset = (nextPreset: Exclude<PresetKey, 'custom'>) => {
    setPreset(nextPreset)
    setRunConfig(withDefaults(PRESET_CONFIGS[nextPreset]))
  }

  const updateConfig = (patch: Partial<RunConfig>) => {
    setPreset('custom')
    setRunConfig((prev) => withDefaults({ ...prev, ...patch }))
  }

  const updateAdvanced = (patch: Partial<AdvancedRunConfig>) => {
    setPreset('custom')
    setRunConfig((prev) =>
      withDefaults({
        ...prev,
        advanced: {
          ...(prev.advanced ?? DEFAULT_ADVANCED),
          ...patch,
        },
      }),
    )
  }

  const updateHorizon = (key: keyof AdvancedRunConfig['horizon'], value: number) => {
    const current = runConfig.advanced ?? DEFAULT_ADVANCED
    updateAdvanced({
      horizon: {
        ...current.horizon,
        [key]: value,
      },
    })
  }

  const updateSearch = (key: keyof AdvancedRunConfig['search'], value: number) => {
    const current = runConfig.advanced ?? DEFAULT_ADVANCED
    updateAdvanced({
      search: {
        ...current.search,
        [key]: value,
      },
    })
  }

  const updateValidation = (key: keyof AdvancedRunConfig['validation'], value: number) => {
    const current = runConfig.advanced ?? DEFAULT_ADVANCED
    updateAdvanced({
      validation: {
        ...current.validation,
        [key]: value,
      },
    })
  }

  const updateObjective = (key: keyof AdvancedRunConfig['objective_weights'], value: number) => {
    const current = runConfig.advanced ?? DEFAULT_ADVANCED
    updateAdvanced({
      objective_weights: {
        ...current.objective_weights,
        [key]: value,
      },
    })
  }

  const toggleTimeframe = (timeframe: (typeof TIMEFRAME_OPTIONS)[number]) => {
    setPreset('custom')
    setRunConfig((prev) => {
      const current = new Set(prev.timeframes)
      if (current.has(timeframe)) current.delete(timeframe)
      else current.add(timeframe)
      const next = TIMEFRAME_OPTIONS.filter((tf) => current.has(tf))
      return withDefaults({ ...prev, timeframes: next.length > 0 ? next : [timeframe] })
    })
  }

  return (
    <div className="page-shell">
      <div className="aurora" />
      <header className="top-header">
        <div className="header-line">
          <div>
            <h1>Novel Indicator Lab V2</h1>
            <p>Leakage-safe walk-forward search, horizon-to-time translation, and horizon-slice heatmap explorer.</p>
          </div>
          <span className="status-pill online">Browser Compute</span>
        </div>

        <div className="run-config-grid">
          <label>
            Preset
            <select value={preset} onChange={(e) => applyPreset(e.target.value as Exclude<PresetKey, 'custom'>)}>
              <option value="fast">Fast (&lt;8m target)</option>
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
              onChange={(e) => updateConfig({ top_n_symbols: clampInt(Number(e.target.value), 1, 30) })}
            />
          </label>
          <label>
            Budget (min)
            <input
              type="number"
              min={5}
              max={240}
              value={runConfig.budget_minutes}
              onChange={(e) => updateConfig({ budget_minutes: clampInt(Number(e.target.value), 5, 240) })}
            />
          </label>
          <label>
            Performance Profile
            <select
              value={runConfig.advanced?.performance_profile ?? 'fast'}
              onChange={(e) =>
                updateAdvanced({
                  performance_profile: (e.target.value as AdvancedRunConfig['performance_profile']) ?? 'fast',
                })
              }
            >
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="deep">Deep</option>
            </select>
          </label>
        </div>
        <p className="inline-note">
          Fast default: 4 symbols, 5m+1h timeframes, 8-minute budget. Deep profiles expand candidate and horizon search.
        </p>

        <div className="timeframe-row">
          <span>Timeframes</span>
          <div className="chips">
            {TIMEFRAME_OPTIONS.map((tf) => (
              <button key={tf} className={`chip ${runConfig.timeframes.includes(tf) ? 'chip-on' : ''}`} onClick={() => toggleTimeframe(tf)}>
                {tf}
              </button>
            ))}
          </div>
          <div className="seed-row">
            <label>
              Seed Mode
              <select
                value={runConfig.seed_mode ?? 'auto'}
                onChange={(e) => updateConfig({ seed_mode: e.target.value === 'manual' ? 'manual' : 'auto' })}
              >
                <option value="auto">Auto (deterministic)</option>
                <option value="manual">Manual override</option>
              </select>
            </label>
            {runConfig.seed_mode === 'manual' && (
              <label>
                Manual Seed
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  value={runConfig.random_seed ?? 42}
                  onChange={(e) => updateConfig({ random_seed: clampInt(Number(e.target.value), 1, 1_000_000) })}
                />
              </label>
            )}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={ecoMode} onChange={(e) => setEcoMode(e.target.checked)} />
            <span>Eco polling mode</span>
          </label>
          <p className="inline-note">
            Auto seed keeps runs deterministic from config and symbols. Manual seed is optional for explicit reproducibility experiments.
          </p>
        </div>

        <details className="advanced-panel">
          <summary>Advanced Controls</summary>
          <div className="run-config-grid">
            <label>
              Horizon Min (bars)
              <input
                type="number"
                value={runConfig.advanced?.horizon.min_bar ?? DEFAULT_ADVANCED.horizon.min_bar}
                onChange={(e) => updateHorizon('min_bar', clampInt(Number(e.target.value), 1, 400))}
              />
            </label>
            <label>
              Horizon Max (bars)
              <input
                type="number"
                value={runConfig.advanced?.horizon.max_bar ?? DEFAULT_ADVANCED.horizon.max_bar}
                onChange={(e) => updateHorizon('max_bar', clampInt(Number(e.target.value), 2, 600))}
              />
            </label>
            <label>
              Coarse Step
              <input
                type="number"
                value={runConfig.advanced?.horizon.coarse_step ?? DEFAULT_ADVANCED.horizon.coarse_step}
                onChange={(e) => updateHorizon('coarse_step', clampInt(Number(e.target.value), 1, 80))}
              />
            </label>
            <label>
              Refine Radius
              <input
                type="number"
                value={runConfig.advanced?.horizon.refine_radius ?? DEFAULT_ADVANCED.horizon.refine_radius}
                onChange={(e) => updateHorizon('refine_radius', clampInt(Number(e.target.value), 1, 40))}
              />
            </label>
          </div>
          <p className="inline-note">Horizon search runs coarse screening, then local refinement around survivors.</p>
          <div className="run-config-grid">
            <label>
              Candidate Pool
              <input
                type="number"
                value={runConfig.advanced?.search.candidate_pool_size ?? DEFAULT_ADVANCED.search.candidate_pool_size}
                onChange={(e) => updateSearch('candidate_pool_size', clampInt(Number(e.target.value), 32, 500))}
              />
            </label>
            <label>
              Stage A Keep
              <input
                type="number"
                value={runConfig.advanced?.search.stage_a_keep ?? DEFAULT_ADVANCED.search.stage_a_keep}
                onChange={(e) => updateSearch('stage_a_keep', clampInt(Number(e.target.value), 8, 300))}
              />
            </label>
            <label>
              Stage B Keep
              <input
                type="number"
                value={runConfig.advanced?.search.stage_b_keep ?? DEFAULT_ADVANCED.search.stage_b_keep}
                onChange={(e) => updateSearch('stage_b_keep', clampInt(Number(e.target.value), 4, 160))}
              />
            </label>
            <label>
              Min Novelty
              <input
                type="number"
                step={0.01}
                value={runConfig.advanced?.search.min_novelty_score ?? DEFAULT_ADVANCED.search.min_novelty_score}
                onChange={(e) => updateSearch('min_novelty_score', clampFloat(Number(e.target.value), 0, 1))}
              />
            </label>
          </div>
          <div className="run-config-grid">
            <label>
              CV Folds
              <input
                type="number"
                value={runConfig.advanced?.validation.folds ?? DEFAULT_ADVANCED.validation.folds}
                onChange={(e) => updateValidation('folds', clampInt(Number(e.target.value), 2, 6))}
              />
            </label>
            <label>
              Purge Bars
              <input
                type="number"
                value={runConfig.advanced?.validation.purge_bars ?? DEFAULT_ADVANCED.validation.purge_bars}
                onChange={(e) => updateValidation('purge_bars', clampInt(Number(e.target.value), 0, 64))}
              />
            </label>
            <label>
              Embargo Bars
              <input
                type="number"
                value={runConfig.advanced?.validation.embargo_bars ?? DEFAULT_ADVANCED.validation.embargo_bars}
                onChange={(e) => updateValidation('embargo_bars', clampInt(Number(e.target.value), 0, 64))}
              />
            </label>
            <label>
              Baseline Margin
              <input
                type="number"
                step={0.001}
                value={runConfig.advanced?.validation.baseline_margin ?? DEFAULT_ADVANCED.validation.baseline_margin}
                onChange={(e) => updateValidation('baseline_margin', clampFloat(Number(e.target.value), 0, 0.2))}
              />
            </label>
          </div>
          <div className="run-config-grid">
            <label>
              Objective RMSE
              <input
                type="number"
                step={0.01}
                value={runConfig.advanced?.objective_weights.rmse ?? DEFAULT_ADVANCED.objective_weights.rmse}
                onChange={(e) => updateObjective('rmse', clampFloat(Number(e.target.value), 0.01, 1))}
              />
            </label>
            <label>
              Objective MAE
              <input
                type="number"
                step={0.01}
                value={runConfig.advanced?.objective_weights.mae ?? DEFAULT_ADVANCED.objective_weights.mae}
                onChange={(e) => updateObjective('mae', clampFloat(Number(e.target.value), 0.01, 1))}
              />
            </label>
            <label>
              Objective Calibration
              <input
                type="number"
                step={0.01}
                value={runConfig.advanced?.objective_weights.calibration ?? DEFAULT_ADVANCED.objective_weights.calibration}
                onChange={(e) => updateObjective('calibration', clampFloat(Number(e.target.value), 0.01, 1))}
              />
            </label>
            <label>
              Objective Directional
              <input
                type="number"
                step={0.01}
                value={runConfig.advanced?.objective_weights.directional ?? DEFAULT_ADVANCED.objective_weights.directional}
                onChange={(e) => updateObjective('directional', clampFloat(Number(e.target.value), 0.01, 1))}
              />
            </label>
          </div>
          <p className="inline-note">Purged folds + embargo reduce leakage risk. Objective weights define final ranking behavior.</p>
        </details>

        <div className="controls">
          <button onClick={onCreate} disabled={loadingCreate}>
            {loadingCreate ? 'Launching...' : 'Start Run'}
          </button>
          {selectedRunId && (
            <button className="secondary" onClick={() => cancelRun(selectedRunId)}>
              Cancel Run
            </button>
          )}
          {selectedRunId && (
            <button className="secondary" onClick={() => generateReport(selectedRunId)}>
              Download Report
            </button>
          )}
          {selectedRunId && (
            <button className="secondary" onClick={() => exportPine(selectedRunId)}>
              Export Pine
            </button>
          )}
          {selectedRunId && summary && (
            <button className="secondary" onClick={() => void onDownloadBundle()} disabled={downloadingBundle}>
              {downloadingBundle ? 'Preparing Bundle...' : 'Download Full Results (.zip)'}
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel runs-panel">
        <h2>Runs</h2>
        <div className="run-list">
          {runs.map((run) => (
            <button key={run.run_id} className={`run-item ${selectedRunId === run.run_id ? 'selected' : ''}`} onClick={() => setSelectedRunId(run.run_id)}>
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
          {runs.length === 0 && <p className="inline-note">No local runs yet.</p>}
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
                <label>Cores / Device Memory</label>
                <span>
                  {latestTelemetry.logical_cores ?? 'n/a'} / {latestTelemetry.device_memory_gb ?? 'n/a'} GB
                </span>
              </div>
              <div>
                <label>JS Heap</label>
                <span>
                  {latestTelemetry.js_heap_used_mb == null ? 'n/a' : `${latestTelemetry.js_heap_used_mb.toFixed(1)} MB`} /{' '}
                  {latestTelemetry.js_heap_limit_mb == null ? 'n/a' : `${latestTelemetry.js_heap_limit_mb.toFixed(1)} MB`}
                </span>
              </div>
            </div>
            <div className="telemetry-footnote">
              <strong>Achieved:</strong> {latestTelemetry.achieved}
              <br />
              <strong>Remaining:</strong> {latestTelemetry.remaining}
            </div>
            <div className="telemetry-footnote" style={{ marginTop: 12 }}>
              <strong>Binance Direct Calls (latest {binanceCalls.length}):</strong>
              <div>
                {binanceCalls.slice(-8).map((call, idx) => (
                  <div key={`${call.ts}-${idx}`}>
                    {new Date(call.ts).toLocaleTimeString()} | {call.endpoint} | HTTP {call.status} | weight1m:{' '}
                    {call.headers['x-mbx-used-weight-1m'] ?? 'n/a'}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p>Telemetry appears once the selected run starts.</p>
        )}
      </section>

      <section className="panel results-panel">
        <div className="results-header">
          <h2>Results Explorer</h2>
          {summary && (
            <div className="slice-controls">
              <label>
                Future timepoint (minutes)
                <input
                  type="number"
                  min={5}
                  max={10080}
                  value={horizonMinutes}
                  onChange={(e) => setHorizonMinutes(clampInt(Number(e.target.value), 5, 10080))}
                />
              </label>
              <label>
                Metric
                <select value={sliceMetric} onChange={(e) => setSliceMetric(e.target.value as NonNullable<PlotOptions['metric']>)}>
                  <option value="composite_error">Composite Error</option>
                  <option value="calibration_error">Calibration Error</option>
                  <option value="directional_hit_rate">Directional Hit Rate</option>
                  <option value="pnl_total">PnL</option>
                </select>
              </label>
              <label>
                Min novelty
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minNovelty}
                  onChange={(e) => setMinNovelty(clampFloat(Number(e.target.value), 0, 1))}
                />
              </label>
              <button className="secondary" onClick={() => void loadPlots()} disabled={loadingPlots}>
                {loadingPlots ? 'Loading Plots...' : 'Refresh Plots'}
              </button>
            </div>
          )}
        </div>
        {summary ? (
          <>
            <div className="telemetry-footnote" style={{ marginBottom: 10 }}>
              <strong>Forecast interpretation</strong>
              <div>Target variable: future close at selected horizon, conditioned on current bar features.</div>
              <div>
                Timepoint selection ({horizonMinutes}m ahead) auto-converts to bars by timeframe, e.g. 2h = 24 bars on 5m and 2 bars on 1h.
              </div>
            </div>
            {summaryInsights && (
              <div className="kpis" style={{ marginBottom: 10 }}>
                <div>
                  <label>Avg Composite Error</label>
                  <span>{fmtNumber(summaryInsights.avgError, 5)}</span>
                </div>
                <div>
                  <label>Avg Calibration Error</label>
                  <span>{fmtNumber(summaryInsights.avgCal, 5)}</span>
                </div>
                <div>
                  <label>Avg Hit Rate</label>
                  <span>{fmtPct(summaryInsights.avgHit)}</span>
                </div>
                <div>
                  <label>Avg PnL</label>
                  <span>{fmtNumber(summaryInsights.avgPnl, 4)}</span>
                </div>
                <div>
                  <label>Positive PnL Assets</label>
                  <span>{fmtPct(summaryInsights.positivePnlRatio)}</span>
                </div>
              </div>
            )}
            {summary.validation_report && (
              <div className="kpis" style={{ marginBottom: 10 }}>
                <div>
                  <label>Leakage Checks</label>
                  <span>{summary.validation_report.leakage_checks_passed ? 'Pass' : 'Fail'}</span>
                </div>
                <div>
                  <label>Leakage Sentinel</label>
                  <span>{summary.validation_report.leakage_sentinel_triggered ? 'Triggered' : 'Not Triggered'}</span>
                </div>
                <div>
                  <label>Holdout Pass Ratio</label>
                  <span>{fmtPct(summary.validation_report.holdout_pass_ratio)}</span>
                </div>
                <div>
                  <label>Baseline Rejection Rate</label>
                  <span>{fmtPct(summary.validation_report.baseline_rejection_rate)}</span>
                </div>
              </div>
            )}
            <div className="universal-card">
              <h3>Universal Recommendation</h3>
              <p>
                Horizon: <b>{horizonLabel(summary.universal_recommendation)}</b> | Composite Error:{' '}
                <b>{summary.universal_recommendation.score.composite_error.toFixed(6)}</b> | Hit Rate:{' '}
                <b>{summary.universal_recommendation.score.directional_hit_rate.toFixed(3)}</b> | PnL:{' '}
                <b>{summary.universal_recommendation.score.pnl_total.toFixed(4)}</b>
              </p>
              <ul>
                {summary.universal_recommendation.indicator_combo.map((i) => (
                  <li key={i.indicator_id}>
                    <code>{i.indicator_id}</code> {i.expression}
                  </li>
                ))}
              </ul>
              {summaryInsights && summaryInsights.qualityFlags.length > 0 && (
                <div className="telemetry-footnote" style={{ marginTop: 10 }}>
                  <strong>Quality Warnings</strong>
                  <ul>
                    {summaryInsights.qualityFlags.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="table-wrap">
              {summaryInsights && (
                <p className="inline-note" style={{ marginBottom: 8 }}>
                  Best: <b>{summaryInsights.best.symbol}:{summaryInsights.best.timeframe}</b> ({fmtNumber(summaryInsights.best.score.composite_error, 5)}) | Worst:{' '}
                  <b>{summaryInsights.worst.symbol}:{summaryInsights.worst.timeframe}</b> ({fmtNumber(summaryInsights.worst.score.composite_error, 5)})
                </p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>TF</th>
                    <th>Horizon (Bars/Time)</th>
                    <th>Error</th>
                    <th>Cal</th>
                    <th>HitRate</th>
                    <th>PnL</th>
                    <th>MaxDD</th>
                    <th>Turnover</th>
                    <th>Stability</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.per_asset_recommendations.slice(0, 40).map((rec) => (
                    <tr key={`${rec.symbol}-${rec.timeframe}`}>
                      <td>{rec.symbol}</td>
                      <td>{rec.timeframe}</td>
                      <td>{horizonLabel(rec)}</td>
                      <td>{rec.score.composite_error.toFixed(6)}</td>
                      <td>{(rec.score.calibration_error ?? 0).toFixed(5)}</td>
                      <td>{rec.score.directional_hit_rate.toFixed(3)}</td>
                      <td>{rec.score.pnl_total.toFixed(4)}</td>
                      <td>{rec.score.max_drawdown.toFixed(4)}</td>
                      <td>{rec.score.turnover.toFixed(4)}</td>
                      <td>{rec.score.stability_score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Results will appear when a run completes.</p>
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
          <p>Plot payloads are not loaded yet.</p>
        )}
      </section>
    </div>
  )
}
