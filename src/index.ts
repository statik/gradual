import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { auth } from './auth.js'
import { env } from './env.js'
import { sessionMiddleware } from './middleware/auth.js'
import { health } from './routes/health.js'
import { inference } from './routes/inference.js'
import { sync } from './routes/sync.js'
import type { AppContext } from './types.js'

const app = new Hono<AppContext>()

app.use('*', logger())

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.use('/api/*', sessionMiddleware)

app.route('/', health)
app.route('/api/inference', inference)
app.route('/api/sync', sync)

app.get('/api/me', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ user: null })
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isAnonymous: (user as { isAnonymous?: boolean }).isAnonymous ?? false,
    },
  })
})

app.use('/*', serveStatic({ root: './public' }))

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`[gradual] listening on http://localhost:${info.port}`)
  })
}

export { app }
