import type { MiddlewareHandler } from 'hono'
import { auth } from '../auth.js'
import type { AppContext } from '../types.js'

export const sessionMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('user', session?.user ?? null)
  c.set('session', session?.session ?? null)
  await next()
}

export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthorized' }, 401)
  await next()
}
