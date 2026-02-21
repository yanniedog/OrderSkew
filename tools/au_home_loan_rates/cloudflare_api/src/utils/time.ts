import type { MelbourneParts } from '../types'
import { MELBOURNE_TIMEZONE } from '../constants'

function parseIntlParts(date: Date, timeZone: string): MelbourneParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const raw = formatter.formatToParts(date)
  const mapped = Object.fromEntries(raw.map((part) => [part.type, part.value])) as Record<string, string>

  return {
    date: `${mapped.year}-${mapped.month}-${mapped.day}`,
    hour: Number(mapped.hour),
    minute: Number(mapped.minute),
    second: Number(mapped.second),
    timeZone,
    iso: date.toISOString(),
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function getMelbourneNowParts(date = new Date(), timeZone = MELBOURNE_TIMEZONE): MelbourneParts {
  return parseIntlParts(date, timeZone)
}

export function parseIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function currentMonthCursor(parts: MelbourneParts): string {
  return parts.date.slice(0, 7)
}