/**
 * Constants and config helpers for the Novel Indicator App page.
 */

import type { AdvancedRunConfig, RunConfig } from '../api/types'

export const PLOTS = [
  'indicator_horizon_heatmap',
  'horizon_slice_table',
  'forecast_overlay',
  'indicator_horizon_profile',
  'calibration_curve',
  'stability_folds',
  'novelty_pareto',
  'formula_inspector',
  'leaderboard',
] as const

export const TIMEFRAME_OPTIONS = ['5m', '1h', '4h'] as const

export const DEFAULT_ADVANCED: AdvancedRunConfig = {
  performance_profile: 'fast',
  horizon: {
    min_bar: 3,
    max_bar: 180,
    coarse_step: 12,
    refine_radius: 8,
  },
  search: {
    candidate_pool_size: 140,
    stage_a_keep: 60,
    stage_b_keep: 20,
    tuning_trials: 4,
    max_combo_size: 3,
    novelty_similarity_threshold: 0.8,
    collinearity_threshold: 0.92,
    min_novelty_score: 0.2,
  },
  validation: {
    folds: 4,
    embargo_bars: 8,
    purge_bars: 8,
    search_split: 0.58,
    model_select_split: 0.22,
    holdout_split: 0.2,
    baseline_margin: 0.015,
  },
  objective_weights: {
    rmse: 0.37,
    mae: 0.3,
    calibration: 0.18,
    directional: 0.15,
  },
}

export const PRESET_CONFIGS = {
  fast: {
    top_n_symbols: 4,
    timeframes: ['5m', '1h'],
    budget_minutes: 8,
    seed_mode: 'auto',
    random_seed: 42,
    advanced: {
      ...DEFAULT_ADVANCED,
      performance_profile: 'fast',
    },
  },
  balanced: {
    top_n_symbols: 6,
    timeframes: ['5m', '1h', '4h'],
    budget_minutes: 24,
    seed_mode: 'auto',
    random_seed: 42,
    advanced: {
      ...DEFAULT_ADVANCED,
      performance_profile: 'balanced',
      search: {
        ...DEFAULT_ADVANCED.search,
        candidate_pool_size: 200,
        stage_a_keep: 90,
        stage_b_keep: 30,
      },
    },
  },
  deep: {
    top_n_symbols: 10,
    timeframes: ['5m', '1h', '4h'],
    budget_minutes: 75,
    seed_mode: 'auto',
    random_seed: 42,
    advanced: {
      ...DEFAULT_ADVANCED,
      performance_profile: 'deep',
      horizon: {
        ...DEFAULT_ADVANCED.horizon,
        max_bar: 260,
      },
      search: {
        ...DEFAULT_ADVANCED.search,
        candidate_pool_size: 280,
        stage_a_keep: 140,
        stage_b_keep: 50,
        tuning_trials: 8,
      },
    },
  },
} as const satisfies Record<string, RunConfig>

export type PresetKey = keyof typeof PRESET_CONFIGS | 'custom'

export const LOCAL_PREFS_KEY = 'novel_indicator_local_prefs_v2'

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function cloneConfig(config: RunConfig): RunConfig {
  return JSON.parse(JSON.stringify(config)) as RunConfig
}

export function withDefaults(input?: Partial<RunConfig>): RunConfig {
  const base = cloneConfig(PRESET_CONFIGS.fast)
  const merged: RunConfig = {
    ...base,
    ...input,
    seed_mode: input?.seed_mode === 'manual' ? 'manual' : 'auto',
    random_seed: clampInt(Number(input?.random_seed ?? base.random_seed ?? 42), 1, 1_000_000),
    top_n_symbols: clampInt(Number(input?.top_n_symbols ?? base.top_n_symbols), 1, 30),
    budget_minutes: clampInt(Number(input?.budget_minutes ?? base.budget_minutes), 5, 240),
    timeframes: Array.isArray(input?.timeframes)
      ? TIMEFRAME_OPTIONS.filter((tf) => (input?.timeframes ?? []).includes(tf))
      : base.timeframes,
    advanced: {
      ...DEFAULT_ADVANCED,
      ...(input?.advanced ?? {}),
      horizon: {
        ...DEFAULT_ADVANCED.horizon,
        ...(input?.advanced?.horizon ?? {}),
      },
      search: {
        ...DEFAULT_ADVANCED.search,
        ...(input?.advanced?.search ?? {}),
      },
      validation: {
        ...DEFAULT_ADVANCED.validation,
        ...(input?.advanced?.validation ?? {}),
      },
      objective_weights: {
        ...DEFAULT_ADVANCED.objective_weights,
        ...(input?.advanced?.objective_weights ?? {}),
      },
    },
  }
  if (!merged.timeframes.length) merged.timeframes = ['5m']
  return merged
}
