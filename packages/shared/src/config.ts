export type AppJsonConfig = {
  name: string
  publicApiBase: string
  features: {
    health: boolean
    version: boolean
  }
}

export function readStringEnv(value: string | undefined, fallback: string): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

export function readBoolEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function loadAppConfig<TEnv extends Record<string, unknown>>(
  env: TEnv,
  jsonConfig: AppJsonConfig,
): {
  appName: string
  appEnv: string
  appVersion: string
  publicApiBase: string
  features: AppJsonConfig['features']
  logLevel: string
} {
  const envObj = env as Record<string, string | undefined>

  return {
    appName: jsonConfig.name,
    appEnv: readStringEnv(envObj.APP_ENV, 'dev'),
    appVersion: readStringEnv(envObj.APP_VERSION, 'dev'),
    publicApiBase: readStringEnv(envObj.PUBLIC_API_BASE, jsonConfig.publicApiBase),
    features: {
      health: readBoolEnv(envObj.FEATURE_HEALTH, jsonConfig.features.health),
      version: readBoolEnv(envObj.FEATURE_VERSION, jsonConfig.features.version),
    },
    logLevel: readStringEnv(envObj.LOG_LEVEL, 'info'),
  }
}