import { describe, expect, it } from 'vitest'
import { calculateRetryDelaySeconds } from '../src/queue/consumer'

describe('queue retry backoff', () => {
  it('grows exponentially with cap', () => {
    expect(calculateRetryDelaySeconds(1)).toBe(15)
    expect(calculateRetryDelaySeconds(2)).toBe(30)
    expect(calculateRetryDelaySeconds(3)).toBe(60)
    expect(calculateRetryDelaySeconds(10)).toBeLessThanOrEqual(900)
  })
})