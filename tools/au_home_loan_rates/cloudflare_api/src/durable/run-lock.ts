import { nowIso } from '../utils/time'
import type { EnvBindings } from '../types'

type LockRecord = {
  key: string
  owner: string
  acquiredAt: string
  expiresAt: number
}

type LockAction = 'acquire' | 'release' | 'status'

type LockRequest = {
  action: LockAction
  key: string
  owner?: string
  ttlSeconds?: number
}

type LockResponse = {
  ok: boolean
  action: LockAction
  key: string
  locked: boolean
  acquired?: boolean
  released?: boolean
  owner?: string
  acquiredAt?: string
  expiresAt?: number
  reason?: string
}

const STORAGE_KEY = 'lock-record'
const MIN_TTL_SECONDS = 30
const MAX_TTL_SECONDS = 24 * 60 * 60

function clampTtl(ttlSeconds: number | undefined): number {
  const parsed = Number(ttlSeconds)
  if (!Number.isFinite(parsed)) {
    return 7200
  }
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(parsed)))
}

export class RunLockDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let payload: LockRequest | null = null

    if (request.method === 'POST') {
      payload = await request.json<LockRequest>().catch(() => null)
    } else {
      const url = new URL(request.url)
      const action = String(url.searchParams.get('action') || '') as LockAction
      const key = String(url.searchParams.get('key') || '')
      const owner = String(url.searchParams.get('owner') || '') || undefined
      const ttlSeconds = Number(url.searchParams.get('ttlSeconds') || '') || undefined
      payload = { action, key, owner, ttlSeconds }
    }

    if (!payload || !payload.action || !payload.key) {
      return Response.json(
        {
          ok: false,
          action: payload?.action || 'status',
          key: payload?.key || '',
          locked: false,
          reason: 'invalid_lock_request',
        } satisfies LockResponse,
        { status: 400 },
      )
    }

    if (payload.action === 'acquire') {
      return this.handleAcquire(payload)
    }
    if (payload.action === 'release') {
      return this.handleRelease(payload)
    }
    if (payload.action === 'status') {
      return this.handleStatus(payload)
    }

    return Response.json(
      {
        ok: false,
        action: payload.action,
        key: payload.key,
        locked: false,
        reason: 'unsupported_action',
      } satisfies LockResponse,
      { status: 400 },
    )
  }

  private async readRecord(): Promise<LockRecord | null> {
    const record = await this.state.storage.get<LockRecord>(STORAGE_KEY)
    if (!record) {
      return null
    }
    if (record.expiresAt <= Date.now()) {
      await this.state.storage.delete(STORAGE_KEY)
      return null
    }
    return record
  }

  private async handleAcquire(payload: LockRequest): Promise<Response> {
    const owner = String(payload.owner || 'unknown')
    const ttlSeconds = clampTtl(payload.ttlSeconds)
    const now = Date.now()
    const existing = await this.readRecord()

    if (existing) {
      return Response.json({
        ok: true,
        action: 'acquire',
        key: payload.key,
        locked: true,
        acquired: false,
        owner: existing.owner,
        acquiredAt: existing.acquiredAt,
        expiresAt: existing.expiresAt,
      } satisfies LockResponse)
    }

    const record: LockRecord = {
      key: payload.key,
      owner,
      acquiredAt: nowIso(),
      expiresAt: now + ttlSeconds * 1000,
    }

    await this.state.storage.put(STORAGE_KEY, record)

    return Response.json({
      ok: true,
      action: 'acquire',
      key: payload.key,
      locked: true,
      acquired: true,
      owner: record.owner,
      acquiredAt: record.acquiredAt,
      expiresAt: record.expiresAt,
    } satisfies LockResponse)
  }

  private async handleRelease(payload: LockRequest): Promise<Response> {
    const existing = await this.readRecord()
    if (!existing) {
      return Response.json({
        ok: true,
        action: 'release',
        key: payload.key,
        locked: false,
        released: false,
        reason: 'lock_not_found',
      } satisfies LockResponse)
    }

    if (payload.owner && payload.owner !== existing.owner) {
      return Response.json({
        ok: false,
        action: 'release',
        key: payload.key,
        locked: true,
        released: false,
        owner: existing.owner,
        reason: 'owner_mismatch',
      } satisfies LockResponse, { status: 409 })
    }

    await this.state.storage.delete(STORAGE_KEY)

    return Response.json({
      ok: true,
      action: 'release',
      key: payload.key,
      locked: false,
      released: true,
    } satisfies LockResponse)
  }

  private async handleStatus(payload: LockRequest): Promise<Response> {
    const existing = await this.readRecord()
    if (!existing) {
      return Response.json({
        ok: true,
        action: 'status',
        key: payload.key,
        locked: false,
      } satisfies LockResponse)
    }

    return Response.json({
      ok: true,
      action: 'status',
      key: payload.key,
      locked: true,
      owner: existing.owner,
      acquiredAt: existing.acquiredAt,
      expiresAt: existing.expiresAt,
    } satisfies LockResponse)
  }
}

type LockEnv = Pick<EnvBindings, 'RUN_LOCK_DO'>

async function callLock(env: LockEnv, key: string, payload: Omit<LockRequest, 'key'>): Promise<LockResponse> {
  const id = env.RUN_LOCK_DO.idFromName(key)
  const stub = env.RUN_LOCK_DO.get(id)
  const response = await stub.fetch('https://run-lock.internal', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...payload, key }),
  })

  if (!response.ok) {
    return {
      ok: false,
      action: payload.action,
      key,
      locked: false,
      reason: `lock_request_failed_${response.status}`,
    }
  }

  const data = await response.json<LockResponse>()
  return data
}

export async function acquireRunLock(
  env: LockEnv,
  params: { key: string; owner: string; ttlSeconds: number },
): Promise<LockResponse> {
  return callLock(env, params.key, {
    action: 'acquire',
    owner: params.owner,
    ttlSeconds: params.ttlSeconds,
  })
}

export async function releaseRunLock(env: LockEnv, params: { key: string; owner?: string }): Promise<LockResponse> {
  return callLock(env, params.key, {
    action: 'release',
    owner: params.owner,
  })
}

export async function getRunLockStatus(env: LockEnv, key: string): Promise<LockResponse> {
  return callLock(env, key, { action: 'status' })
}