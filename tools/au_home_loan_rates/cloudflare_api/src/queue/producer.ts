import type { BackfillSnapshotJob, DailyLenderJob, EnvBindings, IngestMessage, LenderConfig, ProductDetailJob } from '../types'
import {
  buildBackfillIdempotencyKey,
  buildDailyLenderIdempotencyKey,
  buildProductDetailIdempotencyKey,
} from '../utils/idempotency'

type QueueEnv = Pick<EnvBindings, 'INGEST_QUEUE'>

function asQueueBatch(messages: IngestMessage[]) {
  return messages.map((message) => ({ body: message }))
}

export async function enqueueDailyLenderJobs(
  env: QueueEnv,
  input: {
    runId: string
    collectionDate: string
    lenders: LenderConfig[]
  },
): Promise<{ enqueued: number; perLender: Record<string, number> }> {
  const jobs: DailyLenderJob[] = input.lenders.map((lender) => ({
    kind: 'daily_lender_fetch',
    runId: input.runId,
    lenderCode: lender.code,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: buildDailyLenderIdempotencyKey(input.runId, lender.code),
  }))

  if (jobs.length > 0) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(jobs))
  }

  return {
    enqueued: jobs.length,
    perLender: Object.fromEntries(jobs.map((job) => [job.lenderCode, 1])),
  }
}

export async function enqueueProductDetailJobs(
  env: QueueEnv,
  input: {
    runId: string
    lenderCode: string
    collectionDate: string
    productIds: string[]
  },
): Promise<{ enqueued: number }> {
  const productIds = Array.from(new Set(input.productIds)).filter(Boolean)
  const jobs: ProductDetailJob[] = productIds.map((productId) => ({
    kind: 'product_detail_fetch',
    runId: input.runId,
    lenderCode: input.lenderCode,
    productId,
    collectionDate: input.collectionDate,
    attempt: 0,
    idempotencyKey: buildProductDetailIdempotencyKey(input.runId, input.lenderCode, productId),
  }))

  if (jobs.length > 0) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(jobs))
  }

  return {
    enqueued: jobs.length,
  }
}

export async function enqueueBackfillJobs(
  env: QueueEnv,
  input: {
    runId: string
    jobs: Array<{ lenderCode: string; seedUrl: string; monthCursor: string }>
  },
): Promise<{ enqueued: number; perLender: Record<string, number> }> {
  const jobs: BackfillSnapshotJob[] = input.jobs.map((job) => ({
    kind: 'backfill_snapshot_fetch',
    runId: input.runId,
    lenderCode: job.lenderCode,
    seedUrl: job.seedUrl,
    monthCursor: job.monthCursor,
    attempt: 0,
    idempotencyKey: buildBackfillIdempotencyKey(input.runId, job.lenderCode, job.seedUrl, job.monthCursor),
  }))

  if (jobs.length > 0) {
    await env.INGEST_QUEUE.sendBatch(asQueueBatch(jobs))
  }

  const perLender: Record<string, number> = {}
  for (const job of jobs) {
    perLender[job.lenderCode] = (perLender[job.lenderCode] || 0) + 1
  }

  return {
    enqueued: jobs.length,
    perLender,
  }
}