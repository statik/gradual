# Gradual — Pi Agent Demo Platform

Hono + Postgres + Electric + Better Auth. Anonymous-first identities that upgrade in place. See `docs/design.html` for the full design memo.

## Layout

```
src/
  index.ts          # Hono entrypoint
  auth.ts           # Better Auth (anonymous + accountLinking)
  env.ts            # env validation
  db/
    client.ts       # drizzle client
    schema/         # auth + agent tables
  routes/
    inference.ts    # OpenAI-compatible streaming gateway
    sync.ts         # Electric shape proxy
    health.ts
  adapters/
    openai.ts       # passthrough
    anthropic.ts    # OpenAI <-> Anthropic Messages translator
  quota/            # atomic conditional debit + reconcile
  middleware/
    auth.ts         # session middleware
public/
  index.html        # minimal demo page
```

## Local dev

```bash
cp .env.example .env
docker compose up -d                # postgres + electric
npm install
npm run db:generate
npm run db:migrate
npm run dev
open http://localhost:3000
```

## What's wired

- `POST /api/auth/sign-in/anonymous` — seeds `user`, `virtual_keys`, `quota_buckets`.
- `POST /api/auth/sign-in/social` — OAuth + `onLinkAccount` re-targets FKs in one transaction.
- `POST /api/inference` — estimate → atomic debit → SSE stream → reconcile + insert message/tool calls in one tx.
- `GET /api/sync/:table` — proxies to Electric with `account_id = <user.id>` pinned server-side.
- `GET /api/me`, `/healthz`, `/readyz`.

## What's stubbed

- Browser agent (pi-agent-core + Pyodide) — not yet vendored.
- AdminJS — not yet wired.
- ECS Fargate Terraform/CDK — not yet authored.
- Anthropic prompt-token estimation uses `chars/4`; swap to `/v1/messages/count_tokens` for precision.
