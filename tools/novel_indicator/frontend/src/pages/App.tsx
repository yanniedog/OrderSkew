import { useEffect, useMemo, useState } from 'react'
import type { PlotPayload, ResultSummary, RunStatus } from '../api/types'
import { PlotPanel } from '../components/PlotPanel'

const PLOTS = ['horizon_heatmap', 'forecast_overlay', 'novelty_pareto', 'timeframe_error']

async function loadStandaloneDataset(): Promise<{ summary: ResultSummary; plots: Record<string, PlotPayload>; run: RunStatus }> {
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
    config_hash: 'standalone-demo',
    logs: [{ timestamp: now, stage: 'finished', message: 'Standalone in-browser dataset loaded successfully.' }],
  }

  return { summary, plots: loadedPlots, run }
}

export function App() {
  const [run, setRun] = useState<RunStatus | null>(null)
  const [summary, setSummary] = useState<ResultSummary | null>(null)
  const [plots, setPlots] = useState<Record<string, PlotPayload>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const init = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await loadStandaloneDataset()
        if (!active) {
          return
        }
        setRun(data.run)
        setSummary(data.summary)
        setPlots(data.plots)
      } catch (e) {
        if (!active) {
          return
        }
        setError(`Unable to load bundled standalone data: ${(e as Error).message}`)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void init()
    return () => {
      active = false
    }
  }, [])

  const plotCards = useMemo(() => Object.values(plots), [plots])

  return (
    <div className="page-shell">
      <div className="aurora" />
      <header className="top-header">
        <div className="header-line">
          <div>
            <h1>Novel Indicator Lab</h1>
            <p>Fully standalone in-browser experience. No backend, no local API, and no installation required.</p>
          </div>
          <span className="status-pill online">STANDALONE</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="panel runs-panel">
        <h2>Session</h2>
        {loading && <p>Loading bundled dataset...</p>}
        {!loading && run && (
          <div className="kpis">
            <div>
              <label>Run ID</label>
              <span>{run.run_id}</span>
            </div>
            <div>
              <label>Status</label>
              <span>{run.status.toUpperCase()}</span>
            </div>
            <div>
              <label>Mode</label>
              <span>Standalone Demo</span>
            </div>
          </div>
        )}
      </section>

      <section className="panel results-panel">
        <div className="results-header">
          <h2>Results Explorer</h2>
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
          !loading && <p>Standalone result summary unavailable.</p>
        )}
      </section>

      <section className="panel plots-panel">
        <h2>Visual Diagnostics</h2>
        {plotCards.length > 0 ? (
          <div className="plot-grid">
            {plotCards.map((plot) => (
              <PlotPanel key={plot.plot_id} plot={plot} />
            ))}
          </div>
        ) : (
          !loading && <p>No bundled plots were found in this package.</p>
        )}
      </section>
    </div>
  )
}
