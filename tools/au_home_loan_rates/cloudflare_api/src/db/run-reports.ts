import type { RunReportRow, RunStatus, RunType } from '../types'
import { nowIso } from '../utils/time'

type LenderProgress = {
  enqueued: number
  processed: number
  failed: number
  last_error?: string
  updated_at: string
}

type PerLenderSummary = {
  _meta: {
    enqueued_total: number
    processed_total: number
    failed_total: number
    updated_at: string
  }
  [lenderCode: string]: unknown
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function asPerLenderSummary(input: unknown): PerLenderSummary {
  const now = nowIso()
  if (!input || typeof input !== 'object') {
    return {
      _meta: {
        enqueued_total: 0,
        processed_total: 0,
        failed_total: 0,
        updated_at: now,
      },
    }
  }

  const raw = input as Record<string, unknown>
  const rawMeta = (raw._meta as Record<string, unknown> | undefined) || {}

  return {
    ...raw,
    _meta: {
      enqueued_total: Number(rawMeta.enqueued_total) || 0,
      processed_total: Number(rawMeta.processed_total) || 0,
      failed_total: Number(rawMeta.failed_total) || 0,
      updated_at: String(rawMeta.updated_at || now),
    },
  }
}

function asLenderProgress(input: unknown): LenderProgress {
  const now = nowIso()
  if (!input || typeof input !== 'object') {
    return {
      enqueued: 0,
      processed: 0,
      failed: 0,
      updated_at: now,
    }
  }
  const raw = input as Record<string, unknown>
  return {
    enqueued: Number(raw.enqueued) || 0,
    processed: Number(raw.processed) || 0,
    failed: Number(raw.failed) || 0,
    last_error: raw.last_error == null ? undefined : String(raw.last_error),
    updated_at: String(raw.updated_at || now),
  }
}

export function buildInitialPerLenderSummary(perLenderEnqueued: Record<string, number>): PerLenderSummary {
  const now = nowIso()
  const entries = Object.entries(perLenderEnqueued)
  const summary: PerLenderSummary = {
    _meta: {
      enqueued_total: entries.reduce((sum, [, count]) => sum + count, 0),
      processed_total: 0,
      failed_total: 0,
      updated_at: now,
    },
  }

  for (const [lenderCode, count] of entries) {
    summary[lenderCode] = {
      enqueued: count,
      processed: 0,
      failed: 0,
      updated_at: now,
    } satisfies LenderProgress
  }

  return summary
}

export async function getRunReport(db: D1Database, runId: string): Promise<RunReportRow | null> {
  const row = await db
    .prepare(
      `SELECT run_id, run_type, started_at, finished_at, status, per_lender_json, errors_json
       FROM run_reports
       WHERE run_id = ?1`,
    )
    .bind(runId)
    .first<RunReportRow>()

  return row ?? null
}

export async function listRunReports(db: D1Database, limit = 25): Promise<RunReportRow[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
  const rows = await db
    .prepare(
      `SELECT run_id, run_type, started_at, finished_at, status, per_lender_json, errors_json
       FROM run_reports
       ORDER BY started_at DESC
       LIMIT ?1`,
    )
    .bind(safeLimit)
    .all<RunReportRow>()

  return rows.results ?? []
}

export async function createRunReport(
  db: D1Database,
  input: {
    runId: string
    runType: RunType
    startedAt?: string
    perLenderSummary?: Record<string, unknown>
  },
): Promise<{ created: boolean; row: RunReportRow }> {
  const startedAt = input.startedAt || nowIso()
  const perLenderJson = JSON.stringify(
    asPerLenderSummary(input.perLenderSummary || {
      _meta: {
        enqueued_total: 0,
        processed_total: 0,
        failed_total: 0,
        updated_at: startedAt,
      },
    }),
  )

  const insert = await db
    .prepare(
      `INSERT INTO run_reports (run_id, run_type, started_at, status, per_lender_json, errors_json)
       VALUES (?1, ?2, ?3, 'running', ?4, '[]')
       ON CONFLICT(run_id) DO NOTHING`,
    )
    .bind(input.runId, input.runType, startedAt, perLenderJson)
    .run()

  const row = await getRunReport(db, input.runId)
  if (!row) {
    throw new Error(`Failed to load run report after create: ${input.runId}`)
  }

  return {
    created: Number(insert.meta?.changes || 0) > 0,
    row,
  }
}

export async function setRunEnqueuedSummary(
  db: D1Database,
  runId: string,
  perLenderSummary: Record<string, unknown>,
): Promise<RunReportRow | null> {
  const summary = asPerLenderSummary(perLenderSummary)
  summary._meta.updated_at = nowIso()

  await db
    .prepare(
      `UPDATE run_reports
       SET per_lender_json = ?1,
           status = 'running',
           finished_at = NULL
       WHERE run_id = ?2`,
    )
    .bind(JSON.stringify(summary), runId)
    .run()

  return getRunReport(db, runId)
}

export async function markRunFailed(db: D1Database, runId: string, errorMessage: string): Promise<RunReportRow | null> {
  const row = await getRunReport(db, runId)
  if (!row) {
    return null
  }

  const errors = parseJson<string[]>(row.errors_json, [])
  errors.push(`[${nowIso()}] ${errorMessage}`)

  await db
    .prepare(
      `UPDATE run_reports
       SET status = 'failed',
           finished_at = ?1,
           errors_json = ?2
       WHERE run_id = ?3`,
    )
    .bind(nowIso(), JSON.stringify(errors.slice(-200)), runId)
    .run()

  return getRunReport(db, runId)
}

export async function recordRunQueueOutcome(
  db: D1Database,
  input: { runId: string; lenderCode: string; success: boolean; errorMessage?: string },
): Promise<RunReportRow | null> {
  const row = await getRunReport(db, input.runId)
  if (!row) {
    return null
  }

  const summary = asPerLenderSummary(parseJson<Record<string, unknown>>(row.per_lender_json, {}))
  const errors = parseJson<string[]>(row.errors_json, [])
  const now = nowIso()

  const lenderCode = input.lenderCode || '_unknown'
  const progress = asLenderProgress(summary[lenderCode])

  if (input.success) {
    progress.processed += 1
    summary._meta.processed_total += 1
  } else {
    progress.failed += 1
    summary._meta.failed_total += 1
    if (input.errorMessage) {
      progress.last_error = input.errorMessage
      errors.push(`[${now}] ${lenderCode}: ${input.errorMessage}`)
    }
  }

  progress.updated_at = now
  summary[lenderCode] = progress
  summary._meta.updated_at = now

  const completedTotal = summary._meta.processed_total + summary._meta.failed_total
  const enqueuedTotal = summary._meta.enqueued_total

  let nextStatus = row.status as RunStatus
  let finishedAt: string | null = row.finished_at

  if (enqueuedTotal > 0 && completedTotal >= enqueuedTotal) {
    nextStatus = summary._meta.failed_total > 0 ? 'partial' : 'ok'
    finishedAt = now
  } else if (!input.success && enqueuedTotal === 0) {
    nextStatus = 'partial'
  }

  await db
    .prepare(
      `UPDATE run_reports
       SET per_lender_json = ?1,
           errors_json = ?2,
           status = ?3,
           finished_at = ?4
       WHERE run_id = ?5`,
    )
    .bind(JSON.stringify(summary), JSON.stringify(errors.slice(-200)), nextStatus, finishedAt, input.runId)
    .run()

  return getRunReport(db, input.runId)
}