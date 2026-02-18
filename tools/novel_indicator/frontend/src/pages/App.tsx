import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelRun,
  confirmEmailToken,
  createRun,
  deleteStoredRun,
  exportPine,
  forgotPassword,
  getBinanceDiagnostics,
  generateReport,
  getPlot,
  getPreferences,
  getResults,
  getRun,
  getSession,
  getTelemetry,
  listRuns,
  listStoredRuns,
  loginUser,
  logoutUser,
  registerUser,
  requestEmailVerification,
  resetPassword,
  saveRunToProfile,
  setPreferences,
  startGoogleLogin,
} from '../api/client'
import type {
  BinanceCallDiagnostic,
  PlotPayload,
  RunConfig,
  RunStatus,
  SessionInfo,
  StoredRunSummary,
  TelemetrySnapshot,
  UserPreferences,
} from '../api/types'
import { PlotPanel } from '../components/PlotPanel'

const PLOTS = ['horizon_heatmap', 'forecast_overlay', 'novelty_pareto', 'timeframe_error']
const TIMEFRAME_OPTIONS = ['5m', '1h', '4h'] as const

const PRESET_CONFIGS = {
  quick: { top_n_symbols: 3, timeframes: ['5m'], budget_minutes: 15, random_seed: 42 },
  balanced: { top_n_symbols: 6, timeframes: ['5m', '1h'], budget_minutes: 35, random_seed: 42 },
  deep: { top_n_symbols: 10, timeframes: ['5m', '1h', '4h'], budget_minutes: 90, random_seed: 42 },
} as const satisfies Record<string, RunConfig>

type PresetKey = keyof typeof PRESET_CONFIGS | 'custom'

type SyncState = 'idle' | 'pending' | 'synced' | 'error'

