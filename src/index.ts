import { getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import express from 'express'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import http from 'node:http'
import { buildAdminRouter } from './admin/index.js'
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

async function start(): Promise<void> {
  console.log('[gradual] building admin router…')
  const adminRouter = await buildAdminRouter()
  console.log('[gradual] admin router ready')

  const adminApp = express()
  adminApp.use('/admin', adminRouter)

  const honoHandler = getRequestListener(app.fetch)

  const server = http.createServer((req, res) => {
    if (req.url && (req.url === '/admin' || req.url.startsWith('/admin/') || req.url.startsWith('/admin?'))) {
      adminApp(req, res)
    } else {
      honoHandler(req, res)
    }
  })

  server.listen(env.port, () => {
    console.log(`[gradual] listening on http://localhost:${env.port}`)
    console.log(`[gradual] admin at http://localhost:${env.port}/admin`)
  })
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  start().catch((err) => {
    console.error('[gradual] failed to start', err)
    process.exit(1)
  })
}

export { app }
