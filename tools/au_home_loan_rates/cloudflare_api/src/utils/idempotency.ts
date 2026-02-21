import type { SourceType } from '../types'

function normalizeKeyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

export function buildDailyRunId(collectionDate: string): string {
  return `daily:${collectionDate}`
}

export function buildBackfillRunId(monthCursor: string): string {
  return `backfill:${monthCursor}:${crypto.randomUUID()}`
}

export function buildRunLockKey(runType: 'daily' | 'backfill', dateOrMonth: string): string {
  return `${runType}:${dateOrMonth}`
}

export function buildDailyLenderIdempotencyKey(runId: string, lenderCode: string): string {
  return `daily:${normalizeKeyPart(runId)}:${normalizeKeyPart(lenderCode)}`
}

export function buildProductDetailIdempotencyKey(runId: string, lenderCode: string, productId: string): string {
  return `product:${normalizeKeyPart(runId)}:${normalizeKeyPart(lenderCode)}:${normalizeKeyPart(productId)}`
}

export function buildBackfillIdempotencyKey(runId: string, lenderCode: string, seedUrl: string, monthCursor: string): string {
  return [
    'backfill',
    normalizeKeyPart(runId),
    normalizeKeyPart(lenderCode),
    normalizeKeyPart(seedUrl),
    normalizeKeyPart(monthCursor),
  ].join(':')
}

function extensionForSource(sourceType: SourceType): string {
  return sourceType === 'wayback_html' ? 'html' : 'json'
}

export function buildRawR2Key(sourceType: SourceType, fetchedAtIso: string, contentHash: string): string {
  const [datePart] = fetchedAtIso.split('T')
  const [year, month = '00', day = '00'] = (datePart || '1970-01-01').split('-')
  const ext = extensionForSource(sourceType)
  return `raw/${sourceType}/${year}/${month}/${day}/${contentHash}.${ext}`
}