import { DEFAULT_MAX_QUEUE_ATTEMPTS } from '../constants'
import { getCachedEndpoint } from '../db/endpoint-cache'
import { persistRawPayload } from '../db/raw-payloads'
import { recordRunQueueOutcome } from '../db/run-reports'
import type { BackfillSnapshotJob, DailyLenderJob, EnvBindings, IngestMessage, ProductDetailJob } from '../types'
import { nowIso, parseIntegerEnv } from '../utils/time'

export function calculateRetryDelaySeconds(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts))
  return Math.min(900, 15 * Math.pow(2, safeAttempt - 1))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isIngestMessage(value: unknown): value is IngestMessage {
  if (!isObject(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'daily_lender_fetch') {
    return typeof value.runId === 'string' && typeof value.lenderCode === 'string' && typeof value.collectionDate === 'string'
  }

  if (value.kind === 'product_detail_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.productId === 'string' &&
      typeof value.collectionDate === 'string'
    )
  }

  if (value.kind === 'backfill_snapshot_fetch') {
    return (
      typeof value.runId === 'string' &&
      typeof value.lenderCode === 'string' &&
      typeof value.seedUrl === 'string' &&
      typeof value.monthCursor === 'string'
    )
  }

  return false
}

function extractRunContext(body: unknown): { runId: string | null; lenderCode: string | null } {
  if (!isObject(body)) {
    return { runId: null, lenderCode: null }
  }

  const runId = typeof body.runId === 'string' ? body.runId : null
  const lenderCode = typeof body.lenderCode === 'string' ? body.lenderCode : null
  return { runId, lenderCode }
}

async function handleDailyLenderJob(env: EnvBindings, job: DailyLenderJob): Promise<void> {
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const sourceUrl = endpoint?.endpointUrl || `pending://cdr-register/${job.lenderCode}`

  await persistRawPayload(env, {
    sourceType: 'cdr_products',
    sourceUrl,
    payload: {
      phase: 'phase1_stub',
      note: 'Daily lender products fetch scaffold only. Full CDR fetch/pagination in Phase 2.',
      lenderCode: job.lenderCode,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      idempotencyKey: job.idempotencyKey,
    },
    httpStatus: 200,
    notes: 'Phase 1 queue scaffold payload.',
  })
}

async function handleProductDetailJob(env: EnvBindings, job: ProductDetailJob): Promise<void> {
  const endpoint = await getCachedEndpoint(env.DB, job.lenderCode)
  const sourceUrl = endpoint?.endpointUrl
    ? `${endpoint.endpointUrl}/products/${encodeURIComponent(job.productId)}`
    : `pending://cdr-register/${job.lenderCode}/products/${encodeURIComponent(job.productId)}`

  await persistRawPayload(env, {
    sourceType: 'cdr_product_detail',
    sourceUrl,
    payload: {
      phase: 'phase1_stub',
      note: 'Product detail fetch scaffold only. Full normalization in Phase 2.',
      lenderCode: job.lenderCode,
      productId: job.productId,
      runId: job.runId,
      collectionDate: job.collectionDate,
      fetchedAt: nowIso(),
      idempotencyKey: job.idempotencyKey,
    },
    httpStatus: 200,
    notes: 'Phase 1 product detail scaffold payload.',
  })
}

async function handleBackfillSnapshotJob(env: EnvBindings, job: BackfillSnapshotJob): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Phase 1 Backfill Stub</title></head><body><h1>Phase 1 Backfill Stub</h1><p>runId=${job.runId}</p><p>lender=${job.lenderCode}</p><p>seed=${job.seedUrl}</p><p>month=${job.monthCursor}</p></body></html>`

  await persistRawPayload(env, {
    sourceType: 'wayback_html',
    sourceUrl: job.seedUrl,
    payload: html,
    httpStatus: 200,
    notes: 'Phase 1 Wayback backfill scaffold payload.',
  })

  const cursorKey = `${job.lenderCode}|${job.monthCursor}|${job.seedUrl}`
  await env.DB.prepare(
    `INSERT INTO backfill_cursors (
      cursor_key,
      run_id,
      lender_code,
      seed_url,
      month_cursor,
      last_snapshot_at,
      updated_at,
      status
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'completed')
    ON CONFLICT(cursor_key) DO UPDATE SET
      run_id = excluded.run_id,
      lender_code = excluded.lender_code,
      seed_url = excluded.seed_url,
      month_cursor = excluded.month_cursor,
      last_snapshot_at = excluded.last_snapshot_at,
      updated_at = excluded.updated_at,
      status = excluded.status`,
  )
    .bind(cursorKey, job.runId, job.lenderCode, job.seedUrl, job.monthCursor, nowIso(), nowIso())
    .run()
}

async function processMessage(env: EnvBindings, message: IngestMessage): Promise<void> {
  if (message.kind === 'daily_lender_fetch') {
    return handleDailyLenderJob(env, message)
  }
  if (message.kind === 'product_detail_fetch') {
    return handleProductDetailJob(env, message)
  }
  if (message.kind === 'backfill_snapshot_fetch') {
    return handleBackfillSnapshotJob(env, message)
  }

  const exhaustive: never = message
  throw new Error(`Unsupported message kind: ${String(exhaustive)}`)
}

export async function consumeIngestQueue(batch: MessageBatch<IngestMessage>, env: EnvBindings): Promise<void> {
  const maxAttempts = parseIntegerEnv(env.MAX_QUEUE_ATTEMPTS, DEFAULT_MAX_QUEUE_ATTEMPTS)

  for (const msg of batch.messages) {
    const attempts = Number(msg.attempts || 1)
    const body = msg.body
    const context = extractRunContext(body)

    try {
      if (!isIngestMessage(body)) {
        throw new Error('invalid_queue_message_shape')
      }

      await processMessage(env, body)

      if (context.runId && context.lenderCode) {
        await recordRunQueueOutcome(env.DB, {
          runId: context.runId,
          lenderCode: context.lenderCode,
          success: true,
        })
      }

      msg.ack()
    } catch (error) {
      const errorMessage = (error as Error)?.message || String(error)

      if (attempts >= maxAttempts) {
        if (context.runId && context.lenderCode) {
          await recordRunQueueOutcome(env.DB, {
            runId: context.runId,
            lenderCode: context.lenderCode,
            success: false,
            errorMessage,
          })
        }
        msg.ack()
        continue
      }

      msg.retry({
        delaySeconds: calculateRetryDelaySeconds(attempts),
      })
    }
  }
}