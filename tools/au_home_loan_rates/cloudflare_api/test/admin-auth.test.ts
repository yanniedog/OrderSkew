import { describe, expect, it } from 'vitest'
import { isBearerTokenAuthorized, parseBearerToken } from '../src/auth/admin'

describe('admin auth helpers', () => {
  it('parses bearer tokens correctly', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123')
    expect(parseBearerToken('bearer xyz')).toBe('xyz')
    expect(parseBearerToken('Token xyz')).toBeNull()
  })

  it('authorizes only exact bearer token matches', () => {
    expect(isBearerTokenAuthorized('abc', 'abc')).toBe(true)
    expect(isBearerTokenAuthorized('abc', 'def')).toBe(false)
    expect(isBearerTokenAuthorized(null, 'abc')).toBe(false)
  })
})