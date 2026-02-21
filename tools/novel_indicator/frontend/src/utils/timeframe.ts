export const TIMEFRAME_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
}

export function timeframeToMs(timeframe: string): number {
  return TIMEFRAME_MS[timeframe] ?? 60 * 1000
}

export function barsToMs(timeframe: string, bars: number): number {
  return Math.max(0, Math.round(bars) * timeframeToMs(timeframe))
}

export function minutesToBars(timeframe: string, minutes: number): number {
  const ms = Math.max(1, Math.round(minutes * 60 * 1000))
  const tf = timeframeToMs(timeframe)
  return Math.max(1, Math.round(ms / tf))
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = totalMinutes / 60
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`
  }
  const days = hours / 24
  const roundedDays = Math.round(days * 10) / 10
  return `${roundedDays % 1 === 0 ? roundedDays.toFixed(0) : roundedDays.toFixed(1)}d`
}

export function horizonLabel(timeframe: string, bars: number): string {
  const ms = barsToMs(timeframe, bars)
  return `${bars} bars (${formatDurationMs(ms)} @ ${timeframe})`
}
