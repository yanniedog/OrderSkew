export type Bindings = {
  DB: D1Database
  RAW_BUCKET: R2Bucket
  INGEST_QUEUE: Queue<Record<string, unknown>>
  COORDINATOR_DO: DurableObjectNamespace
  APP_ENV?: string
  APP_VERSION?: string
  PUBLIC_API_BASE?: string
  FEATURE_HEALTH?: string
  FEATURE_VERSION?: string
  LOG_LEVEL?: string
}

export type Variables = {
  requestId: string
  startedAt: number
}

export type AppCtx = {
  Bindings: Bindings
  Variables: Variables
}