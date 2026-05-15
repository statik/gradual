import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/client.js'
import { agentToolCalls } from '../db/schema/agent.js'
import type { AppContext } from '../types.js'

export const toolCalls = new Hono<AppContext>()

interface CompletePayload {
  status: 'running' | 'succeeded' | 'failed' | 'skipped'
  executedCode?: string
  result?: unknown
}

toolCalls.post('/:id/complete', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const toolCallId = c.req.param('id')
  const body = await c.req.json<CompletePayload>()

  const now = new Date()
  const updates: Record<string, unknown> = {
    status: body.status,
    executedCode: body.executedCode ?? null,
    result: (body.result ?? null) as object | null,
  }
  if (body.status === 'running') updates.startedAt = now
  else updates.completedAt = now

  const rows = await db.update(agentToolCalls)
    .set(updates)
    .where(and(
      eq(agentToolCalls.id, toolCallId),
      eq(agentToolCalls.accountId, user.id),
    ))
    .returning({ id: agentToolCalls.id })

  if (!rows.length) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})
