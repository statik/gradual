import { env } from '../env.js'
import type { Adapter, ChatMessage, ChatRequest, OpenAIChunk } from './types.js'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string }
  >
}

interface AnthropicRequest {
  model: string
  system?: string
  messages: AnthropicMessage[]
  max_tokens: number
  temperature?: number
  top_p?: number
  stream: true
  tools?: Array<{ name: string; description?: string; input_schema: unknown }>
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content.map((p) => p.text ?? '').join('')
}

function toAnthropicRequest(req: ChatRequest): AnthropicRequest {
  let system: string | undefined
  const messages: AnthropicMessage[] = []

  for (const m of req.messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n\n${textOf(m.content)}` : textOf(m.content)
      continue
    }
    if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          content: textOf(m.content),
        }],
      })
      continue
    }
    if (m.role === 'assistant') {
      const parts: AnthropicMessage['content'] = []
      const text = textOf(m.content)
      if (text) parts.push({ type: 'text', text })
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {}
        try { input = JSON.parse(tc.function.arguments) } catch { /* tolerate */ }
        parts.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
      messages.push({ role: 'assistant', content: parts })
      continue
    }
    messages.push({ role: 'user', content: [{ type: 'text', text: textOf(m.content) }] })
  }

  return {
    model: req.model,
    system,
    messages,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature,
    top_p: req.top_p,
    stream: true,
    tools: req.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: 'object', properties: {} },
    })),
  }
}

export const anthropicAdapter: Adapter = {
  name: 'anthropic',

  supports(model: string): boolean {
    return model.startsWith('claude-')
  },

  estimateTokens(req: ChatRequest): number {
    let chars = 0
    for (const m of req.messages) chars += textOf(m.content).length
    return Math.ceil(chars / 4) + 8
  },

  async *stream(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<OpenAIChunk> {
    if (!env.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured')
    const body = toAnthropicRequest(req)

    const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`anthropic_error ${res.status}: ${text.slice(0, 200)}`)
    }

    yield* translateAnthropicStream(res.body, req.model)
  },
}

async function* translateAnthropicStream(
  body: ReadableStream<Uint8Array>,
  model: string,
): AsyncIterable<OpenAIChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const chunkId = `chatcmpl-${Math.random().toString(36).slice(2, 12)}`
  const created = Math.floor(Date.now() / 1000)
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0
  const toolIndex = new Map<number, { id: string; name: string }>()

  function frame(delta: OpenAIChunk['choices'][0]['delta'], finishReason: string | null = null): OpenAIChunk {
    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue

        let evt: { type: string; [k: string]: unknown }
        try { evt = JSON.parse(raw) } catch { continue }

        switch (evt.type) {
          case 'message_start': {
            const usage = (evt as unknown as { message?: { usage?: { input_tokens?: number } } }).message?.usage
            if (usage?.input_tokens) inputTokens = usage.input_tokens
            yield frame({ role: 'assistant', content: '' })
            break
          }
          case 'content_block_start': {
            const block = evt as unknown as { index: number; content_block: { type: string; id?: string; name?: string } }
            if (block.content_block.type === 'tool_use') {
              toolIndex.set(block.index, {
                id: block.content_block.id ?? '',
                name: block.content_block.name ?? '',
              })
              yield frame({
                tool_calls: [{
                  index: block.index,
                  id: block.content_block.id,
                  type: 'function',
                  function: { name: block.content_block.name, arguments: '' },
                }],
              })
            }
            break
          }
          case 'content_block_delta': {
            const block = evt as unknown as {
              index: number
              delta: { type: string; text?: string; partial_json?: string }
            }
            if (block.delta.type === 'text_delta' && block.delta.text) {
              yield frame({ content: block.delta.text })
            } else if (block.delta.type === 'input_json_delta' && block.delta.partial_json !== undefined) {
              yield frame({
                tool_calls: [{
                  index: block.index,
                  function: { arguments: block.delta.partial_json },
                }],
              })
            }
            break
          }
          case 'message_delta': {
            const md = evt as unknown as { delta?: { stop_reason?: string }; usage?: { output_tokens?: number } }
            if (md.usage?.output_tokens) outputTokens = md.usage.output_tokens
            const stop = md.delta?.stop_reason
            const finish = stop === 'tool_use' ? 'tool_calls'
              : stop === 'end_turn' ? 'stop'
                : stop === 'max_tokens' ? 'length'
                  : 'stop'
            const out: OpenAIChunk = frame({}, finish)
            out.usage = {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            }
            yield out
            break
          }
          case 'message_stop':
            return
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
