import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'

async function main(): Promise<void> {
  const client = postgres(env.databaseUrl, { max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: './drizzle' })
  await client.end()
  console.log('[migrate] done')
}

main().catch((err) => {
  console.error('[migrate] failed', err)
  process.exit(1)
})
