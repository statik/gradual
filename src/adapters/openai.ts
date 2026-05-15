import { encode } from 'gpt-tokenizer'
import { env } from '../env.js'
import type { Adapter, ChatRequest, OpenAIChunk } from './types.js'

const OPENAI_BASE = 'https://api.openai.com/v1'

export const openaiAdapter: Adapter = {
  name: 'openai',

  supports(model: string): boolean {
    return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')
  },

  estimateTokens(req: ChatRequest): number {
    let total = 0
    for (const m of req.messages) {
      const text = typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => p.text ?? '').join('')
      total += encode(text).length + 4
    }
    return total + 8
  },

  async *stream(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<OpenAIChunk> {
    if (!env.openaiApiKey) throw new Error('OPENAI_API_KEY not configured')

    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...req, stream: true, session_id: undefined }),
      signal: opts.signal,
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`openai_error ${res.status}: ${text.slice(0, 200)}`)
    }

    yield* parseSSEStream(res.body)
  },
}

async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<OpenAIChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
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
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          yield JSON.parse(payload) as OpenAIChunk
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
