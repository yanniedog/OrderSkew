import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  createEmailVerificationToken,
  createGoogleOAuthState,
  createOAuthAccount,
  createPasswordResetToken,
  createSession,
  createUser,
  findOAuthAccount,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  getPasswordHash,
  revokeSessionByTokenHash,
  setPasswordCredential,
  setUserEmailVerified,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  consumeGoogleOAuthState,
} from '../db'
import type { AppContext, AuthUser } from '../types'
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../utils/crypto'
import { clearCookie, getCookie, setCookie } from '../utils/cookies'
import { isExpired, minutesFromNow } from '../utils/time'
import { authRequired, csrfProtected, CSRF_COOKIE, SESSION_COOKIE } from '../middleware/auth'
import { rateLimit } from '../middleware/rate_limit'

export const authRoutes = new Hono<AppContext>()

function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function validUsername(username: string): boolean {
  return /^[a-z0-9_]{3,32}$/.test(username)
}

function validPassword(password: string): boolean {
  return password.length >= 10 && password.length <= 128
}

function cookieDomain(env: AppContext['Bindings']): string | undefined {
  const value = env.COOKIE_DOMAIN?.trim() ?? ''
  return value ? value : undefined
}

async function sendEmail(env: AppContext['Bindings'], payload: { to: string; subject: string; html: string }): Promise<void> {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    return
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
  })
}

function appOrigin(c: { req: { url: string } }, env: AppContext['Bindings']): string {
  if (env.APP_ORIGIN && env.APP_ORIGIN.trim()) {
    return env.APP_ORIGIN.trim().replace(/\/+$/, '')
  }
  return new URL(c.req.url).origin
}

async function createSessionCookies(c: Context<AppContext>, user: AuthUser): Promise<void> {
  const previousSessionToken = getCookie(c, SESSION_COOKIE)
  if (previousSessionToken) {
    await revokeSessionByTokenHash(c.env, await sha256Hex(previousSessionToken))
  }
  const sessionToken = randomToken(32)
  const csrfToken = randomToken(18)
  const sessionHash = await sha256Hex(sessionToken)
  const ip = c.req.header('CF-Connecting-IP') ?? null
  const ua = c.req.header('User-Agent') ?? null

  await createSession(c.env, {
    userId: user.id,
    tokenHash: sessionHash,
    csrfToken,
    ipHash: ip ? await sha256Hex(ip) : null,
    userAgentHash: ua ? await sha256Hex(ua) : null,
    expiresAt: minutesFromNow(60 * 24 * 14),
  })

  setCookie(c, SESSION_COOKIE, sessionToken, {
    maxAge: 60 * 60 * 24 * 14,
    domain: cookieDomain(c.env),
    sameSite: 'Lax',
    httpOnly: true,
  })
  setCookie(c, CSRF_COOKIE, csrfToken, {
    maxAge: 60 * 60 * 24 * 14,
    domain: cookieDomain(c.env),
    sameSite: 'Lax',
    httpOnly: false,
  })
}

async function buildUniqueUsername(env: AppContext['Bindings'], preferred: string): Promise<string> {
  const base = sanitizeUsername(preferred).replace(/[^a-z0-9_]/g, '').slice(0, 24) || `user_${randomToken(4).toLowerCase()}`
  let candidate = base
  let counter = 0
  while (counter < 1000) {
    const exists = await findUserByUsername(env, candidate)
    if (!exists) {
      return candidate
    }
    counter += 1
    candidate = `${base}_${counter}`.slice(0, 32)
  }
  return `user_${randomToken(8).toLowerCase()}`
}

