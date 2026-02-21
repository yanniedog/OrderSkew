/**
 * Report and export helpers for the Novel Indicator browser engine worker.
 */

import type {
  BinanceCallDiagnostic,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunStatus,
  TelemetrySnapshot,
} from '../api/types'
import { barsToMs, formatDurationMs } from '../utils/timeframe'

export type RunExportFile = {
  path: string
  content: string
  mime: string
}

export type RunExportBundle = {
  run_id: string
  generated_at: string
  files: RunExportFile[]
}

/** Bundle shape needed for report/export (subset of RunBundle). */
export interface ExportBundle {
  run: RunStatus
  config: RunConfig
  summary: ResultSummary | null
  plots: Record<string, PlotPayload>
  pineScripts: Record<string, string>
  telemetry: TelemetrySnapshot[]
  binanceCalls: BinanceCallDiagnostic[]
}

function nowIso(): string {
  return new Date().toISOString()
}

export function csvCell(value: unknown): string {
  if (value == null) return ''
  const input = String(value)
  if (!/[,"\n]/.test(input)) return input
  return `"${input.replace(/"/g, '""')}"`
}

export function toJsonl(rows: unknown[]): string {
  if (!rows.length) return ''
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
}

export function buildRecommendationsCsv(summary: ResultSummary): string {
  const header = [
    'symbol',
    'timeframe',
    'best_horizon',
    'best_horizon_label',
    'normalized_rmse',
    'normalized_mae',
    'calibration_error',
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
      rec.best_horizon_label ?? `${rec.best_horizon} bars (${formatDurationMs(rec.best_horizon_ms ?? barsToMs(rec.timeframe, rec.best_horizon))} @ ${rec.timeframe})`,
      rec.score.normalized_rmse,
      rec.score.normalized_mae,
      rec.score.calibration_error ?? 0,
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

export function buildIndicatorCubeCsv(summary: ResultSummary): string {
  const rows = summary.indicator_cube ?? []
  if (!rows.length) return ''
  const header = [
    'symbol',
    'timeframe',
    'indicator_id',
    'family',
    'formula',
    'novelty_score',
    'complexity',
    'horizon_bar',
    'horizon_time_ms',
    'normalized_rmse',
    'normalized_mae',
    'calibration_error',
    'composite_error',
    'directional_hit_rate',
    'pnl_total',
    'max_drawdown',
    'turnover',
    'stability_score',
  ]
  const body = rows.map((row) => [
    row.symbol,
    row.timeframe,
    row.indicator_id,
    row.family,
    row.expression,
    row.novelty_score,
    row.complexity,
    row.horizon_bar,
    row.horizon_time_ms,
    row.normalized_rmse,
    row.normalized_mae,
    row.calibration_error,
    row.composite_error,
    row.directional_hit_rate,
    row.pnl_total,
    row.max_drawdown,
    row.turnover,
    row.stability_score,
  ])
  return [header, ...body].map((row) => row.map((value) => csvCell(value)).join(',')).join('\n')
}

export function buildReportHtml(bundle: ExportBundle): string {
  if (!bundle.summary) return '<html><body><h1>No report data.</h1></body></html>'
  const rows = bundle.summary.per_asset_recommendations
    .map(
      (r) =>
        `<tr><td>${r.symbol}</td><td>${r.timeframe}</td><td>${r.best_horizon_label ?? `${r.best_horizon} bars (${formatDurationMs(r.best_horizon_ms ?? barsToMs(r.timeframe, r.best_horizon))} @ ${r.timeframe})`}</td><td>${r.score.composite_error.toFixed(6)}</td><td>${(r.score.calibration_error ?? 0).toFixed(6)}</td><td>${r.score.directional_hit_rate.toFixed(3)}</td><td>${r.score.pnl_total.toFixed(4)}</td><td>${r.score.max_drawdown.toFixed(4)}</td><td>${r.score.turnover.toFixed(4)}</td><td>${r.score.stability_score.toFixed(3)}</td></tr>`,
    )
    .join('')
  const per = bundle.summary.per_asset_recommendations
  const avgError = per.length ? per.reduce((acc, row) => acc + row.score.composite_error, 0) / per.length : 0
  const avgHit = per.length ? per.reduce((acc, row) => acc + row.score.directional_hit_rate, 0) / per.length : 0
  const avgPnl = per.length ? per.reduce((acc, row) => acc + row.score.pnl_total, 0) / per.length : 0
  const avgCal = per.length ? per.reduce((acc, row) => acc + (row.score.calibration_error ?? 0), 0) / per.length : 0
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
        <div class="card"><label>Avg Calibration Error</label><b>${avgCal.toFixed(5)}</b></div>
        <div class="card"><label>Avg Hit Rate</label><b>${(avgHit * 100).toFixed(2)}%</b></div>
        <div class="card"><label>Avg PnL</label><b>${avgPnl.toFixed(4)}</b></div>
        <div class="card"><label>Positive-PnL Assets</label><b>${(positive * 100).toFixed(1)}%</b></div>
      </div>
      <h2>Universal Recommendation</h2>
      <p>Horizon: <b>${bundle.summary.universal_recommendation.best_horizon_label ?? `${bundle.summary.universal_recommendation.best_horizon} bars (${formatDurationMs(bundle.summary.universal_recommendation.best_horizon_ms ?? barsToMs(bundle.summary.universal_recommendation.timeframe.split('|')[0] ?? '1h', bundle.summary.universal_recommendation.best_horizon))})`}</b> | Composite Error: <b>${bundle.summary.universal_recommendation.score.composite_error.toFixed(6)}</b></p>
      <p>Forecast semantics: horizon bars are translated into wall-clock time by source timeframe.</p>
      <p>Hit Rate: <b>${bundle.summary.universal_recommendation.score.directional_hit_rate.toFixed(3)}</b> | PnL: <b>${bundle.summary.universal_recommendation.score.pnl_total.toFixed(4)}</b></p>
      <p>${bundle.summary.universal_recommendation.indicator_combo.map((entry) => `<span class="pill">${entry.indicator_id}</span>`).join('')}</p>
      <table>
        <thead><tr><th>Symbol</th><th>TF</th><th>Horizon (bars/time)</th><th>Error</th><th>Calibration</th><th>Hit</th><th>PnL</th><th>MaxDD</th><th>Turnover</th><th>Stability</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${
        bundle.summary.validation_report
          ? `<h2>Validation and Bias Checks</h2>
      <p>Leakage checks passed: <b>${bundle.summary.validation_report.leakage_checks_passed ? 'yes' : 'no'}</b> | Leakage sentinel triggered: <b>${bundle.summary.validation_report.leakage_sentinel_triggered ? 'yes' : 'no'}</b></p>
      <p>Holdout rows: <b>${bundle.summary.validation_report.holdout_rows}</b> | Holdout pass ratio: <b>${(bundle.summary.validation_report.holdout_pass_ratio * 100).toFixed(2)}%</b> | Baseline rejection rate: <b>${(bundle.summary.validation_report.baseline_rejection_rate * 100).toFixed(2)}%</b></p>
      ${
        bundle.summary.validation_report.warnings.length
          ? `<div class="warn"><b>Validation warnings</b><ul>${bundle.summary.validation_report.warnings
              .slice(0, 12)
              .map((warning) => `<li>${warning}</li>`)
              .join('')}</ul></div>`
          : ''
      }`
          : ''
      }
      ${warnings.length ? `<div class="warn"><b>Quality warnings</b><ul>${warnings.map((warning) => `<li>${warning}</li>`).join('')}</ul></div>` : ''}
    </body>
  </html>`
}

export function buildRunExportBundle(bundle: ExportBundle): RunExportBundle {
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

  if ((bundle.summary.indicator_cube ?? []).length > 0) {
    files.push({
      path: 'results/indicator_cube.csv',
      content: buildIndicatorCubeCsv(bundle.summary),
      mime: 'text/csv;charset=utf-8',
    })
    files.push({
      path: 'results/indicator_cube.jsonl',
      content: toJsonl(bundle.summary.indicator_cube ?? []),
      mime: 'application/x-ndjson;charset=utf-8',
    })
  }

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
