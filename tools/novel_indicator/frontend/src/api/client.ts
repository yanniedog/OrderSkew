import type {
  HealthResponse,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunCreated,
  RunStatus,
  TelemetryFeed,
} from './types'

const LOOPBACK_API_BASE = 'http://127.0.0.1:8000/api'
const API_BASE_STORAGE_KEY = 'novelIndicatorApiBase'
const DEFAULT_TIMEOUT_MS = 15_000

export type RequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  retries?: number
}

function normalizeApiBase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return LOOPBACK_API_BASE
  }
  return trimmed.replace(/\/+$/, '')
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function storageGet(key: string): string | null {
  try {
    if (typeof window === 'undefined') {
      return null
    }
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(key, value)
  } catch {
    // no-op for unavailable storage contexts
  }
}

function resolveApiBase(): string {
  const envValue = import.meta.env.VITE_API_BASE
  if (envValue && envValue.trim()) {
    return normalizeApiBase(envValue)
  }

  if (typeof window !== 'undefined') {
    const queryApi = new URLSearchParams(window.location.search).get('api')
    if (queryApi && queryApi.trim()) {
      const normalized = normalizeApiBase(queryApi)
      storageSet(API_BASE_STORAGE_KEY, normalized)
      return normalized
    }

    const stored = storageGet(API_BASE_STORAGE_KEY)
    if (stored && stored.trim()) {
      return normalizeApiBase(stored)
    }

    if (isLocalHost(window.location.hostname)) {
      return '/api'
    }
  }

  return LOOPBACK_API_BASE
}

let apiBase = resolveApiBase()

export function getApiBase(): string {
  return apiBase
}

export function setApiBase(nextBase: string): string {
  apiBase = normalizeApiBase(nextBase)
  storageSet(API_BASE_STORAGE_KEY, apiBase)
  return apiBase
}

export function resetApiBaseToDefault(): string {
  apiBase = LOOPBACK_API_BASE
  storageSet(API_BASE_STORAGE_KEY, apiBase)
  return apiBase
}

function toApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${apiBase}${normalizedPath}`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function apiFetch(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const retryCount = Math.max(0, options.retries ?? (method === 'GET' ? 1 : 0))
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const url = toApiUrl(path)

  let lastError: unknown
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController()
    const upstreamSignal = options.signal
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const onAbort = () => controller.abort()
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort()
      } else {
        upstreamSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const transient = response.status === 429 || (response.status >= 500 && response.status <= 599)
      if (transient && attempt < retryCount) {
        await wait(300 * (attempt + 1))
        continue
      }
      return response
    } catch (error) {
      lastError = error
      if (isAbortError(error) && !timedOut) {
        throw error
      }
      if (attempt < retryCount) {
        await wait(300 * (attempt + 1))
        continue
      }
      if (timedOut) {
        throw new Error(`Local compute request timed out after ${timeoutMs}ms (${url}).`)
      }
    } finally {
      window.clearTimeout(timeoutId)
      if (upstreamSignal) {
        upstreamSignal.removeEventListener('abort', onAbort)
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(
    `Cannot reach compute engine at ${apiBase}. Start the local backend on your PC (127.0.0.1:8000). ${reason}`.trim(),
  )
}

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export async function getHealth(options: RequestOptions = {}): Promise<HealthResponse> {
  const response = await apiFetch('/health', { method: 'GET' }, { ...options, retries: options.retries ?? 0, timeoutMs: options.timeoutMs ?? 3_000 })
  return asJson<HealthResponse>(response)
}

export async function createRun(config: Partial<RunConfig>, options: RequestOptions = {}): Promise<RunCreated> {
  const payload = {
    top_n_symbols: config.top_n_symbols ?? 6,
    timeframes: config.timeframes ?? ['5m', '1h'],
    budget_minutes: config.budget_minutes ?? 35,
    random_seed: config.random_seed ?? 42,
  }
  const response = await apiFetch(
    '/runs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { ...options, retries: 0, timeoutMs: options.timeoutMs ?? 30_000 },
  )
  return asJson<RunCreated>(response)
}

export async function listRuns(options: RequestOptions = {}): Promise<RunStatus[]> {
  const response = await apiFetch('/runs', { method: 'GET' }, options)
  return asJson<RunStatus[]>(response)
}

export async function getRun(runId: string, options: RequestOptions = {}): Promise<RunStatus> {
  const response = await apiFetch(`/runs/${runId}`, { method: 'GET' }, options)
  return asJson<RunStatus>(response)
}

export async function getResults(runId: string, options: RequestOptions = {}): Promise<ResultSummary> {
  const response = await apiFetch(`/runs/${runId}/results`, { method: 'GET' }, options)
  return asJson<ResultSummary>(response)
}

export async function getPlot(runId: string, plotId: string, options: RequestOptions = {}): Promise<PlotPayload> {
  const response = await apiFetch(`/runs/${runId}/plots/${plotId}`, { method: 'GET' }, options)
  return asJson<PlotPayload>(response)
}

export async function getTelemetry(runId: string, limit = 300, options: RequestOptions = {}): Promise<TelemetryFeed> {
  const response = await apiFetch(`/runs/${runId}/telemetry?limit=${limit}`, { method: 'GET' }, options)
  return asJson<TelemetryFeed>(response)
}

export async function cancelRun(runId: string, options: RequestOptions = {}): Promise<void> {
  const response = await apiFetch(`/runs/${runId}/cancel`, { method: 'POST' }, { ...options, retries: 0 })
  if (!response.ok) {
    throw new Error(await response.text())
  }
}

export async function generateReport(runId: string, options: RequestOptions = {}): Promise<void> {
  const response = await apiFetch(`/runs/${runId}/report`, { method: 'POST' }, { ...options, retries: 0 })
  if (!response.ok) {
    throw new Error(await response.text())
  }
}

export async function exportPine(runId: string, topN = 3, options: RequestOptions = {}): Promise<void> {
  const response = await apiFetch(
    `/runs/${runId}/exports/pine`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ top_n: topN }),
    },
    { ...options, retries: 0 },
  )
  if (!response.ok) {
    throw new Error(await response.text())
  }
}
