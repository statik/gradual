import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core'
import { user } from './auth.js'

export const virtualKeys = pgTable('virtual_keys', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  tier: text('tier').notNull().default('anon'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
}, (t) => ({
  byAccount: index('virtual_keys_account_idx').on(t.accountId),
}))

export const quotaBuckets = pgTable('quota_buckets', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  window: text('window').notNull().default('day'),
  limitTokens: integer('limit_tokens').notNull(),
  usedTokens: integer('used_tokens').notNull().default(0),
  resetAt: timestamp('reset_at').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byAccount: index('quota_buckets_account_idx').on(t.accountId),
}))

export const usageLog = pgTable('usage_log', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  virtualKeyId: text('virtual_key_id').notNull(),
  sessionId: text('session_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  estimatedTokens: integer('estimated_tokens').notNull().default(0),
  latencyMs: integer('latency_ms'),
  status: text('status').notNull().default('ok'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byAccount: index('usage_log_account_idx').on(t.accountId, t.createdAt),
}))

export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Untitled session'),
  model: text('model'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byAccount: index('agent_sessions_account_idx').on(t.accountId, t.updatedAt),
}))

export const agentMessages = pgTable('agent_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  bySession: index('agent_messages_session_idx').on(t.sessionId, t.createdAt),
  byAccount: index('agent_messages_account_idx').on(t.accountId),
}))

export const agentToolCalls = pgTable('agent_tool_calls', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => agentMessages.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  accountId: text('account_id').notNull(),
  toolName: text('tool_name').notNull(),
  params: jsonb('params').notNull(),
  status: text('status').notNull().default('proposed'),
  proposedCode: text('proposed_code'),
  executedCode: text('executed_code'),
  result: jsonb('result'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (t) => ({
  byMessage: index('agent_tool_calls_message_idx').on(t.messageId),
  byAccount: index('agent_tool_calls_account_idx').on(t.accountId),
}))
