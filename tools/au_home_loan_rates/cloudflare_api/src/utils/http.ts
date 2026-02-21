import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function withNoStore(c: Context): void {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  c.header('Pragma', 'no-cache')
  c.header('Expires', '0')
}

export function withPublicCache(c: Context, seconds = 120): void {
  const sMaxAge = Math.max(1, Math.floor(seconds))
  const stale = Math.max(sMaxAge * 2, 120)
  c.header('Cache-Control', `public, s-maxage=${sMaxAge}, stale-while-revalidate=${stale}`)
}

export function jsonError(c: Context, status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
  return c.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  )
}
