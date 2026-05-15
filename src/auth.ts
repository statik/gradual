import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { db } from './db/client.js'
import { agentMessages, agentSessions, agentToolCalls, usageLog, virtualKeys, quotaBuckets } from './db/schema/agent.js'
import { env } from './env.js'
import { raiseQuotaLimit, seedVirtualKeyAndQuota } from './quota/index.js'

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
if (env.googleClientId && env.googleClientSecret) {
  socialProviders.google = { clientId: env.googleClientId, clientSecret: env.googleClientSecret }
}
if (env.githubClientId && env.githubClientSecret) {
  socialProviders.github = { clientId: env.githubClientId, clientSecret: env.githubClientSecret }
}

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: drizzleAdapter(db, { provider: 'pg' }),
  socialProviders,
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'github'],
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          const tier = createdUser.isAnonymous ? 'anon' : 'free'
          await seedVirtualKeyAndQuota(createdUser.id, tier)
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    storage: 'database',
  },
  plugins: [
    anonymous({
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await db.transaction(async (tx) => {
          const anonId = anonymousUser.user.id
          const newId = newUser.user.id

          await tx.update(virtualKeys).set({ accountId: newId }).where(eq(virtualKeys.accountId, anonId))
          await tx.update(usageLog).set({ accountId: newId }).where(eq(usageLog.accountId, anonId))
          await tx.update(agentSessions).set({ accountId: newId }).where(eq(agentSessions.accountId, anonId))
          await tx.update(agentMessages).set({ accountId: newId }).where(eq(agentMessages.accountId, anonId))
          await tx.update(agentToolCalls).set({ accountId: newId }).where(eq(agentToolCalls.accountId, anonId))
          await tx.update(quotaBuckets).set({ accountId: newId }).where(eq(quotaBuckets.accountId, anonId))

          await raiseQuotaLimit(tx, newId, 'free')
        })
      },
    }),
  ],
})

export type Auth = typeof auth
