const limiterStore = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const current = limiterStore.get(key)
  if (!current || current.resetAt <= now) {
    limiterStore.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (current.count >= limit) {
    return false
  }
  current.count += 1
  limiterStore.set(key, current)
  return true
}
