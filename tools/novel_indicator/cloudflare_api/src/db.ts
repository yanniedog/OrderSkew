import type { AuthUser, Bindings, JsonObject, SessionRow } from './types'
import { nowIso } from './utils/time'

function db(env: Bindings): D1Database {
  return env.DB
}

export async function findUserByUsername(env: Bindings, username: string): Promise<AuthUser | null> {
  const row = await db(env)
    .prepare('SELECT * FROM users WHERE username = ?1')
    .bind(username.toLowerCase())
    .first<AuthUser>()
  return row ?? null
}

export async function findUserByEmail(env: Bindings, email: string): Promise<AuthUser | null> {
  const row = await db(env)
    .prepare('SELECT * FROM users WHERE email = ?1')
    .bind(email.toLowerCase())
    .first<AuthUser>()
  return row ?? null
}

export async function findUserById(env: Bindings, userId: string): Promise<AuthUser | null> {
  const row = await db(env)
    .prepare('SELECT * FROM users WHERE id = ?1')
    .bind(userId)
    .first<AuthUser>()
  return row ?? null
}

export async function createUser(
  env: Bindings,
  values: { username: string; email: string; displayName?: string | null },
): Promise<AuthUser> {
  const id = crypto.randomUUID()
  const now = nowIso()
  await db(env)
    .prepare(
      `INSERT INTO users (id, username, email, display_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, values.username.toLowerCase(), values.email.toLowerCase(), values.displayName ?? null, now, now)
    .run()
  const user = await findUserById(env, id)
  if (!user) {
    throw new Error('Failed to create user')
  }
  return user
}

export async function setPasswordCredential(env: Bindings, userId: string, hash: string): Promise<void> {
  const now = nowIso()
  await db(env)
    .prepare(
      `INSERT INTO password_credentials (user_id, password_hash, hash_algo, created_at, updated_at)
       VALUES (?1, ?2, 'argon2id', ?3, ?4)
       ON CONFLICT(user_id) DO UPDATE SET
         password_hash = excluded.password_hash,
         hash_algo = excluded.hash_algo,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, hash, now, now)
    .run()
}

export async function getPasswordHash(env: Bindings, userId: string): Promise<string | null> {
  const row = await db(env)
    .prepare('SELECT password_hash FROM password_credentials WHERE user_id = ?1')
    .bind(userId)
    .first<{ password_hash: string }>()
  return row?.password_hash ?? null
}

export async function setUserEmailVerified(env: Bindings, userId: string): Promise<void> {
  const now = nowIso()
  await db(env)
    .prepare('UPDATE users SET email_verified_at = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(now, now, userId)
    .run()
}

export async function createEmailVerificationToken(env: Bindings, userId: string, tokenHash: string, expiresAt: string): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt, nowIso())
    .run()
}

export async function consumeEmailVerificationToken(
  env: Bindings,
  tokenHash: string,
): Promise<{ user_id: string; expires_at: string; used_at: string | null } | null> {
  const row = await db(env)
    .prepare('SELECT user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = ?1')
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string; used_at: string | null }>()
  if (!row) {
    return null
  }
  if (!row.used_at) {
    await db(env)
      .prepare('UPDATE email_verification_tokens SET used_at = ?1 WHERE token_hash = ?2')
      .bind(nowIso(), tokenHash)
      .run()
  }
  return row
}

export async function createPasswordResetToken(env: Bindings, userId: string, tokenHash: string, expiresAt: string): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt, nowIso())
    .run()
}

export async function consumePasswordResetToken(
  env: Bindings,
  tokenHash: string,
): Promise<{ user_id: string; expires_at: string; used_at: string | null } | null> {
  const row = await db(env)
    .prepare('SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?1')
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string; used_at: string | null }>()
  if (!row) {
    return null
  }
  if (!row.used_at) {
    await db(env)
      .prepare('UPDATE password_reset_tokens SET used_at = ?1 WHERE token_hash = ?2')
      .bind(nowIso(), tokenHash)
      .run()
  }
  return row
}

export async function createOAuthAccount(env: Bindings, userId: string, provider: string, providerAccountId: string): Promise<void> {
  const now = nowIso()
  await db(env)
    .prepare(
      `INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(provider, provider_account_id) DO UPDATE SET user_id = excluded.user_id`,
    )
    .bind(crypto.randomUUID(), userId, provider, providerAccountId, now)
    .run()
}

