import type { NextFunction, Request, Response } from 'express'
import { auth } from '../auth.js'
import { env } from '../env.js'

const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

function nodeHeadersToFetch(req: Request): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
  }
  return headers
}

function isAdmin(email: string | null | undefined, isAnonymous: boolean): boolean {
  if (!email || isAnonymous) return false
  if (adminEmails.size === 0 && env.nodeEnv !== 'production') return true
  return adminEmails.has(email.toLowerCase())
}

export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: nodeHeadersToFetch(req) })
    const user = session?.user as ({ id: string; email: string; name?: string; isAnonymous?: boolean } | undefined)
    if (!user || !isAdmin(user.email, user.isAnonymous ?? false)) {
      res.status(403).type('text/html').send(forbiddenPage())
      return
    }
    ;(req as Request & { session?: { adminUser: unknown } }).session = {
      adminUser: { id: user.id, email: user.email, name: user.name },
    }
    next()
  } catch (err) {
    res.status(500).type('text/plain').send(`auth_error: ${String(err)}`)
  }
}

function forbiddenPage(): string {
  const hint = env.nodeEnv === 'production'
    ? 'Ask an existing admin to add your email to ADMIN_EMAILS.'
    : 'Set ADMIN_EMAILS in your .env (or leave it empty in dev to allow any signed-in non-anonymous user).'
  return `<!doctype html><meta charset="utf-8"><title>403</title>
<body style="font-family:Georgia,serif;max-width:36rem;margin:4rem auto;padding:0 1.25rem;color:#171c1d">
<h1 style="color:#4a4f3f">403 — Not authorized</h1>
<p>You must be signed in with an admin account to view <code>/admin</code>.</p>
<p style="color:#4a5250">${hint}</p>
<p><a href="/">Back to demo</a></p>
</body>`
}
