import { Suspense, lazy } from 'react'
import type { PlotPayload } from '../api/types'

const MAX_LINE_POINTS = 1800
const MAX_SCATTER_POINTS = 2400
const MAX_HEATMAP_X = 120
const MAX_HEATMAP_Y = 80

const Plot = lazy(async () => {
  const mod = await import('react-plotly.js')
  return { default: mod.default }
})

type HeatmapPayload = {
  type: 'heatmap'
  x: number[]
  y: string[]
  z: number[][]
}

type LinePayload = {
  type: 'line'
  x: number[]
  series: Array<{ name: string; values: number[] }>
}

type ScatterPayload = {
  type: 'scatter'
  points: Array<{ label: string; complexity: number; error: number; hit_rate?: number; pnl?: number }>
}

type BarPayload = {
  type: 'bar'
  categories: string[]
  values: number[]
}

type TablePayload = {
  type: 'table'
  rows: Array<Record<string, unknown>>
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function sampleIndices(length: number, maxPoints: number): number[] {
  if (length <= maxPoints) {
    return Array.from({ length }, (_, idx) => idx)
  }
  const step = Math.ceil(length / maxPoints)
  const sampled: number[] = []
  for (let idx = 0; idx < length; idx += step) {
    sampled.push(idx)
  }
  if (sampled[sampled.length - 1] !== length - 1) {
    sampled.push(length - 1)
  }
  return sampled
}

function downsampleHeatmap(payload: HeatmapPayload): HeatmapPayload {
  const yIndices = sampleIndices(payload.y.length, MAX_HEATMAP_Y)
  const xIndices = sampleIndices(payload.x.length, MAX_HEATMAP_X)
  return {
    type: 'heatmap',
    x: xIndices.map((idx) => payload.x[idx]),
    y: yIndices.map((idx) => payload.y[idx]),
    z: yIndices.map((yIdx) => xIndices.map((xIdx) => payload.z[yIdx]?.[xIdx] ?? 0)),
  }
}

function downsampleLine(payload: LinePayload): LinePayload {
  const indices = sampleIndices(payload.x.length, MAX_LINE_POINTS)
  return {
    type: 'line',
    x: indices.map((idx) => payload.x[idx]),
    series: payload.series.map((series) => ({
      name: series.name,
      values: indices.map((idx) => series.values[idx]),
    })),
  }
}

function downsampleScatter(payload: ScatterPayload): ScatterPayload {
  const indices = sampleIndices(payload.points.length, MAX_SCATTER_POINTS)
  return {
    type: 'scatter',
    points: indices.map((idx) => payload.points[idx]),
  }
}

function Chart({ data, layout }: { data: Array<Record<string, unknown>>; layout?: Record<string, unknown> }) {
  return (
    <Suspense fallback={<div className="plot-loading">Loading chart...</div>}>
      <Plot
        data={data as never}
        layout={{
          margin: { t: 20, r: 12, b: 40, l: 46 },
          paper_bgcolor: '#fff',
          plot_bgcolor: '#fff',
          hovermode: 'closest',
          ...(layout ?? {}),
        }}
        style={{ width: '100%', height: '320px' }}
        useResizeHandler
      />
    </Suspense>
  )
}

function formatCell(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'n/a'
    if (Math.abs(value) >= 1000) return value.toFixed(0)
    if (Math.abs(value) >= 10) return value.toFixed(2)
    return value.toFixed(4)
  }
  if (value == null) return ''
  return String(value)
}

export function PlotPanel({ plot }: { plot: PlotPayload }) {
  const payload = asObject(plot.payload)
  const kind = payload?.type

  if (kind === 'heatmap') {
    const p = downsampleHeatmap(payload as unknown as HeatmapPayload)
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart
          data={[{ type: 'heatmap', x: p.x, y: p.y, z: p.z, colorscale: 'YlGnBu', reversescale: true }]}
          layout={{ xaxis: { title: 'Horizon (bars)' }, yaxis: { title: 'Asset / Timeframe' } }}
        />
      </div>
    )
  }

  if (kind === 'line') {
    const p = downsampleLine(payload as unknown as LinePayload)
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart
          data={p.series.map((s) => ({ type: 'scatter', mode: 'lines', name: s.name, x: p.x, y: s.values }))}
          layout={{ xaxis: { title: 'Index' }, yaxis: { title: 'Value' } }}
        />
      </div>
    )
  }

  if (kind === 'scatter') {
    const p = downsampleScatter(payload as unknown as ScatterPayload)
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart
          data={[
            {
              type: 'scatter',
              mode: 'markers',
              x: p.points.map((pt) => pt.complexity),
              y: p.points.map((pt) => pt.error),
              text: p.points.map(
                (pt) =>
                  `${pt.label}<br>Complexity: ${pt.complexity}<br>Error: ${pt.error.toFixed(5)}<br>Hit: ${(pt.hit_rate ?? 0).toFixed(3)}<br>PnL: ${(pt.pnl ?? 0).toFixed(4)}`,
              ),
              hovertemplate: '%{text}<extra></extra>',
              marker: {
                size: p.points.map((pt) => 7 + Math.min(18, Math.abs(pt.pnl ?? 0) * 28)),
                color: p.points.map((pt) => pt.hit_rate ?? 0.5),
                colorscale: 'RdYlGn',
                cmin: 0.35,
                cmax: 0.65,
                line: { width: 0.5, color: 'rgba(0,0,0,0.25)' },
                opacity: 0.82,
              },
            },
          ]}
          layout={{ xaxis: { title: 'Complexity' }, yaxis: { title: 'Composite Error' } }}
        />
      </div>
    )
  }

  if (kind === 'bar') {
    const p = payload as unknown as BarPayload
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart
          data={[{ type: 'bar', x: p.categories, y: p.values, marker: { color: '#0b6bcb', opacity: 0.85 } }]}
          layout={{ xaxis: { title: 'Category' }, yaxis: { title: 'Value' } }}
        />
      </div>
    )
  }

  if (kind === 'table') {
    const p = payload as unknown as TablePayload
    const rowKeys =
      p.rows.length > 0
        ? Array.from(new Set([...(Object.keys(p.rows[0]) ?? []), ...p.rows.flatMap((row) => Object.keys(row))]))
        : []
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {rowKeys.map((key) => (
                  <th key={key}>{key.replace(/_/g, ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.rows.slice(0, 30).map((row, idx) => (
                <tr key={String(row.asset ?? row.label ?? idx)}>
                  {rowKeys.map((key) => (
                    <td key={`${idx}-${key}`}>{formatCell(row[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="plot-card">
      <h3>{plot.title}</h3>
      <p>Unsupported payload.</p>
    </div>
  )
}
