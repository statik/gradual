// Bun auto-loads .env files; no explicit loader needed.

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`)
  return n
}

export const env = {
  port: int('PORT', 3000),
  nodeEnv: optional('NODE_ENV', 'development'),
  appUrl: optional('APP_URL', 'http://localhost:3000'),

  databaseUrl: required('DATABASE_URL'),

  betterAuthSecret: required('BETTER_AUTH_SECRET'),
  betterAuthUrl: optional('BETTER_AUTH_URL', 'http://localhost:3000'),

  googleClientId: optional('GOOGLE_CLIENT_ID'),
  googleClientSecret: optional('GOOGLE_CLIENT_SECRET'),
  githubClientId: optional('GITHUB_CLIENT_ID'),
  githubClientSecret: optional('GITHUB_CLIENT_SECRET'),

  electricUrl: optional('ELECTRIC_URL', 'http://localhost:3001'),
  electricSourceId: optional('ELECTRIC_SOURCE_ID'),
  electricSourceSecret: optional('ELECTRIC_SOURCE_SECRET'),

  openaiApiKey: optional('OPENAI_API_KEY'),
  anthropicApiKey: optional('ANTHROPIC_API_KEY'),

  quotaAnonTokensPerDay: int('QUOTA_ANON_TOKENS_PER_DAY', 20_000),
  quotaFreeTokensPerDay: int('QUOTA_FREE_TOKENS_PER_DAY', 200_000),
} as const

export type Env = typeof env
