import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema/index.js'

const queryClient = postgres(env.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })
export type DB = typeof db
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
