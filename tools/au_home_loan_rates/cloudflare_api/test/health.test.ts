import { describe, expect, it } from 'vitest'
import { getMelbourneNowParts, isDateOnly } from '../src/utils/time'

describe('health/time helpers', () => {
  it('returns Melbourne date parts with date-only format', () => {
    const parts = getMelbourneNowParts(new Date('2026-02-20T00:00:00.000Z'))

    expect(isDateOnly(parts.date)).toBe(true)
    expect(parts.hour).toBeGreaterThanOrEqual(0)
    expect(parts.hour).toBeLessThan(24)
  })
})