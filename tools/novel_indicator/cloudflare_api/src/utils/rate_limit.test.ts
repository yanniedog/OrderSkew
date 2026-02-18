import { describe, expect, it, vi } from 'vitest'
import { checkRateLimit } from './rate_limit'

describe('checkRateLimit', () => {
  it('enforces the configured window and limit', () => {
    vi.useFakeTimers()
    try {
      const key = 'auth:127.0.0.1'
      expect(checkRateLimit(key, 2, 1000)).toBe(true)
      expect(checkRateLimit(key, 2, 1000)).toBe(true)
      expect(checkRateLimit(key, 2, 1000)).toBe(false)

      vi.advanceTimersByTime(1001)
      expect(checkRateLimit(key, 2, 1000)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
