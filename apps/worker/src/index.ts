import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CoordinatorDO } from './coordinator-do'
import { getRequestId, logJson } from './logging'
import type { AppCtx, Bindings } from './types'
import appJson from '../config/app.json'
import { loadAppConfig } from '../../../packages/shared/src/config'

const app = new Hono<AppCtx>()

app.use('*', cors())

app.use('*', async (c, next) => {
  const requestId = getRequestId(c.req.raw.headers)
  const startedAt = Date.now()
  c.set('requestId', requestId)
  c.set('startedAt', startedAt)
  c.header('x-request-id', requestId)

  try {
    await next()
  } finally {
    const elapsedMs = Date.now() - startedAt
    logJson({
      level: 'info',
      event: 'http_request',
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      elapsedMs,
      ts: new Date().toISOString(),
    })
  }
})

app.get('/api/health', async (c) => {
  const cfg = loadAppConfig(c.env, appJson)
  const requestId = c.get('requestId')

  if (!cfg.features.health) {
    return c.json({ ok: false, error: 'health_endpoint_disabled', requestId }, 404)
  }

  await c.env.DB.prepare(
    `INSERT INTO bootstrap_events (request_id, route, method)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(requestId, '/api/health', 'GET')
    .run()

  return c.json({
    ok: true,
    service: cfg.appName,
    env: cfg.appEnv,
    version: cfg.appVersion,
    requestId,
    timestamp: new Date().toISOString(),
  })
})

app.get('/api/version', (c) => {
  const cfg = loadAppConfig(c.env, appJson)
  const requestId = c.get('requestId')

  if (!cfg.features.version) {
    return c.json({ ok: false, error: 'version_endpoint_disabled', requestId }, 404)
  }

  return c.json({
    ok: true,
    name: cfg.appName,
    version: cfg.appVersion,
    env: cfg.appEnv,
    requestId,
  })
})

app.notFound((c) => {
  const requestId = c.get('requestId')
  return c.json({ ok: false, error: 'not_found', requestId }, 404)
})

const worker: ExportedHandler<Bindings, Record<string, unknown>> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      logJson({
        level: 'info',
        event: 'queue_message',
        ts: new Date().toISOString(),
        messageId: message.id,
        attempts: message.attempts,
        body: message.body,
      })
      message.ack()
    }

    await env.RAW_BUCKET.put(
      `queue-bootstrap/${Date.now()}.json`,
      JSON.stringify({ count: batch.messages.length, at: new Date().toISOString() }),
      {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      },
    )
  },

  async scheduled(event, env): Promise<void> {
    const requestId = crypto.randomUUID()
    logJson({
      level: 'info',
      event: 'scheduled_trigger',
      requestId,
      cron: event.cron,
      scheduledTime: event.scheduledTime,
      ts: new Date().toISOString(),
    })

    const id = env.COORDINATOR_DO.idFromName('bootstrap')
    const stub = env.COORDINATOR_DO.get(id)
    await stub.fetch('https://do.internal/ping')
  },
}

export { CoordinatorDO }
export default worker