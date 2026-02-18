import { describe, expect, it } from 'vitest'
import { validateRunPayload } from './validation'

function validPayload(): Record<string, unknown> {
  return {
    run_id: 'abc123',
    source_version: 'web-local-v1',
    sync_state: 'synced',
    retained_at: '2026-02-18T00:00:00.000Z',
    config: {
      top_n_symbols: 6,
      timeframes: ['5m', '1h'],
      budget_minutes: 35,
      random_seed: 42,
    },
    summary: {
      run_id: 'abc123',
      generated_at: '2026-02-18T00:00:00.000Z',
      universal_recommendation: {
        symbol: 'UNIVERSAL',
      },
    },
    plots: [
      {
        plot_id: 'horizon_heatmap',
        payload: {
          type: 'heatmap',
          x: [1, 2, 3],
          y: ['BTCUSDT:5m'],
          z: [[0.12, 0.11, 0.1]],
        },
      },
    ],
  } as Record<string, unknown>
}

describe('validateRunPayload', () => {
  it('accepts a valid summary payload', () => {
    const result = validateRunPayload(validPayload())
    expect(result.ok).toBe(true)
  })

  it('rejects payloads containing raw OHLCV rows', () => {
    const payload = validPayload()
    ;(payload as { plots: unknown[] }).plots = [
      {
        plot_id: 'bad_raw_candles',
        payload: {
          candles: Array.from({ length: 250 }).map((_, idx) => ({
            timestamp: 1700000000000 + idx * 300000,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 12,
          })),
        },
      },
    ]
    const result = validateRunPayload(payload)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('ohlcv')
    }
  })

  it('rejects payloads with too many plots', () => {
    const payload = validPayload()
    ;(payload as { plots: unknown[] }).plots = Array.from({ length: 13 }).map((_, idx) => ({
      plot_id: `plot_${idx}`,
      payload: { values: [idx] },
    }))
    const result = validateRunPayload(payload)
    expect(result.ok).toBe(false)
  })
})
