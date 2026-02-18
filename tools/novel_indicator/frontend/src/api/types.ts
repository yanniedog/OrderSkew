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

export type SeedMode = 'auto' | 'manual'
export type PerformanceProfile = 'fast' | 'balanced' | 'deep'

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

export interface HorizonConfig {
  min_bar: number
  max_bar: number
  coarse_step: number
  refine_radius: number
}

export interface SearchConfig {
  candidate_pool_size: number
  stage_a_keep: number
  stage_b_keep: number
  tuning_trials: number
  max_combo_size: number
  novelty_similarity_threshold: number
  collinearity_threshold: number
  min_novelty_score: number
}

export interface ValidationConfig {
  folds: number
  embargo_bars: number
  purge_bars: number
  search_split: number
  model_select_split: number
  holdout_split: number
  baseline_margin: number
}

export interface ObjectiveWeights {
  rmse: number
  mae: number
  calibration: number
  directional: number
}

export interface AdvancedRunConfig {
  horizon: HorizonConfig
  search: SearchConfig
  validation: ValidationConfig
  objective_weights: ObjectiveWeights
  performance_profile: PerformanceProfile
}

export interface RunConfig {
  top_n_symbols: number
  timeframes: string[]
  budget_minutes: number
  seed_mode?: SeedMode
  random_seed?: number
  advanced?: AdvancedRunConfig
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
  calibration_error?: number
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
  best_horizon_ms?: number
  best_horizon_label?: string
  indicator_combo: IndicatorSpec[]
  score: ScoreCard
}

export interface ValidationReport {
  leakage_checks_passed: boolean
  leakage_sentinel_triggered: boolean
  holdout_rows: number
  holdout_pass_ratio: number
  baseline_rejection_rate: number
  warnings: string[]
}

export interface HorizonMetadata {
  timeframe_ms: Record<string, number>
  note: string
}

export interface FrontierEntry {
  symbol: string
  timeframe: string
  indicator_id: string
  expression: string
  family: string
  complexity: number
  novelty_score: number
  best_horizon: number
  best_horizon_ms: number
  score: ScoreCard
}

export interface IndicatorCubeRow {
  symbol: string
  timeframe: string
  indicator_id: string
  expression: string
  family: string
  complexity: number
  novelty_score: number
  horizon_bar: number
  horizon_time_ms: number
  normalized_rmse: number
  normalized_mae: number
  calibration_error: number
  composite_error: number
  directional_hit_rate: number
  pnl_total: number
  max_drawdown: number
  turnover: number
  stability_score: number
  selected_metric_rank?: number
}

export interface ResultSummary {
  schema_version?: string
  run_id: string
  universal_recommendation: AssetRecommendation
  per_asset_recommendations: AssetRecommendation[]
  validation_report?: ValidationReport
  horizon_metadata?: HorizonMetadata
  per_indicator_frontier?: FrontierEntry[]
  indicator_cube?: IndicatorCubeRow[]
  generated_at: string
}

export interface PlotPayload {
  schema_version?: string
  run_id: string
  plot_id: string
  title: string
  payload: {
    [k: string]: unknown
  }
}

export interface PlotOptions {
  horizon_minutes?: number
  metric?: 'composite_error' | 'directional_hit_rate' | 'pnl_total' | 'calibration_error'
  min_novelty?: number
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
