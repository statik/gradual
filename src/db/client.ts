import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { env } from '../env.js'
import * as schema from './schema/index.js'

const client = new SQL({
  url: env.databaseUrl,
  max: 10,
  idleTimeout: 30,
})

export const db = drizzle(client, { schema })
export type DB = typeof db
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