export async function findOAuthAccount(
  env: Bindings,
  provider: string,
  providerAccountId: string,
): Promise<{ user_id: string } | null> {
  const row = await db(env)
    .prepare('SELECT user_id FROM oauth_accounts WHERE provider = ?1 AND provider_account_id = ?2')
    .bind(provider, providerAccountId)
    .first<{ user_id: string }>()
  return row ?? null
}

export async function createGoogleOAuthState(
  env: Bindings,
  payload: { stateHash: string; nonceHash: string; redirectUri: string; expiresAt: string },
): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO google_oauth_states (id, state_hash, nonce_hash, redirect_uri, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), payload.stateHash, payload.nonceHash, payload.redirectUri, payload.expiresAt, nowIso())
    .run()
}

export async function consumeGoogleOAuthState(
  env: Bindings,
  stateHash: string,
): Promise<{ nonce_hash: string; redirect_uri: string; expires_at: string; used_at: string | null } | null> {
  const row = await db(env)
    .prepare('SELECT nonce_hash, redirect_uri, expires_at, used_at FROM google_oauth_states WHERE state_hash = ?1')
    .bind(stateHash)
    .first<{ nonce_hash: string; redirect_uri: string; expires_at: string; used_at: string | null }>()
  if (!row) {
    return null
  }
  if (!row.used_at) {
    await db(env)
      .prepare('UPDATE google_oauth_states SET used_at = ?1 WHERE state_hash = ?2')
      .bind(nowIso(), stateHash)
      .run()
  }
  return row
}

