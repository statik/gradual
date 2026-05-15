import { Hono } from 'hono'
import { env } from '../env.js'
import type { AppContext } from '../types.js'

export const sync = new Hono<AppContext>()

const SYNCABLE_TABLES = {
  quota_buckets: 'account_id',
  agent_sessions: 'account_id',
  agent_messages: 'account_id',
  agent_tool_calls: 'account_id',
} as const

type Syncable = keyof typeof SYNCABLE_TABLES

sync.get('/:table', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const table = c.req.param('table') as Syncable
  if (!(table in SYNCABLE_TABLES)) {
    return c.json({ error: 'unknown_table', table }, 404)
  }

  const column = SYNCABLE_TABLES[table]
  const upstream = new URL(`${env.electricUrl}/v1/shape`)
  upstream.searchParams.set('table', table)
  upstream.searchParams.set('where', `${column} = '${user.id.replace(/'/g, "''")}'`)

  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (key === 'offset' || key === 'handle' || key === 'live' || key === 'cursor') {
      upstream.searchParams.set(key, value)
    }
  }
  if (env.electricSourceId) upstream.searchParams.set('source_id', env.electricSourceId)

  const headers: Record<string, string> = {}
  if (env.electricSourceSecret) headers['authorization'] = `Bearer ${env.electricSourceSecret}`

  const res = await fetch(upstream, { headers, signal: c.req.raw.signal })

  const passthrough = new Headers()
  for (const name of ['electric-handle', 'electric-offset', 'electric-cursor', 'electric-schema', 'electric-up-to-date']) {
    const v = res.headers.get(name)
    if (v) passthrough.set(name, v)
  }
  passthrough.set('content-type', res.headers.get('content-type') ?? 'application/json')
  passthrough.set('cache-control', 'no-cache, no-store')

  return new Response(res.body, { status: res.status, headers: passthrough })
})
