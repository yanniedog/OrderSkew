import {
  DEFAULT_LOCK_TTL_SECONDS,
  MELBOURNE_TIMEZONE,
  TARGET_LENDERS,
} from '../constants'
import { refreshEndpointCacheStub } from '../db/endpoint-cache'
import {
  buildInitialPerLenderSummary,
  createRunReport,
  markRunFailed,
  setRunEnqueuedSummary,
} from '../db/run-reports'
import { acquireRunLock, releaseRunLock } from '../durable/run-lock'
import { enqueueBackfillJobs, enqueueDailyLenderJobs } from '../queue/producer'
import type { EnvBindings, LenderConfig } from '../types'
import { buildBackfillRunId, buildDailyRunId, buildRunLockKey } from '../utils/idempotency'
import { currentMonthCursor, getMelbourneNowParts, parseIntegerEnv } from '../utils/time'

type DailyRunOptions = {
  source: 'scheduled' | 'manual'
  force?: boolean
}

type BackfillRunRequest = {
  lenderCodes?: string[]
  monthCursor?: string
  maxSnapshotsPerMonth?: number
}

function filterLenders(codes?: string[]): LenderConfig[] {
  if (!codes || codes.length === 0) {
    return TARGET_LENDERS
  }
  const selected = new Set(codes.map((code) => code.toLowerCase().trim()))
  return TARGET_LENDERS.filter((lender) => selected.has(lender.code.toLowerCase()))
}

function isMonthCursor(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value)
}

export async function triggerDailyRun(env: EnvBindings, options: DailyRunOptions) {
  const melbourneParts = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
  const collectionDate = melbourneParts.date
  const baseRunId = buildDailyRunId(collectionDate)
  const runId = options.force ? `${baseRunId}:force:${crypto.randomUUID()}` : baseRunId

  const lockKey = buildRunLockKey('daily', collectionDate)
  const lockTtlSeconds = parseIntegerEnv(env.LOCK_TTL_SECONDS, DEFAULT_LOCK_TTL_SECONDS)

  let lockAcquired = false
  if (!options.force) {
    const lock = await acquireRunLock(env, {
      key: lockKey,
      owner: runId,
      ttlSeconds: lockTtlSeconds,
    })

    if (!lock.ok) {
      return {
        ok: false,
        skipped: true,
        reason: lock.reason || 'lock_unavailable',
        runId,
        collectionDate,
      }
    }

    if (!lock.acquired) {
      return {
        ok: true,
        skipped: true,
        reason: 'daily_run_locked',
        runId,
        collectionDate,
      }
    }

    lockAcquired = true
  }

  const created = await createRunReport(env.DB, {
    runId,
    runType: 'daily',
  })

  if (!created.created && !options.force) {
    if (lockAcquired) {
      await releaseRunLock(env, { key: lockKey, owner: runId })
    }

    return {
      ok: true,
      skipped: true,
      reason: 'run_already_exists',
      runId,
      collectionDate,
    }
  }

  try {
    await refreshEndpointCacheStub(env.DB, TARGET_LENDERS)

    const enqueue = await enqueueDailyLenderJobs(env, {
      runId,
      collectionDate,
      lenders: TARGET_LENDERS,
    })

    const summary = buildInitialPerLenderSummary(enqueue.perLender)
    await setRunEnqueuedSummary(env.DB, runId, summary)

    return {
      ok: true,
      skipped: false,
      runId,
      collectionDate,
      enqueued: enqueue.enqueued,
      source: options.source,
    }
  } catch (error) {
    await markRunFailed(env.DB, runId, `daily_run_enqueue_failed: ${(error as Error)?.message || String(error)}`)
    throw error
  }
}

export async function triggerBackfillRun(env: EnvBindings, input: BackfillRunRequest) {
  const melbourneParts = getMelbourneNowParts(new Date(), env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE)
  const monthCursor = isMonthCursor(input.monthCursor) ? input.monthCursor : currentMonthCursor(melbourneParts)
  const maxSnapshotsPerMonth = Math.min(3, Math.max(1, Number(input.maxSnapshotsPerMonth) || 3))

  const lenders = filterLenders(input.lenderCodes)
  const runId = buildBackfillRunId(monthCursor)

  await createRunReport(env.DB, {
    runId,
    runType: 'backfill',
  })

  const jobs: Array<{ lenderCode: string; seedUrl: string; monthCursor: string }> = []
  for (const lender of lenders) {
    for (const seedUrl of lender.seed_rate_urls.slice(0, maxSnapshotsPerMonth)) {
      jobs.push({
        lenderCode: lender.code,
        seedUrl,
        monthCursor,
      })
    }
  }

  try {
    const enqueue = await enqueueBackfillJobs(env, {
      runId,
      jobs,
    })

    await setRunEnqueuedSummary(env.DB, runId, buildInitialPerLenderSummary(enqueue.perLender))

    return {
      ok: true,
      runId,
      monthCursor,
      selectedLenders: lenders.map((l) => l.code),
      maxSnapshotsPerMonth,
      enqueued: enqueue.enqueued,
    }
  } catch (error) {
    await markRunFailed(env.DB, runId, `backfill_enqueue_failed: ${(error as Error)?.message || String(error)}`)
    throw error
  }
}