function fmtSecs(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return 'n/a'
  const total = Math.round(value)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function AuthGate({ onReady }: { onReady: (session: SessionInfo) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identity, setIdentity] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [verifyTokenInput, setVerifyTokenInput] = useState('')
  const [resetTokenInput, setResetTokenInput] = useState('')
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verify_token')
    const resetToken = params.get('reset_token')
    if (verifyToken) setVerifyTokenInput(verifyToken)
    if (resetToken) setResetTokenInput(resetToken)
  }, [])

  const onSubmit = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const session =
        mode === 'register'
          ? await registerUser({ username, email, password, display_name: username })
          : await loginUser(identity, password)
      onReady(session)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="panel">
        <h1>Novel Indicator Lab</h1>
        <p>Login required. Optimization and Binance fetches run locally in your browser.</p>

        <div className="run-config-grid">
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as 'login' | 'register')}>
              <option value="login">Login</option>
              <option value="register">Register</option>
            </select>
          </label>
          {mode === 'register' ? (
            <>
              <label>
                Username
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              </label>
              <label>
                Email
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
              </label>
            </>
          ) : (
            <label>
              Username or Email
              <input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="username or email" />
            </label>
          )}
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
          </label>
        </div>

        <div className="controls">
          <button onClick={onSubmit} disabled={loading}>
            {loading ? 'Working...' : mode === 'register' ? 'Create Account' : 'Login'}
          </button>
          <button className="secondary" onClick={() => startGoogleLogin()}>
            Continue with Google
          </button>
          <button
            className="secondary"
            onClick={async () => {
              setError(null)
              setMessage(null)
              try {
                await forgotPassword(mode === 'register' ? email : identity)
                setMessage('If the email exists, reset instructions were sent.')
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Forgot Password
          </button>
        </div>

        <div className="run-config-grid" style={{ marginTop: 12 }}>
          <label>
            Verify Token
            <input value={verifyTokenInput} onChange={(e) => setVerifyTokenInput(e.target.value)} placeholder="email verification token" />
          </label>
          <label>
            Reset Token
            <input value={resetTokenInput} onChange={(e) => setResetTokenInput(e.target.value)} placeholder="password reset token" />
          </label>
          <label>
            New Password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="new password" />
          </label>
        </div>
        <div className="controls">
          <button
            className="secondary"
            onClick={async () => {
              try {
                await confirmEmailToken(verifyTokenInput)
                setMessage('Email verified successfully.')
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Confirm Email Token
          </button>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await resetPassword(resetTokenInput, newPassword)
                setMessage('Password reset completed.')
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Confirm Password Reset
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {message && <div className="telemetry-footnote">{message}</div>}
      </div>
    </div>
  )
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [runs, setRuns] = useState<RunStatus[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [summary, setSummary] = useState<any | null>(null)
  const [summaryRunId, setSummaryRunId] = useState<string | null>(null)
  const [plots, setPlots] = useState<Record<string, PlotPayload>>({})
  const [plotsRunId, setPlotsRunId] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot[]>([])
  const [binanceCalls, setBinanceCalls] = useState<BinanceCallDiagnostic[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingCreate, setLoadingCreate] = useState(false)
  const [loadingPlots, setLoadingPlots] = useState(false)
  const [ecoMode, setEcoMode] = useState(true)
  const [preset, setPreset] = useState<PresetKey>('balanced')
  const [runConfig, setRunConfig] = useState<RunConfig>(PRESET_CONFIGS.balanced)
  const [syncState, setSyncState] = useState<Record<string, SyncState>>({})
  const [storedRuns, setStoredRuns] = useState<StoredRunSummary[]>([])

  const savePreferenceTimer = useRef<number | null>(null)

  const selectedRun = useMemo(() => runs.find((r) => r.run_id === selectedRunId) ?? null, [runs, selectedRunId])
  const latestTelemetry = useMemo(() => telemetry[telemetry.length - 1] ?? null, [telemetry])
  const plotsLoaded = plotsRunId === selectedRunId && Object.keys(plots).length > 0

  useEffect(() => {
    getSession()
      .then((sessionInfo) => {
        setSession(sessionInfo)
      })
      .finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (!session) return
    getPreferences()
      .then((prefs) => {
        const merged: RunConfig = {
          top_n_symbols: typeof prefs.top_n_symbols === 'number' ? prefs.top_n_symbols : PRESET_CONFIGS.balanced.top_n_symbols,
          timeframes: Array.isArray(prefs.timeframes) ? (prefs.timeframes as string[]) : PRESET_CONFIGS.balanced.timeframes,
          budget_minutes: typeof prefs.budget_minutes === 'number' ? prefs.budget_minutes : PRESET_CONFIGS.balanced.budget_minutes,
          random_seed: typeof prefs.random_seed === 'number' ? prefs.random_seed : PRESET_CONFIGS.balanced.random_seed,
        }
        setRunConfig(merged)
        if (typeof prefs.ecoMode === 'boolean') setEcoMode(prefs.ecoMode)
      })
      .catch(() => {})

    listStoredRuns()
      .then(setStoredRuns)
      .catch(() => {})
  }, [session])

  useEffect(() => {
    if (!session) return
    if (savePreferenceTimer.current !== null) window.clearTimeout(savePreferenceTimer.current)
    savePreferenceTimer.current = window.setTimeout(() => {
      const prefs: UserPreferences = {
        top_n_symbols: runConfig.top_n_symbols,
        timeframes: runConfig.timeframes,
        budget_minutes: runConfig.budget_minutes,
        random_seed: runConfig.random_seed,
        ecoMode,
      }
      void setPreferences(prefs).catch(() => {})
    }, 500)
    return () => {
      if (savePreferenceTimer.current !== null) window.clearTimeout(savePreferenceTimer.current)
    }
  }, [session, runConfig, ecoMode])

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
    if (!session) return
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
  }, [session, ecoMode, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !session) {
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
  }, [selectedRunId, session, ecoMode])

  useEffect(() => {
    if (!selectedRunId || !session) return
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

        setSyncState((prev) => ({ ...prev, [selectedRunId]: 'pending' }))
        try {
          await saveRunToProfile(selectedRunId)
          setSyncState((prev) => ({ ...prev, [selectedRunId]: 'synced' }))
          const stored = await listStoredRuns()
          setStoredRuns(stored)
        } catch {
          setSyncState((prev) => ({ ...prev, [selectedRunId]: 'error' }))
        }
      } catch (e) {
        setError((e as Error).message)
      }
    }
    void load()
  }, [runs, selectedRunId, summaryRunId, session])

  const loadPlots = async (): Promise<void> => {
    if (!selectedRunId || !summary || loadingPlots) return
    setLoadingPlots(true)
    setError(null)
    try {
      const loaded: Record<string, PlotPayload> = {}
      await Promise.all(
        PLOTS.map(async (plotId) => {
          try {
            loaded[plotId] = await getPlot(selectedRunId, plotId)
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
      setLoadingPlots(false)
    }
  }

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

  const onLogout = async () => {
    try {
      await logoutUser()
    } catch {
      // no-op
    }
    setSession(null)
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
      if (current.has(timeframe)) current.delete(timeframe)
      else current.add(timeframe)
      const next = TIMEFRAME_OPTIONS.filter((tf) => current.has(tf))
      return { ...prev, timeframes: next.length > 0 ? next : [timeframe] }
    })
  }

  if (authLoading) {
    return (
      <div className="page-shell">
        <div className="panel">Checking session...</div>
      </div>
    )
  }

  if (!session) {
    return <AuthGate onReady={(s) => setSession(s)} />
  }

  return (
    <div className="page-shell">
      <div className="aurora" />
      <header className="top-header">
        <div className="header-line">
          <div>
            <h1>Novel Indicator Lab</h1>
            <p>Authenticated browser-local optimization. Binance fetches run from your browser IP.</p>
          </div>
          <span className="status-pill online">{session.user.username}</span>
        </div>

        <div className="controls" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={onLogout}>
            Logout
          </button>
          <button className="secondary" onClick={() => requestEmailVerification()}>
            Send Verify Email
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
            <button
              className="secondary"
              onClick={async () => {
                setSyncState((prev) => ({ ...prev, [selectedRunId]: 'pending' }))
                try {
                  await saveRunToProfile(selectedRunId)
                  setSyncState((prev) => ({ ...prev, [selectedRunId]: 'synced' }))
                  setStoredRuns(await listStoredRuns())
                } catch {
                  setSyncState((prev) => ({ ...prev, [selectedRunId]: 'error' }))
                }
              }}
            >
              Save to Profile
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
              <small>Sync: {syncState[run.run_id] ?? 'idle'}</small>
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
                {summary.universal_recommendation.indicator_combo.map((i: any) => (
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
                  {summary.per_asset_recommendations.slice(0, 30).map((rec: any) => (
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

      <section className="panel runs-panel">
        <h2>Server-Saved Runs</h2>
        <div className="run-list">
          {storedRuns.map((stored) => (
            <div key={stored.run_id} className="run-item">
              <div>
                <strong>{stored.run_id}</strong>
                <span>{stored.sync_state}</span>
              </div>
              <div>
                <small>{new Date(stored.updated_at).toLocaleString()}</small>
                <small>{stored.source_version}</small>
              </div>
              <button
                className="secondary"
                onClick={async () => {
                  await deleteStoredRun(stored.run_id)
                  setStoredRuns(await listStoredRuns())
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {storedRuns.length === 0 && <p className="inline-note">No server-synced runs yet.</p>}
        </div>
      </section>
    </div>
  )
}
