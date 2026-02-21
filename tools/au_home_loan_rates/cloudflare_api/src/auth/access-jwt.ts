import type { JWTPayload } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'

type AccessJwtValidationResult = {
  ok: boolean
  reason?: string
  payload?: JWTPayload
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function normalizeTeamDomain(teamDomain: string): string {
  return teamDomain.replace(/^https?:\/\//i, '').replace(/\/+$/g, '')
}

function getRemoteJwks(teamDomain: string) {
  const normalized = normalizeTeamDomain(teamDomain)
  const cached = jwksCache.get(normalized)
  if (cached) {
    return cached
  }
  const jwks = createRemoteJWKSet(new URL(`https://${normalized}/cdn-cgi/access/certs`))
  jwksCache.set(normalized, jwks)
  return jwks
}

export async function verifyAccessJwtToken(
  token: string,
  params: { teamDomain?: string; audience?: string },
): Promise<AccessJwtValidationResult> {
  if (!token) {
    return { ok: false, reason: 'missing_access_jwt' }
  }

  const teamDomain = String(params.teamDomain ?? '').trim()
  const audience = String(params.audience ?? '').trim()

  if (!teamDomain || !audience) {
    return { ok: false, reason: 'access_not_configured' }
  }

  const issuer = `https://${normalizeTeamDomain(teamDomain)}`
  const jwks = getRemoteJwks(teamDomain)

  try {
    const verified = await jwtVerify(token, jwks, {
      issuer,
      audience,
    })
    return {
      ok: true,
      payload: verified.payload,
    }
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error)?.message || 'invalid_access_jwt',
    }
  }
}