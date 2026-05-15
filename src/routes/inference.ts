import { Hono } from 'hono'
import { adapterFor } from '../adapters/index.js'
import type { ChatRequest, OpenAIChunk } from '../adapters/types.js'
import { db } from '../db/client.js'
import { agentMessages, agentSessions, agentToolCalls, usageLog } from '../db/schema/agent.js'
import { id } from '../lib/ids.js'
import { getActiveKeyAndBucket, reconcile, tryDebit } from '../quota/index.js'
import type { AppContext } from '../types.js'
import type { Tx } from '../db/client.js'

export const inference = new Hono<AppContext>()

interface ToolCallAccum {
  id: string
  name: string
  args: string
}

interface StreamAccumulator {
  inputTokens: number
  outputTokens: number
  assistantText: string
  toolCalls: Map<number, ToolCallAccum>
  finishReason: string | null
}

function accumulate(chunk: OpenAIChunk, acc: StreamAccumulator): void {
  if (chunk.usage) {
    acc.inputTokens = chunk.usage.prompt_tokens
    acc.outputTokens = chunk.usage.completion_tokens
  }
  const choice = chunk.choices[0]
  if (!choice) return
  if (choice.finish_reason) acc.finishReason = choice.finish_reason
  if (typeof choice.delta.content === 'string') acc.assistantText += choice.delta.content

  for (const tc of choice.delta.tool_calls ?? []) {
    const slot = acc.toolCalls.get(tc.index) ?? { id: '', name: '', args: '' }
    if (tc.id) slot.id = tc.id
    if (tc.function?.name) slot.name = tc.function.name
    if (tc.function?.arguments) slot.args += tc.function.arguments
    acc.toolCalls.set(tc.index, slot)
  }
}

inference.post('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json<ChatRequest>()
  const adapter = adapterFor(body.model)
  if (!adapter) return c.json({ error: 'unknown_model', model: body.model }, 400)

  const { vkey, bucket } = await getActiveKeyAndBucket(user.id)
  const maxOut = Math.min(body.max_tokens ?? 4096, 8192)
  const estimate = adapter.estimateTokens(body) + maxOut

  if (!(await tryDebit(bucket.id, estimate))) {
    return c.json({ error: 'quota_exceeded', reset_at: bucket.resetAt.toISOString() }, 429)
  }

  const sessionId = body.session_id ?? await createSession(user.id, body.model)
  const lastMessage = body.messages[body.messages.length - 1]
  if (lastMessage && lastMessage.role === 'user') {
    await insertUserMessage(sessionId, user.id, lastMessage)
  }

  const startedAt = Date.now()
  const acc: StreamAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    assistantText: '',
    toolCalls: new Map(),
    finishReason: null,
  }

  const enc = new TextEncoder()
  const upstreamController = new AbortController()
  c.req.raw.signal.addEventListener('abort', () => upstreamController.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let upstreamError: Error | null = null
      try {
        for await (const chunk of adapter.stream(body, { signal: upstreamController.signal })) {
          accumulate(chunk, acc)
          controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        }
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
      } catch (err) {
        upstreamError = err as Error
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`))
      } finally {
        controller.close()
        try {
          await onStreamEnd({
            bucketId: bucket.id,
            estimate,
            actual: acc.inputTokens + acc.outputTokens,
            sessionId,
            accountId: user.id,
            virtualKeyId: vkey.id,
            model: body.model,
            provider: adapter.name,
            inputTokens: acc.inputTokens,
            outputTokens: acc.outputTokens,
            assistantText: acc.assistantText,
            toolCalls: [...acc.toolCalls.values()],
            latencyMs: Date.now() - startedAt,
            status: upstreamError ? 'error' : 'ok',
          })
        } catch (err) {
          console.error('[onStreamEnd]', err)
        }
      }
    },
    cancel() {
      upstreamController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  })
})

interface StreamResult {
  bucketId: string
  estimate: number
  actual: number
  sessionId: string
  accountId: string
  virtualKeyId: string
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  assistantText: string
  toolCalls: ToolCallAccum[]
  latencyMs: number
  status: 'ok' | 'error'
}

async function onStreamEnd(p: StreamResult): Promise<void> {
  const delta = p.actual - p.estimate
  await db.transaction(async (tx) => {
    await reconcile(tx, p.bucketId, delta)
    const assistantMsgId = await insertAssistantMessage(tx, p)
    for (const tc of p.toolCalls) {
      let params: unknown = {}
      try { params = tc.args ? JSON.parse(tc.args) : {} } catch { params = { _raw: tc.args } }
      await tx.insert(agentToolCalls).values({
        id: id('tc'),
        messageId: assistantMsgId,
        sessionId: p.sessionId,
        accountId: p.accountId,
        toolName: tc.name,
        params: params as object,
        status: 'proposed',
        proposedCode: typeof (params as { code?: string }).code === 'string'
          ? (params as { code: string }).code
          : null,
      })
    }
    await tx.insert(usageLog).values({
      id: id('ul'),
      accountId: p.accountId,
      virtualKeyId: p.virtualKeyId,
      sessionId: p.sessionId,
      provider: p.provider,
      model: p.model,
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      estimatedTokens: p.estimate,
      latencyMs: p.latencyMs,
      status: p.status,
    })
  })
}

async function createSession(accountId: string, model: string): Promise<string> {
  const sessionId = id('sess')
  await db.insert(agentSessions).values({
    id: sessionId,
    accountId,
    model,
    title: 'New session',
  })
  return sessionId
}

async function insertUserMessage(
  sessionId: string,
  accountId: string,
  msg: { content: ChatRequest['messages'][number]['content'] },
): Promise<void> {
  const text = typeof msg.content === 'string'
    ? msg.content
    : msg.content.map((p) => p.text ?? '').join('')
  await db.insert(agentMessages).values({
    id: id('msg'),
    sessionId,
    accountId,
    role: 'user',
    content: text,
  })
}

async function insertAssistantMessage(tx: Tx, p: StreamResult): Promise<string> {
  const msgId = id('msg')
  await tx.insert(agentMessages).values({
    id: msgId,
    sessionId: p.sessionId,
    accountId: p.accountId,
    role: 'assistant',
    content: p.assistantText,
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
  })
  return msgId
}
