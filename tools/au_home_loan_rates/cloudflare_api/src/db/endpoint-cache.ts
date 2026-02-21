import { CDR_REGISTER_DISCOVERY_URL } from '../constants'
import type { LenderConfig } from '../types'
import { nowIso } from '../utils/time'

export async function getCachedEndpoint(
  db: D1Database,
  lenderCode: string,
  now = nowIso(),
): Promise<{ endpointUrl: string; expiresAt: string } | null> {
  const row = await db
    .prepare(
      `SELECT endpoint_url, expires_at
       FROM lender_endpoint_cache
       WHERE lender_code = ?1
       LIMIT 1`,
    )
    .bind(lenderCode)
    .first<{ endpoint_url: string; expires_at: string }>()

  if (!row) {
    return null
  }

  if (row.expires_at <= now) {
    return null
  }

  return {
    endpointUrl: row.endpoint_url,
    expiresAt: row.expires_at,
  }
}

export async function upsertEndpointCache(
  db: D1Database,
  input: {
    lenderCode: string
    endpointUrl: string
    expiresAt: string
    sourceUrl?: string
    httpStatus?: number
    notes?: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO lender_endpoint_cache (
         lender_code,
         endpoint_url,
         fetched_at,
         expires_at,
         source_url,
         http_status,
         notes
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(lender_code) DO UPDATE SET
         endpoint_url = excluded.endpoint_url,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         source_url = excluded.source_url,
         http_status = excluded.http_status,
         notes = excluded.notes`,
    )
    .bind(
      input.lenderCode,
      input.endpointUrl,
      nowIso(),
      input.expiresAt,
      input.sourceUrl ?? null,
      input.httpStatus ?? null,
      input.notes ?? null,
    )
    .run()
}

export async function refreshEndpointCacheStub(
  db: D1Database,
  lenders: LenderConfig[],
  ttlHours = 24,
): Promise<{ refreshed: number }> {
  const now = Date.now()
  const expiresAt = new Date(now + ttlHours * 3600 * 1000).toISOString()

  for (const lender of lenders) {
    await upsertEndpointCache(db, {
      lenderCode: lender.code,
      endpointUrl: `pending://cdr-register/${lender.code}`,
      expiresAt,
      sourceUrl: CDR_REGISTER_DISCOVERY_URL,
      httpStatus: 200,
      notes: 'Phase 1 stub: runtime CDR register discovery deferred to Phase 2.',
    })
  }

  return { refreshed: lenders.length }
}