export async function createSession(
  env: Bindings,
  payload: {
    userId: string
    tokenHash: string
    csrfToken: string
    ipHash: string | null
    userAgentHash: string | null
    expiresAt: string
  },
): Promise<SessionRow> {
  const id = crypto.randomUUID()
  const now = nowIso()
  await db(env)
    .prepare(
      `INSERT INTO sessions (
        id, user_id, token_hash, csrf_token, ip_hash, user_agent_hash, expires_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(id, payload.userId, payload.tokenHash, payload.csrfToken, payload.ipHash, payload.userAgentHash, payload.expiresAt, now, now)
    .run()
  const row = await db(env)
    .prepare('SELECT * FROM sessions WHERE id = ?1')
    .bind(id)
    .first<SessionRow>()
  if (!row) {
    throw new Error('Failed to create session')
  }
  return row
}

export async function findActiveSessionByTokenHash(env: Bindings, tokenHash: string): Promise<SessionRow | null> {
  const row = await db(env)
    .prepare('SELECT * FROM sessions WHERE token_hash = ?1 AND revoked_at IS NULL LIMIT 1')
    .bind(tokenHash)
    .first<SessionRow>()
  return row ?? null
}

export async function revokeSessionByTokenHash(env: Bindings, tokenHash: string): Promise<void> {
  await db(env)
    .prepare('UPDATE sessions SET revoked_at = ?1, updated_at = ?2 WHERE token_hash = ?3')
    .bind(nowIso(), nowIso(), tokenHash)
    .run()
}

export async function revokeAllUserSessions(env: Bindings, userId: string): Promise<void> {
  await db(env)
    .prepare('UPDATE sessions SET revoked_at = ?1, updated_at = ?2 WHERE user_id = ?3 AND revoked_at IS NULL')
    .bind(nowIso(), nowIso(), userId)
    .run()
}

export async function getUserPreferences(env: Bindings, userId: string): Promise<JsonObject | null> {
  const row = await db(env)
    .prepare('SELECT payload_json FROM user_preferences WHERE user_id = ?1')
    .bind(userId)
    .first<{ payload_json: string }>()
  if (!row) {
    return null
  }
  try {
    return JSON.parse(row.payload_json) as JsonObject
  } catch {
    return null
  }
}

export async function setUserPreferences(env: Bindings, userId: string, payload: JsonObject): Promise<void> {
  const now = nowIso()
  await db(env)
    .prepare(
      `INSERT INTO user_preferences (user_id, payload_json, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(payload), now)
    .run()
}

export async function upsertRunSummary(
  env: Bindings,
  userId: string,
  payload: {
    runId: string
    sourceVersion: string
    syncState: string
    retainedAt: string
    config: JsonObject
    summary: JsonObject
  },
): Promise<{ id: string }> {
  const now = nowIso()
  const existing = await db(env)
    .prepare('SELECT id FROM run_summaries WHERE user_id = ?1 AND run_id = ?2')
    .bind(userId, payload.runId)
    .first<{ id: string }>()

  if (existing) {
    await db(env)
      .prepare(
        `UPDATE run_summaries
         SET source_version = ?1,
             sync_state = ?2,
             retained_at = ?3,
             updated_at = ?4,
             config_json = ?5,
             summary_json = ?6
         WHERE id = ?7`,
      )
      .bind(
        payload.sourceVersion,
        payload.syncState,
        payload.retainedAt,
        now,
        JSON.stringify(payload.config),
        JSON.stringify(payload.summary),
        existing.id,
      )
      .run()
    return { id: existing.id }
  }

  const id = crypto.randomUUID()
  await db(env)
    .prepare(
      `INSERT INTO run_summaries (
          id, user_id, run_id, source_version, sync_state, retained_at, created_at, updated_at, config_json, summary_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      id,
      userId,
      payload.runId,
      payload.sourceVersion,
      payload.syncState,
      payload.retainedAt,
      now,
      now,
      JSON.stringify(payload.config),
      JSON.stringify(payload.summary),
    )
    .run()
  return { id }
}

export async function replaceRunPlots(
  env: Bindings,
  summaryId: string,
  plots: Array<{ plot_id: string; payload: JsonObject }>,
): Promise<void> {
  await db(env).prepare('DELETE FROM run_plots WHERE summary_id = ?1').bind(summaryId).run()
  const now = nowIso()
  for (const plot of plots) {
    await db(env)
      .prepare(
        `INSERT INTO run_plots (id, summary_id, plot_id, payload_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(crypto.randomUUID(), summaryId, plot.plot_id, JSON.stringify(plot.payload), now, now)
      .run()
  }
}

export async function listRunSummaries(env: Bindings, userId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db(env)
    .prepare('SELECT run_id, source_version, sync_state, retained_at, created_at, updated_at, summary_json FROM run_summaries WHERE user_id = ?1 ORDER BY updated_at DESC')
    .bind(userId)
    .all<{ run_id: string; source_version: string; sync_state: string; retained_at: string; created_at: string; updated_at: string; summary_json: string }>()
  return (rows.results ?? []).map((row) => ({
    run_id: row.run_id,
    source_version: row.source_version,
    sync_state: row.sync_state,
    retained_at: row.retained_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    summary: JSON.parse(row.summary_json),
  }))
}

export async function getRunSummaryWithPlots(
  env: Bindings,
  userId: string,
  runId: string,
): Promise<{ summary: Record<string, unknown>; plots: Array<{ plot_id: string; payload: JsonObject }> } | null> {
  const summary = await db(env)
    .prepare('SELECT id, run_id, source_version, sync_state, retained_at, created_at, updated_at, config_json, summary_json FROM run_summaries WHERE user_id = ?1 AND run_id = ?2')
    .bind(userId, runId)
    .first<{ id: string; run_id: string; source_version: string; sync_state: string; retained_at: string; created_at: string; updated_at: string; config_json: string; summary_json: string }>()
  if (!summary) {
    return null
  }
  const plotsRows = await db(env)
    .prepare('SELECT plot_id, payload_json FROM run_plots WHERE summary_id = ?1 ORDER BY plot_id ASC')
    .bind(summary.id)
    .all<{ plot_id: string; payload_json: string }>()

  return {
    summary: {
      run_id: summary.run_id,
      source_version: summary.source_version,
      sync_state: summary.sync_state,
      retained_at: summary.retained_at,
      created_at: summary.created_at,
      updated_at: summary.updated_at,
      config: JSON.parse(summary.config_json),
      summary: JSON.parse(summary.summary_json),
    },
    plots: (plotsRows.results ?? []).map((p) => ({ plot_id: p.plot_id, payload: JSON.parse(p.payload_json) as JsonObject })),
  }
}

export async function deleteRunSummary(env: Bindings, userId: string, runId: string): Promise<boolean> {
  const existing = await db(env)
    .prepare('SELECT id FROM run_summaries WHERE user_id = ?1 AND run_id = ?2')
    .bind(userId, runId)
    .first<{ id: string }>()
  if (!existing) {
    return false
  }
  await db(env).prepare('DELETE FROM run_summaries WHERE id = ?1').bind(existing.id).run()
  return true
}
