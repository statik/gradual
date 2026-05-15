export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; text?: string; [k: string]: unknown }>
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: Array<{
    type: 'function'
    function: { name: string; description?: string; parameters?: unknown }
  }>
  tool_choice?: unknown
  session_id?: string
}

export interface OpenAIChunkDelta {
  role?: 'assistant'
  content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    type?: 'function'
    function?: { name?: string; arguments?: string }
  }>
}

export interface OpenAIChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: OpenAIChunkDelta
    finish_reason: string | null
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface Adapter {
  readonly name: 'openai' | 'anthropic'
  supports(model: string): boolean
  estimateTokens(req: ChatRequest): number
  stream(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<OpenAIChunk>
}
