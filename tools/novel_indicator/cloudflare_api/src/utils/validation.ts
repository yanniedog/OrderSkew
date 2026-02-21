import type { JsonObject, JsonValue } from '../types'

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function looksLikeBar(entry: unknown): boolean {
  if (!isObject(entry)) {
    return false
  }
  return ['timestamp', 'open', 'high', 'low', 'close', 'volume'].every((k) => k in entry)
}

function containsRawOhlcv(value: JsonValue, depth = 0): boolean {
  if (depth > 6) {
    return false
  }
  if (Array.isArray(value)) {
    if (value.length > 200 && value.every(looksLikeBar)) {
      return true
    }
    for (const item of value) {
      if (containsRawOhlcv(item, depth + 1)) {
        return true
      }
    }
    return false
  }
  if (isObject(value)) {
    const keys = Object.keys(value)
    if (keys.includes('open') && keys.includes('high') && keys.includes('low') && keys.includes('close') && keys.includes('volume')) {
      const maybeArrayCount = keys
        .filter((k) => ['open', 'high', 'low', 'close', 'volume', 'timestamp'].includes(k))
        .map((k) => value[k])
        .filter((v) => Array.isArray(v) && v.length > 200).length
      if (maybeArrayCount >= 3) {
        return true
      }
    }
    for (const nested of Object.values(value)) {
      if (containsRawOhlcv(nested as JsonValue, depth + 1)) {
        return true
      }
    }
    return false
  }
  return false
}

export function validateRunPayload(input: unknown): { ok: true; data: JsonObject } | { ok: false; error: string } {
  if (!isObject(input)) {
    return { ok: false, error: 'Payload must be an object.' }
  }
  if (!isObject(input.config)) {
    return { ok: false, error: 'Missing config object.' }
  }
  if (!isObject(input.summary)) {
    return { ok: false, error: 'Missing summary object.' }
  }

  const plots = input.plots
  if (!Array.isArray(plots)) {
    return { ok: false, error: 'Missing plots array.' }
  }
  if (plots.length > 12) {
    return { ok: false, error: 'Too many plots. Maximum is 12.' }
  }

  const cloned = input as JsonObject
  if (containsRawOhlcv(cloned)) {
    return { ok: false, error: 'Raw OHLCV market data is not allowed in server payloads.' }
  }

  const totalSize = JSON.stringify(cloned).length
  if (totalSize > 1_200_000) {
    return { ok: false, error: 'Payload exceeds size limit (1.2MB).' }
  }

  return { ok: true, data: cloned }
}
