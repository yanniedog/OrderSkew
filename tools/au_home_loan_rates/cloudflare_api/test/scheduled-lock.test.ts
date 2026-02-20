import { describe, expect, it } from 'vitest'
import { shouldRunScheduledAtTargetHour } from '../src/pipeline/scheduled'

describe('scheduled hour guard', () => {
  it('runs only when hour equals target', () => {
    expect(shouldRunScheduledAtTargetHour(6, 6)).toBe(true)
    expect(shouldRunScheduledAtTargetHour(5, 6)).toBe(false)
    expect(shouldRunScheduledAtTargetHour(7, 6)).toBe(false)
  })
})