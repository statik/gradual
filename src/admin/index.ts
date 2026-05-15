import AdminJSExpress from '@adminjs/express'
import { Adapter, Database, Resource } from '@adminjs/sql'
import AdminJS from 'adminjs'
import express from 'express'
import { env } from '../env.js'
import { adminAuth } from './auth.js'

AdminJS.registerAdapter({ Database, Resource })

interface ParsedUrl {
  database: string
  connectionString: string
}

function parseDatabaseUrl(url: string): ParsedUrl {
  const u = new URL(url)
  const database = u.pathname.replace(/^\//, '')
  if (!database) throw new Error('DATABASE_URL is missing a database name')
  return { database, connectionString: url }
}

export async function buildAdminRouter(): Promise<express.Router> {
  const { database, connectionString } = parseDatabaseUrl(env.databaseUrl)

  const sqlDb = await new Adapter('postgresql', {
    database,
    connectionString,
  }).init()

  const admin = new AdminJS({
    rootPath: '/admin',
    loginPath: '/admin/login',
    branding: {
      companyName: 'Gradual — Pi Agent Demo',
      withMadeWithLove: false,
    },
    resources: [
      {
        resource: sqlDb.table('user'),
        options: {
          navigation: { name: 'Identity', icon: 'User' },
          listProperties: ['id', 'email', 'name', 'isAnonymous', 'emailVerified', 'createdAt'],
          showProperties: ['id', 'email', 'name', 'isAnonymous', 'emailVerified', 'image', 'createdAt', 'updatedAt'],
          editProperties: ['name', 'emailVerified'],
          filterProperties: ['email', 'isAnonymous', 'emailVerified', 'createdAt'],
          actions: { new: { isAccessible: false } },
        },
      },
      {
        resource: sqlDb.table('account'),
        options: {
          navigation: { name: 'Identity', icon: 'Lock' },
          listProperties: ['id', 'userId', 'providerId', 'accountId', 'createdAt'],
          properties: {
            accessToken: { isVisible: false },
            refreshToken: { isVisible: false },
            idToken: { isVisible: false },
            password: { isVisible: false },
          },
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
          },
        },
      },
      {
        resource: sqlDb.table('session'),
        options: {
          navigation: { name: 'Identity', icon: 'Clock' },
          listProperties: ['id', 'userId', 'ipAddress', 'userAgent', 'expiresAt', 'createdAt'],
          properties: { token: { isVisible: false } },
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
          },
        },
      },
      {
        resource: sqlDb.table('virtual_keys'),
        options: {
          navigation: { name: 'Quota', icon: 'Key' },
          listProperties: ['id', 'accountId', 'tier', 'status', 'createdAt', 'revokedAt'],
          showProperties: ['id', 'accountId', 'tier', 'status', 'createdAt', 'revokedAt'],
          editProperties: ['tier', 'status', 'revokedAt'],
          filterProperties: ['accountId', 'tier', 'status'],
          properties: { keyHash: { isVisible: false } },
          actions: { new: { isAccessible: false } },
        },
      },
      {
        resource: sqlDb.table('quota_buckets'),
        options: {
          navigation: { name: 'Quota', icon: 'BarChart2' },
          listProperties: ['id', 'accountId', 'window', 'usedTokens', 'limitTokens', 'resetAt', 'updatedAt'],
          editProperties: ['limitTokens', 'usedTokens', 'resetAt'],
          filterProperties: ['accountId', 'window'],
          actions: { new: { isAccessible: false } },
        },
      },
      {
        resource: sqlDb.table('usage_log'),
        options: {
          navigation: { name: 'Activity', icon: 'Activity' },
          listProperties: ['createdAt', 'accountId', 'provider', 'model', 'inputTokens', 'outputTokens', 'estimatedTokens', 'latencyMs', 'status'],
          showProperties: ['id', 'accountId', 'virtualKeyId', 'sessionId', 'provider', 'model', 'inputTokens', 'outputTokens', 'estimatedTokens', 'latencyMs', 'status', 'createdAt'],
          editProperties: [],
          filterProperties: ['accountId', 'provider', 'model', 'status', 'createdAt'],
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
          },
        },
      },
      {
        resource: sqlDb.table('agent_sessions'),
        options: {
          navigation: { name: 'Agent', icon: 'MessageSquare' },
          listProperties: ['id', 'accountId', 'title', 'model', 'createdAt', 'updatedAt'],
          filterProperties: ['accountId', 'model'],
        },
      },
      {
        resource: sqlDb.table('agent_messages'),
        options: {
          navigation: { name: 'Agent', icon: 'FileText' },
          listProperties: ['createdAt', 'sessionId', 'role', 'inputTokens', 'outputTokens'],
          showProperties: ['id', 'sessionId', 'accountId', 'role', 'content', 'inputTokens', 'outputTokens', 'createdAt'],
          editProperties: [],
          filterProperties: ['sessionId', 'accountId', 'role'],
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
          },
        },
      },
      {
        resource: sqlDb.table('agent_tool_calls'),
        options: {
          navigation: { name: 'Agent', icon: 'Terminal' },
          listProperties: ['id', 'sessionId', 'toolName', 'status', 'startedAt', 'completedAt'],
          showProperties: ['id', 'messageId', 'sessionId', 'accountId', 'toolName', 'status', 'params', 'proposedCode', 'executedCode', 'result', 'startedAt', 'completedAt'],
          editProperties: ['status'],
          filterProperties: ['sessionId', 'toolName', 'status'],
        },
      },
    ],
  })

  if (env.nodeEnv !== 'production') {
    admin.watch()
  }

  const gated = express.Router()
  gated.use(adminAuth)

  return AdminJSExpress.buildRouter(admin, gated)
}
