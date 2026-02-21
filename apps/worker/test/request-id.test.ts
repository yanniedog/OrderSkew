import { describe, expect, it } from 'vitest'
import { getRequestId } from '../src/logging'

describe('getRequestId', () => {
  it('uses incoming request id when provided', () => {
    const headers = new Headers({ 'x-request-id': 'abc-123' })
    expect(getRequestId(headers)).toBe('abc-123')
  })

  it('generates request id when missing', () => {
    const headers = new Headers()
    const id = getRequestId(headers)
    expect(id.length).toBeGreaterThan(8)
  })
})