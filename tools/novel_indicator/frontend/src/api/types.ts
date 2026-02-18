export type RunStatusEnum = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
export type RunStageEnum =
  | 'created'
  | 'universe'
  | 'ingest'
  | 'discovery'
  | 'optimization'
  | 'ranking'
  | 'backtest'
  | 'artifacts'
  | 'finished'

export interface RunStageLog {
  timestamp: string
  stage: RunStageEnum
  message: string
}

export interface RunStatus {
  run_id: string
  status: RunStatusEnum
  stage: RunStageEnum
  progress: number
  created_at: string
  updated_at: string
  config_hash: string
  error?: string | null
  logs: RunStageLog[]
}

export interface RunConfig {
  top_n_symbols: number
  timeframes: string[]
  budget_minutes: number
  random_seed: number
}

export interface RunCreated {
  run_id: string
  status: RunStatusEnum
  created_at: string
}

export interface IndicatorSpec {
  indicator_id: string
  expression: string
  complexity: number
  params: Record<string, unknown>
}

export interface ScoreCard {
  normalized_rmse: number
  normalized_mae: number
  composite_error: number
  directional_hit_rate: number
  pnl_total: number
  max_drawdown: number
  turnover: number
  stability_score: number
}

export interface AssetRecommendation {
  symbol: string
  timeframe: string
  best_horizon: number
  indicator_combo: IndicatorSpec[]
  score: ScoreCard
}

export interface ResultSummary {
  run_id: string
  universal_recommendation: AssetRecommendation
  per_asset_recommendations: AssetRecommendation[]
  generated_at: string
}

export interface PlotPayload {
  run_id: string
  plot_id: string
  title: string
  payload: {
    [k: string]: unknown
  }
}

export interface TelemetrySnapshot {
  ts: string
  stage: string
  working_on: string
  achieved: string
  remaining: string
  overall_progress: number
  stage_progress: number
  run_elapsed_sec: number
  stage_elapsed_sec: number
  eta_total_sec?: number | null
  eta_stage_sec?: number | null
  rate_units_per_sec: number
  logical_cores?: number | null
  device_memory_gb?: number | null
  js_heap_used_mb?: number | null
  js_heap_limit_mb?: number | null
  js_heap_percent?: number | null
  worker_busy_ratio?: number | null
  storage_used_mb?: number | null
}

export interface TelemetryFeed {
  run_id: string
  snapshots: TelemetrySnapshot[]
}

export interface BinanceCallDiagnostic {
  ts: string
  endpoint: string
  status: number
  headers: Record<string, string>
}

export interface BinanceDiagnosticsFeed {
  run_id: string
  calls: BinanceCallDiagnostic[]
}

export interface HealthResponse {
  status: string
}

export interface AuthUser {
  id: string
  username: string
  email: string
  display_name?: string | null
  email_verified: boolean
}

export interface SessionInfo {
  user: AuthUser
  csrf_token: string | null
}

export interface UserPreferences {
  top_n_symbols?: number
  timeframes?: string[]
  budget_minutes?: number
  random_seed?: number
  ecoMode?: boolean
  [k: string]: unknown
}

export interface StoredRunSummary {
  run_id: string
  source_version: string
  sync_state: string
  retained_at: string
  created_at: string
  updated_at: string
  summary: ResultSummary
}

export interface StoredRunDetail {
  summary: {
    run_id: string
    source_version: string
    sync_state: string
    retained_at: string
    created_at: string
    updated_at: string
    config: RunConfig
    summary: ResultSummary
  }
  plots: Array<{ plot_id: string; payload: Record<string, unknown> }>
}
