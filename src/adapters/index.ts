import { anthropicAdapter } from './anthropic.js'
import { openaiAdapter } from './openai.js'
import type { Adapter } from './types.js'

const REGISTRY: Adapter[] = [openaiAdapter, anthropicAdapter]

export function adapterFor(model: string): Adapter | null {
  return REGISTRY.find((a) => a.supports(model)) ?? null
}

export type { Adapter, ChatRequest, OpenAIChunk } from './types.js'
