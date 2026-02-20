import { MELBOURNE_TARGET_HOUR, MELBOURNE_TIMEZONE } from '../constants'
import { triggerDailyRun } from './bootstrap-jobs'
import type { EnvBindings } from '../types'
import { getMelbourneNowParts, parseIntegerEnv } from '../utils/time'

export function shouldRunScheduledAtTargetHour(hour: number, targetHour: number): boolean {
  return hour === targetHour
}

export async function handleScheduledDaily(event: ScheduledController, env: EnvBindings) {
  const timezone = env.MELBOURNE_TIMEZONE || MELBOURNE_TIMEZONE
  const targetHour = parseIntegerEnv(env.MELBOURNE_TARGET_HOUR, MELBOURNE_TARGET_HOUR)
  const melbourneParts = getMelbourneNowParts(new Date(event.scheduledTime), timezone)

  if (!shouldRunScheduledAtTargetHour(melbourneParts.hour, targetHour)) {
    return {
      ok: true,
      skipped: true,
      reason: 'outside_target_hour',
      melbourne: melbourneParts,
    }
  }

  const result = await triggerDailyRun(env, {
    source: 'scheduled',
    force: false,
  })

  return {
    ...result,
    melbourne: melbourneParts,
  }
}
