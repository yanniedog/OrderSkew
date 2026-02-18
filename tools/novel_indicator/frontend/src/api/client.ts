import { localEngine } from '../engine/client'
import type {
  BinanceDiagnosticsFeed,
  PlotPayload,
  ResultSummary,
  RunConfig,
  RunCreated,
  RunStatus,
  SessionInfo,
  StoredRunDetail,
  StoredRunSummary,
  TelemetryFeed,
  UserPreferences,
} from './types'

function readCookie(name: string): string | null {
  const all = document.cookie.split(';').map((x) => x.trim())
  const found = all.find((entry) => entry.startsWith(`${name}=`))
  if (!found) {
    return null
  }
  return decodeURIComponent(found.slice(name.length + 1))
}

async function serverFetch<T>(path: string, init: RequestInit = {}, withCsrf = false): Promise<T> {
  const headers = new Headers(init.headers)
  if (withCsrf) {
    const csrf = readCookie('ni_csrf')
    if (csrf) {
      headers.set('X-CSRF-Token', csrf)
    }
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export async function registerUser(payload: {
  username: string
  email: string
  password: string
  display_name?: string
}): Promise<SessionInfo> {
  const response = await serverFetch<{ user: SessionInfo['user'] }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return {
    user: response.user,
    csrf_token: readCookie('ni_csrf'),
  }
}

export async function loginUser(identity: string, password: string): Promise<SessionInfo> {
  const response = await serverFetch<{ user: SessionInfo['user'] }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  })
  return {
    user: response.user,
    csrf_token: readCookie('ni_csrf'),
  }
}

export async function logoutUser(): Promise<void> {
  await serverFetch('/api/auth/logout', { method: 'POST' }, true)
}

export async function getSession(): Promise<SessionInfo | null> {
  try {
    return await serverFetch<SessionInfo>('/api/auth/session')
  } catch {
    return null
  }
}

export async function requestEmailVerification(): Promise<void> {
  await serverFetch('/api/auth/email/verify/request', { method: 'POST' }, true)
}

export async function confirmEmailToken(token: string): Promise<void> {
  await serverFetch('/api/auth/email/verify/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export async function forgotPassword(email: string): Promise<void> {
  await serverFetch('/api/auth/password/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await serverFetch('/api/auth/password/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  })
}

export function startGoogleLogin(): void {
  window.location.href = '/api/auth/google/start'
}

export async function getPreferences(): Promise<UserPreferences> {
  const response = await serverFetch<{ preferences: UserPreferences }>('/api/me/preferences')
  return response.preferences
}

export async function setPreferences(preferences: UserPreferences): Promise<void> {
  await serverFetch('/api/me/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  }, true)
}

export async function listStoredRuns(): Promise<StoredRunSummary[]> {
  const response = await serverFetch<{ runs: StoredRunSummary[] }>('/api/me/runs')
  return response.runs
}

export async function saveRunToProfile(runId: string): Promise<void> {
  const payload = await localEngine.getRunStoragePayload(runId)
  await serverFetch('/api/me/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, true)
}

export async function getStoredRun(runId: string): Promise<StoredRunDetail> {
  return serverFetch<StoredRunDetail>(`/api/me/runs/${encodeURIComponent(runId)}`)
}

export async function deleteStoredRun(runId: string): Promise<void> {
  await serverFetch(`/api/me/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }, true)
}

export async function createRun(config: Partial<RunConfig>): Promise<RunCreated> {
  return localEngine.createRun(config)
}

export async function listRuns(): Promise<RunStatus[]> {
  return localEngine.listRuns()
}

export async function getRun(runId: string): Promise<RunStatus> {
  return localEngine.getRun(runId)
}

export async function getResults(runId: string): Promise<ResultSummary> {
  return localEngine.getResults(runId)
}

export async function getPlot(runId: string, plotId: string): Promise<PlotPayload> {
  return localEngine.getPlot(runId, plotId)
}

export async function getTelemetry(runId: string, limit = 300): Promise<TelemetryFeed> {
  return localEngine.getTelemetry(runId, limit)
}

export async function getBinanceDiagnostics(runId: string, limit = 40): Promise<BinanceDiagnosticsFeed> {
  return localEngine.getBinanceDiagnostics(runId, limit)
}

export async function cancelRun(runId: string): Promise<void> {
  return localEngine.cancelRun(runId)
}

export async function generateReport(runId: string): Promise<void> {
  return localEngine.generateReport(runId)
}

export async function exportPine(runId: string): Promise<void> {
  return localEngine.exportPine(runId)
}
