import { describe, expect, it } from 'vitest'
import appJson from '../config/app.json'
import { loadAppConfig } from '../../../packages/shared/src/config'

describe('loadAppConfig', () => {
  it('loads config from env + json defaults', () => {
    const cfg = loadAppConfig(
      {
        APP_ENV: 'production',
        APP_VERSION: '1.2.3',
      },
      appJson,
    )

    expect(cfg.appEnv).toBe('production')
    expect(cfg.appVersion).toBe('1.2.3')
    expect(cfg.publicApiBase).toBe('/api')
    expect(cfg.features.health).toBe(true)
  })
})