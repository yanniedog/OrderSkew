import { Hono } from 'hono'
import {
  deleteRunSummary,
  getRunSummaryWithPlots,
  getUserPreferences,
  listRunSummaries,
  replaceRunPlots,
  setUserPreferences,
  upsertRunSummary,
} from '../db'
import type { AppContext, JsonObject } from '../types'
import { authRequired, csrfProtected } from '../middleware/auth'
import { rateLimit } from '../middleware/rate_limit'
import { validateRunPayload } from '../utils/validation'

export const profileRoutes = new Hono<AppContext>()

profileRoutes.use('*', authRequired)

profileRoutes.get('/me', async (c) => {
  const user = c.get('authUser')
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      email_verified: Boolean(user.email_verified_at),
    },
  })
})

profileRoutes.get('/me/preferences', async (c) => {
  const user = c.get('authUser')
  const payload = (await getUserPreferences(c.env, user.id)) ?? {}
  return c.json({ preferences: payload })
})

profileRoutes.put('/me/preferences', csrfProtected, rateLimit(80, 60_000), async (c) => {
  const user = c.get('authUser')
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid preferences payload.' }, 400)
  }
  const payload = body as JsonObject
  const size = JSON.stringify(payload).length
  if (size > 150_000) {
    return c.json({ error: 'Preferences payload exceeds size limit.' }, 400)
  }
  await setUserPreferences(c.env, user.id, payload)
  return c.json({ ok: true })
})

profileRoutes.get('/me/runs', async (c) => {
  const user = c.get('authUser')
  const runs = await listRunSummaries(c.env, user.id)
  return c.json({ runs })
})

profileRoutes.post('/me/runs', csrfProtected, rateLimit(40, 60_000), async (c) => {
  const user = c.get('authUser')
  const body = await c.req.json().catch(() => null)
  const validated = validateRunPayload(body)
  if (!validated.ok) {
    return c.json({ error: validated.error }, 400)
  }

  const payload = validated.data
  const runId = String(payload.run_id ?? '').trim()
  if (!runId) {
    return c.json({ error: 'run_id is required.' }, 400)
  }

  const sourceVersion = String(payload.source_version ?? 'web-local-v1').slice(0, 64)
  const syncState = String(payload.sync_state ?? 'synced').slice(0, 32)
  const retainedAt = String(payload.retained_at ?? new Date().toISOString())

  const plotsRaw = Array.isArray(payload.plots) ? payload.plots : []
  const plots: Array<{ plot_id: string; payload: JsonObject }> = []
  for (const item of plotsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const plotObject = item as Record<string, unknown>
    const plotId = String(plotObject.plot_id ?? '').trim()
    const plotPayload = plotObject.payload
    if (!plotId || !plotPayload || typeof plotPayload !== 'object' || Array.isArray(plotPayload)) {
      continue
    }
    const serialized = JSON.stringify(plotPayload)
    if (serialized.length > 220_000) {
      return c.json({ error: `Plot payload too large for ${plotId}.` }, 400)
    }
    plots.push({ plot_id: plotId, payload: plotPayload as JsonObject })
  }

  const summaryRecord = await upsertRunSummary(c.env, user.id, {
    runId,
    sourceVersion,
    syncState,
    retainedAt,
    config: (payload.config ?? {}) as JsonObject,
    summary: (payload.summary ?? {}) as JsonObject,
  })

  await replaceRunPlots(c.env, summaryRecord.id, plots)
  return c.json({ ok: true, run_id: runId })
})

profileRoutes.get('/me/runs/:runId', async (c) => {
  const user = c.get('authUser')
  const runId = c.req.param('runId')
  const payload = await getRunSummaryWithPlots(c.env, user.id, runId)
  if (!payload) {
    return c.json({ error: 'Run not found.' }, 404)
  }
  return c.json(payload)
})

profileRoutes.delete('/me/runs/:runId', csrfProtected, rateLimit(40, 60_000), async (c) => {
  const user = c.get('authUser')
  const runId = c.req.param('runId')
  const deleted = await deleteRunSummary(c.env, user.id, runId)
  if (!deleted) {
    return c.json({ error: 'Run not found.' }, 404)
  }
  return c.json({ ok: true })
})
