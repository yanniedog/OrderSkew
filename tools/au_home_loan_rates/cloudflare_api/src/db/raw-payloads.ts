import type { SourceType } from '../types'
import { buildRawR2Key } from '../utils/idempotency'
import { sha256HexFromBytes } from '../utils/hash'
import { nowIso } from '../utils/time'

type RawPayloadInput = {
  sourceType: SourceType
  sourceUrl: string
  payload: unknown
  fetchedAtIso?: string
  httpStatus?: number | null
  notes?: string | null
}

type RawPayloadResult = {
  inserted: boolean
  id: number | null
  contentHash: string
  r2Key: string
}

type RawEnv = {
  DB: D1Database
  RAW_BUCKET: R2Bucket
}

function contentTypeForSource(sourceType: SourceType): string {
  return sourceType === 'wayback_html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
}

function serializePayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload
  }
  if (payload instanceof Uint8Array) {
    return new TextDecoder().decode(payload)
  }
  if (payload instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(payload))
  }

  try {
    return JSON.stringify(payload ?? null, null, 2)
  } catch {
    return JSON.stringify({ fallback: String(payload) })
  }
}

export async function persistRawPayload(env: RawEnv, input: RawPayloadInput): Promise<RawPayloadResult> {
  const fetchedAtIso = input.fetchedAtIso || nowIso()
  const payloadText = serializePayload(input.payload)
  const payloadBytes = new TextEncoder().encode(payloadText)
  const contentHash = await sha256HexFromBytes(payloadBytes)

  const existing = await env.DB.prepare(
    `SELECT id, r2_key
     FROM raw_payloads
     WHERE source_type = ?1
       AND source_url = ?2
       AND content_hash = ?3
     LIMIT 1`,
  )
    .bind(input.sourceType, input.sourceUrl, contentHash)
    .first<{ id: number; r2_key: string }>()

  if (existing) {
    return {
      inserted: false,
      id: Number(existing.id),
      contentHash,
      r2Key: existing.r2_key,
    }
  }

  const r2Key = buildRawR2Key(input.sourceType, fetchedAtIso, contentHash)
  await env.RAW_BUCKET.put(r2Key, payloadText, {
    httpMetadata: {
      contentType: contentTypeForSource(input.sourceType),
    },
    customMetadata: {
      source_type: input.sourceType,
      source_url: input.sourceUrl,
      content_hash: contentHash,
    },
  })

  const inserted = await env.DB.prepare(
    `INSERT INTO raw_payloads (
      source_type,
      fetched_at,
      source_url,
      content_hash,
      r2_key,
      http_status,
      notes
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      input.sourceType,
      fetchedAtIso,
      input.sourceUrl,
      contentHash,
      r2Key,
      input.httpStatus == null ? null : Math.floor(input.httpStatus),
      input.notes ?? null,
    )
    .run()

  return {
    inserted: Number(inserted.meta?.changes || 0) > 0,
    id: Number(inserted.meta?.last_row_id || 0) || null,
    contentHash,
    r2Key,
  }
}