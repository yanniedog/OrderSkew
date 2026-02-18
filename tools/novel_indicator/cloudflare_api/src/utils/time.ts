export function nowIso(): string {
  return new Date().toISOString()
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export function isExpired(isoTs: string): boolean {
  return Date.parse(isoTs) <= Date.now()
}
