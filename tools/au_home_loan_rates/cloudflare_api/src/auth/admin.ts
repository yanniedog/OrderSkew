import type { MiddlewareHandler } from 'hono'
import type { AdminAuthState, AppContext } from '../types'
import { jsonError, withNoStore } from '../utils/http'
import { verifyAccessJwtToken } from './access-jwt'

export function parseBearerToken(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  if (!match) {
    return null
  }
  const token = match[1].trim()
  return token || null
}

export function isBearerTokenAuthorized(providedToken: string | null, expectedToken: string | undefined): boolean {
  const expected = String(expectedToken ?? '').trim()
  if (!providedToken || !expected) {
    return false
  }
  return providedToken === expected
}

export async function evaluateAdminAuth(c: Parameters<MiddlewareHandler<AppContext>>[0]): Promise<AdminAuthState> {
  const bearerToken = parseBearerToken(c.req.header('Authorization'))
  const expectedToken = c.env.ADMIN_API_TOKEN

  if (isBearerTokenAuthorized(bearerToken, expectedToken)) {
    return {
      ok: true,
      mode: 'bearer',
      subject: 'admin-token',
    }
  }

  const accessAssertion = c.req.header('Cf-Access-Jwt-Assertion')
  if (accessAssertion) {
    const accessResult = await verifyAccessJwtToken(accessAssertion, {
      teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
      audience: c.env.CF_ACCESS_AUD,
    })

    if (accessResult.ok) {
      return {
        ok: true,
        mode: 'access',
        subject: String(accessResult.payload?.sub || 'access-user'),
        jwtPayload: accessResult.payload,
      }
    }

    return {
      ok: false,
      mode: null,
      reason: accessResult.reason || 'invalid_access_jwt',
    }
  }

  if (bearerToken && !isBearerTokenAuthorized(bearerToken, expectedToken)) {
    return {
      ok: false,
      mode: null,
      reason: 'invalid_bearer_token',
    }
  }

  return {
    ok: false,
    mode: null,
    reason: 'admin_token_or_access_jwt_required',
  }
}

export function requireAdmin(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    withNoStore(c)

    const authState = await evaluateAdminAuth(c)
    c.set('adminAuthState', authState)

    if (!authState.ok) {
      return jsonError(c, 401, 'UNAUTHORIZED', 'Admin authentication failed.', {
        reason: authState.reason,
      })
    }

    await next()
  }
}