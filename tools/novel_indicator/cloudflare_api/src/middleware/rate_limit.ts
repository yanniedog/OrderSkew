import type { MiddlewareHandler } from 'hono'
import type { AppContext } from '../types'
import { checkRateLimit } from '../utils/rate_limit'

export function rateLimit(limit: number, windowMs: number): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const key = `${c.req.path}:${ip}`
    const ok = checkRateLimit(key, limit, windowMs)
    if (!ok) {
      return c.json({ error: 'Too many requests. Try again later.' }, 429)
    }
    await next()
  }
}