authRoutes.post('/register', rateLimit(25, 60_000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const username = sanitizeUsername(String(body?.username ?? ''))
  const email = sanitizeEmail(String(body?.email ?? ''))
  const password = String(body?.password ?? '')
  const displayName = String(body?.display_name ?? '').trim() || null

  if (!validUsername(username)) {
    return c.json({ error: 'Username must be 3-32 chars (a-z, 0-9, _).' }, 400)
  }
  if (!email.includes('@') || email.length > 255) {
    return c.json({ error: 'Invalid email address.' }, 400)
  }
  if (!validPassword(password)) {
    return c.json({ error: 'Password must be 10-128 characters.' }, 400)
  }

  const existingUsername = await findUserByUsername(c.env, username)
  if (existingUsername) {
    return c.json({ error: 'Username already taken.' }, 409)
  }
  const existingEmail = await findUserByEmail(c.env, email)
  if (existingEmail) {
    return c.json({ error: 'Email already registered.' }, 409)
  }

  const user = await createUser(c.env, { username, email, displayName })
  const passwordHash = await hashPassword(password)
  await setPasswordCredential(c.env, user.id, passwordHash)

  const verifyToken = randomToken(32)
  await createEmailVerificationToken(c.env, user.id, await sha256Hex(verifyToken), minutesFromNow(60 * 24))
  const verifyUrl = `${appOrigin(c, c.env)}/pages/novel_indicator/index.html?verify_token=${encodeURIComponent(verifyToken)}`
  await sendEmail(c.env, {
    to: user.email,
    subject: 'Verify your Novel Indicator account',
    html: `<p>Click to verify your account:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
  })

  await createSessionCookies(c, user)

  const response: Record<string, unknown> = {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      email_verified: Boolean(user.email_verified_at),
    },
  }
  if (String(c.env.ALLOW_DEV_TOKEN_ECHO ?? '').toLowerCase() === 'true') {
    response.dev_verify_token = verifyToken
  }

  return c.json(response, 201)
})

authRoutes.post('/login', rateLimit(35, 60_000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const identity = String(body?.identity ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')

  if (!identity || !password) {
    return c.json({ error: 'Missing identity/password.' }, 400)
  }

  const user = identity.includes('@') ? await findUserByEmail(c.env, identity) : await findUserByUsername(c.env, identity)
  if (!user) {
    return c.json({ error: 'Invalid credentials.' }, 401)
  }

  const storedHash = await getPasswordHash(c.env, user.id)
  if (!storedHash) {
    return c.json({ error: 'Password login is not configured for this account.' }, 401)
  }

  const ok = await verifyPassword(password, storedHash)
  if (!ok) {
    return c.json({ error: 'Invalid credentials.' }, 401)
  }

  await createSessionCookies(c, user)
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      email_verified: Boolean(user.email_verified_at),
    },
  })
})

authRoutes.post('/logout', authRequired, csrfProtected, async (c) => {
  const session = c.get('session')
  await revokeSessionByTokenHash(c.env, session.token_hash)
  clearCookie(c, SESSION_COOKIE, cookieDomain(c.env))
  clearCookie(c, CSRF_COOKIE, cookieDomain(c.env))
  return c.json({ ok: true })
})

authRoutes.post('/email/verify/request', authRequired, csrfProtected, rateLimit(20, 60_000), async (c) => {
  const user = c.get('authUser')
  const verifyToken = randomToken(32)
  await createEmailVerificationToken(c.env, user.id, await sha256Hex(verifyToken), minutesFromNow(60 * 24))

  const verifyUrl = `${appOrigin(c, c.env)}/pages/novel_indicator/index.html?verify_token=${encodeURIComponent(verifyToken)}`
  await sendEmail(c.env, {
    to: user.email,
    subject: 'Verify your Novel Indicator account',
    html: `<p>Click to verify your account:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
  })

  const response: Record<string, unknown> = { ok: true }
  if (String(c.env.ALLOW_DEV_TOKEN_ECHO ?? '').toLowerCase() === 'true') {
    response.dev_verify_token = verifyToken
  }
  return c.json(response)
})

authRoutes.post('/email/verify/confirm', rateLimit(25, 60_000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = String(body?.token ?? '').trim()
  if (!token) {
    return c.json({ error: 'Missing token.' }, 400)
  }

  const row = await consumeEmailVerificationToken(c.env, await sha256Hex(token))
  if (!row || row.used_at || isExpired(row.expires_at)) {
    return c.json({ error: 'Invalid or expired verification token.' }, 400)
  }

  await setUserEmailVerified(c.env, row.user_id)
  return c.json({ ok: true })
})

