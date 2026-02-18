import type { MiddlewareHandler } from 'hono'
import { findActiveSessionByTokenHash, findUserById, revokeSessionByTokenHash } from '../db'
import { getCookie } from '../utils/cookies'
import { isExpired } from '../utils/time'
import { sha256Hex } from '../utils/crypto'
import type { AppContext } from '../types'

export const SESSION_COOKIE = 'ni_session'
export const CSRF_COOKIE = 'ni_csrf'

export const authRequired: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) {
    return c.json({ error: 'Authentication required.' }, 401)
  }

  const tokenHash = await sha256Hex(token)
  const session = await findActiveSessionByTokenHash(c.env, tokenHash)
  if (!session) {
    return c.json({ error: 'Session not found.' }, 401)
  }
  if (session.revoked_at || isExpired(session.expires_at)) {
    await revokeSessionByTokenHash(c.env, tokenHash)
    return c.json({ error: 'Session expired.' }, 401)
  }

  const user = await findUserById(c.env, session.user_id)
  if (!user) {
    return c.json({ error: 'User not found.' }, 401)
  }

  c.set('authUser', user)
  c.set('session', session)
  await next()
}

export const csrfProtected: MiddlewareHandler<AppContext> = async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next()
  }

  const session = c.get('session')
  const headerToken = c.req.header('X-CSRF-Token')
  const cookieToken = getCookie(c, CSRF_COOKIE)

  if (!headerToken || !cookieToken || headerToken !== cookieToken || headerToken !== session.csrf_token) {
    return c.json({ error: 'CSRF validation failed.' }, 403)
  }
  await next()
}
