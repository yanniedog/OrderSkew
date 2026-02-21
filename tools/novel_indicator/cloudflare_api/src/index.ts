import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { AppContext } from './types'
import { authRoutes } from './routes/auth'
import { profileRoutes } from './routes/profile'

const app = new Hono<AppContext>()

app.use('*', logger())
app.use('*', secureHeaders())
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  c.header('Pragma', 'no-cache')
  c.header('Expires', '0')
  await next()
})
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const configured = c.env.APP_ORIGIN?.trim()
      if (!configured) {
        return origin ?? ''
      }
      return configured
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-CSRF-Token'],
    credentials: true,
  }),
)

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'novel-indicator-auth-profile-api' }))

app.route('/api/auth', authRoutes)
app.route('/api', profileRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((error, c) => {
  console.error('Unhandled API error', error)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
