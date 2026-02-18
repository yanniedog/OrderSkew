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
  points: Array<{ label: string; complexity: number; error: number }>
}

type BarPayload = {
  type: 'bar'
  categories: string[]
  values: number[]
}

type TablePayload = {
  type: 'table'
  rows: Array<{ label: string; error: number; hit_rate: number; horizon: number }>
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

function Chart({ data }: { data: Array<Record<string, unknown>> }) {
  return (
    <Suspense fallback={<div className="plot-loading">Loading chart...</div>}>
      <Plot
        data={data as never}
        layout={{ margin: { t: 20, r: 10, b: 40, l: 40 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff' }}
        style={{ width: '100%', height: '320px' }}
        useResizeHandler
      />
    </Suspense>
  )
}

export function PlotPanel({ plot }: { plot: PlotPayload }) {
  const payload = asObject(plot.payload)
  const kind = payload?.type

  if (kind === 'heatmap') {
    const p = downsampleHeatmap(payload as unknown as HeatmapPayload)
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart data={[{ type: 'heatmap', x: p.x, y: p.y, z: p.z, colorscale: 'Viridis' }]} />
      </div>
    )
  }

  if (kind === 'line') {
    const p = downsampleLine(payload as unknown as LinePayload)
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart data={p.series.map((s) => ({ type: 'scatter', mode: 'lines', name: s.name, x: p.x, y: s.values }))} />
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
              text: p.points.map((pt) => pt.label),
              marker: { size: 8, color: '#d65a31' },
            },
          ]}
        />
      </div>
    )
  }

  if (kind === 'bar') {
    const p = payload as unknown as BarPayload
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <Chart data={[{ type: 'bar', x: p.categories, y: p.values, marker: { color: '#005f73' } }]} />
      </div>
    )
  }

  if (kind === 'table') {
    const p = payload as unknown as TablePayload
    return (
      <div className="plot-card">
        <h3>{plot.title}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Error</th>
                <th>HitRate</th>
                <th>Horizon</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.slice(0, 20).map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.error.toFixed(6)}</td>
                  <td>{r.hit_rate.toFixed(3)}</td>
                  <td>{r.horizon}</td>
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
