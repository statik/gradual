import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { env } from '../env.js'

async function main(): Promise<void> {
  const client = new SQL({ url: env.databaseUrl, max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: './drizzle' })
  await client.close()
  console.log('[migrate] done')
}

main().catch((err) => {
  console.error('[migrate] failed', err)
  process.exit(1)
})
