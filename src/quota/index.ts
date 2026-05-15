import { and, eq, sql } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { db, type Tx } from '../db/client.js'
import { quotaBuckets, virtualKeys } from '../db/schema/agent.js'
import { env } from '../env.js'
import { id } from '../lib/ids.js'

export type Tier = 'anon' | 'free' | 'pro'

const TIER_LIMITS: Record<Tier, number> = {
  anon: env.quotaAnonTokensPerDay,
  free: env.quotaFreeTokensPerDay,
  pro: env.quotaFreeTokensPerDay * 10,
}

function tomorrowMidnight(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

export async function seedVirtualKeyAndQuota(accountId: string, tier: Tier): Promise<void> {
  const rawKey = `vk_${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')

  await db.transaction(async (tx) => {
    await tx.insert(virtualKeys).values({
      id: id('vk'),
      accountId,
      keyHash,
      tier,
      status: 'active',
    })
    await tx.insert(quotaBuckets).values({
      id: id('qb'),
      accountId,
      window: 'day',
      limitTokens: TIER_LIMITS[tier],
      usedTokens: 0,
      resetAt: tomorrowMidnight(),
    })
  })
}

export async function raiseQuotaLimit(tx: Tx, accountId: string, tier: Tier): Promise<void> {
  await tx.update(quotaBuckets)
    .set({ limitTokens: TIER_LIMITS[tier], updatedAt: new Date() })
    .where(eq(quotaBuckets.accountId, accountId))
  await tx.update(virtualKeys)
    .set({ tier })
    .where(eq(virtualKeys.accountId, accountId))
}

export async function getActiveKeyAndBucket(accountId: string) {
  const [vkey] = await db.select().from(virtualKeys)
    .where(and(eq(virtualKeys.accountId, accountId), eq(virtualKeys.status, 'active')))
    .limit(1)
  const [bucket] = await db.select().from(quotaBuckets)
    .where(eq(quotaBuckets.accountId, accountId))
    .limit(1)
  if (!vkey || !bucket) throw new Error('quota_not_seeded')

  if (bucket.resetAt.getTime() <= Date.now()) {
    await db.update(quotaBuckets)
      .set({ usedTokens: 0, resetAt: tomorrowMidnight(), updatedAt: new Date() })
      .where(eq(quotaBuckets.id, bucket.id))
    bucket.usedTokens = 0
    bucket.resetAt = tomorrowMidnight()
  }

  return { vkey, bucket }
}

export async function tryDebit(bucketId: string, n: number): Promise<boolean> {
  if (n <= 0) return true
  const r = await db.update(quotaBuckets)
    .set({
      usedTokens: sql`${quotaBuckets.usedTokens} + ${n}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(quotaBuckets.id, bucketId),
      sql`${quotaBuckets.usedTokens} + ${n} <= ${quotaBuckets.limitTokens}`,
    ))
    .returning({ id: quotaBuckets.id })
  return r.length > 0
}

export async function reconcile(tx: Tx, bucketId: string, delta: number): Promise<void> {
  if (delta === 0) return
  await tx.update(quotaBuckets)
    .set({
      usedTokens: sql`GREATEST(0, ${quotaBuckets.usedTokens} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(quotaBuckets.id, bucketId))
}