authRoutes.post('/password/forgot', rateLimit(20, 60_000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = sanitizeEmail(String(body?.email ?? ''))
  if (!email.includes('@')) {
    return c.json({ ok: true })
  }
  const user = await findUserByEmail(c.env, email)
  if (!user) {
    return c.json({ ok: true })
  }

  const resetToken = randomToken(32)
  await createPasswordResetToken(c.env, user.id, await sha256Hex(resetToken), minutesFromNow(30))
  const resetUrl = `${appOrigin(c, c.env)}/pages/novel_indicator/index.html?reset_token=${encodeURIComponent(resetToken)}`

  await sendEmail(c.env, {
    to: user.email,
    subject: 'Reset your Novel Indicator password',
    html: `<p>Click to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  })

  const response: Record<string, unknown> = { ok: true }
  if (String(c.env.ALLOW_DEV_TOKEN_ECHO ?? '').toLowerCase() === 'true') {
    response.dev_reset_token = resetToken
  }
  return c.json(response)
})

authRoutes.post('/password/reset', rateLimit(25, 60_000), async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = String(body?.token ?? '').trim()
  const newPassword = String(body?.new_password ?? '')

  if (!token || !validPassword(newPassword)) {
    return c.json({ error: 'Invalid token or password.' }, 400)
  }

  const row = await consumePasswordResetToken(c.env, await sha256Hex(token))
  if (!row || row.used_at || isExpired(row.expires_at)) {
    return c.json({ error: 'Invalid or expired reset token.' }, 400)
  }

  await setPasswordCredential(c.env, row.user_id, await hashPassword(newPassword))
  return c.json({ ok: true })
})

authRoutes.get('/google/start', rateLimit(35, 60_000), async (c) => {
  const state = randomToken(24)
  const nonce = randomToken(24)
  await createGoogleOAuthState(c.env, {
    stateHash: await sha256Hex(state),
    nonceHash: await sha256Hex(nonce),
    redirectUri: c.env.GOOGLE_REDIRECT_URI,
    expiresAt: minutesFromNow(15),
  })

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302)
})

authRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return c.json({ error: 'Missing Google callback parameters.' }, 400)
  }

  const stored = await consumeGoogleOAuthState(c.env, await sha256Hex(state))
  if (!stored || stored.used_at || isExpired(stored.expires_at)) {
    return c.json({ error: 'Invalid OAuth state.' }, 400)
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    return c.json({ error: 'Google token exchange failed.' }, 401)
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string }
  if (!tokenJson.access_token) {
    return c.json({ error: 'Missing Google access token.' }, 401)
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })
  if (!profileResponse.ok) {
    return c.json({ error: 'Unable to read Google profile.' }, 401)
  }

  const profile = (await profileResponse.json()) as {
    sub: string
    email?: string
    email_verified?: boolean
    name?: string
  }

  if (!profile.sub || !profile.email) {
    return c.json({ error: 'Google profile missing required fields.' }, 401)
  }

  const linked = await findOAuthAccount(c.env, 'google', profile.sub)
  let user: AuthUser | null = null

  if (linked) {
    user = await findUserById(c.env, linked.user_id)
  }
  if (!user) {
    user = await findUserByEmail(c.env, profile.email)
  }
  if (!user) {
    const usernameSeed = profile.email.split('@')[0] ?? 'google_user'
    const uniqueUsername = await buildUniqueUsername(c.env, usernameSeed)
    user = await createUser(c.env, {
      username: uniqueUsername,
      email: profile.email,
      displayName: profile.name ?? null,
    })
  }

  await createOAuthAccount(c.env, user.id, 'google', profile.sub)
  if (profile.email_verified) {
    await setUserEmailVerified(c.env, user.id)
    user = (await findUserById(c.env, user.id)) ?? user
  }

  await createSessionCookies(c, user)

  const redirectTo = `${appOrigin(c, c.env)}/pages/novel_indicator/index.html?auth=google_success`
  return c.redirect(redirectTo, 302)
})

authRoutes.get('/session', authRequired, async (c) => {
  const user = c.get('authUser')
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      email_verified: Boolean(user.email_verified_at),
    },
    csrf_token: getCookie(c, CSRF_COOKIE),
  })
})

