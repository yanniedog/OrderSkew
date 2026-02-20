import type { JWTPayload } from 'jose'

export type RunType = 'daily' | 'backfill'
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed'

export type SourceType = 'cdr_register' | 'cdr_products' | 'cdr_product_detail' | 'wayback_html'

export type SecurityPurpose = 'owner_occupied' | 'investment'
export type RepaymentType = 'principal_and_interest' | 'interest_only'
export type RateStructure = 'variable' | 'fixed_1yr' | 'fixed_2yr' | 'fixed_3yr' | 'fixed_4yr' | 'fixed_5yr'
export type LvrTier = 'lvr_=60%' | 'lvr_60-70%' | 'lvr_70-80%' | 'lvr_80-85%' | 'lvr_85-90%' | 'lvr_90-95%'
export type FeatureSet = 'basic' | 'premium'

export type AdminAuthMode = 'bearer' | 'access'

export type AdminAuthState = {
  ok: boolean
  mode: AdminAuthMode | null
  reason?: string
  subject?: string
  jwtPayload?: JWTPayload
}

export type DailyLenderJob = {
  kind: 'daily_lender_fetch'
  runId: string
  lenderCode: string
  collectionDate: string
  attempt: number
  idempotencyKey: string
}

export type ProductDetailJob = {
  kind: 'product_detail_fetch'
  runId: string
  lenderCode: string
  productId: string
  collectionDate: string
  attempt: number
  idempotencyKey: string
}

export type BackfillSnapshotJob = {
  kind: 'backfill_snapshot_fetch'
  runId: string
  lenderCode: string
  seedUrl: string
  monthCursor: string
  attempt: number
  idempotencyKey: string
}

export type IngestMessage = DailyLenderJob | ProductDetailJob | BackfillSnapshotJob

export type LenderConfig = {
  code: string
  name: string
  canonical_bank_name: string
  register_brand_name: string
  seed_rate_urls: string[]
}

export type LenderConfigFile = {
  version: number
  generated_at: string
  lenders: LenderConfig[]
}

export type RunReportRow = {
  run_id: string
  run_type: RunType
  started_at: string
  finished_at: string | null
  status: RunStatus
  per_lender_json: string
  errors_json: string
}

export type EnvBindings = {
  DB: D1Database
  RAW_BUCKET: R2Bucket
  INGEST_QUEUE: Queue<IngestMessage>
  RUN_LOCK_DO: DurableObjectNamespace
  ADMIN_API_TOKEN?: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  WORKER_VERSION?: string
  PUBLIC_API_BASE_PATH?: string
  MELBOURNE_TIMEZONE?: string
  MELBOURNE_TARGET_HOUR?: string
  LOCK_TTL_SECONDS?: string
  MAX_QUEUE_ATTEMPTS?: string
  FEATURE_PROSPECTIVE_ENABLED?: string
  FEATURE_BACKFILL_ENABLED?: string
}

export type AppContext = {
  Bindings: EnvBindings
  Variables: {
    adminAuthState?: AdminAuthState
  }
}

export type MelbourneParts = {
  date: string
  hour: number
  minute: number
  second: number
  timeZone: string
  iso: string
}