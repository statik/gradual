# Gradual — Pi Agent Demo Platform

Hono + Postgres + Electric + Better Auth, on **Bun**. Anonymous-first identities that upgrade in place. See `docs/design.md` for the full design memo.

## Layout

```
src/
  index.ts          # Hono entrypoint (Bun + node:http dispatcher)
  auth.ts           # Better Auth (anonymous + accountLinking)
  env.ts            # env validation
  db/
    client.ts       # drizzle on bun:sql
    migrate.ts      # drizzle migrator (bun-sql)
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
  admin/
    index.ts        # AdminJS resources
    auth.ts         # Express middleware gating /admin behind Better Auth
public/
  index.html        # minimal demo page
```

## Local dev

```bash
cp .env.example .env
docker compose up -d                # postgres + electric
bun install
bun run db:generate
bun run db:migrate
bun run dev                         # bun --hot src/index.ts
open http://localhost:3000
```

`bun` runs TypeScript directly; there is no build step. `.env` is auto-loaded.

## What's wired

- `POST /api/auth/sign-in/anonymous` — seeds `user`, `virtual_keys`, `quota_buckets`.
- `POST /api/auth/sign-in/social` — OAuth + `onLinkAccount` re-targets FKs in one transaction.
- `POST /api/inference` — estimate → atomic debit → SSE stream → reconcile + insert message/tool calls in one tx.
- `GET /api/sync/:table` — proxies to Electric with `account_id = <user.id>` pinned server-side.
- `GET /api/datasets` + `GET /api/datasets/:id/download` — server-side proxy over a curated catalog of public CSV/Parquet sample sets; the browser writes the bytes into the Pyodide MEMFS at `/data/<file>`.
- `GET /api/me`, `/healthz`, `/readyz`.
- `GET /admin` — AdminJS over `@adminjs/sql`, gated by Better Auth + `ADMIN_EMAILS` allowlist.

### Datasets / virtual FS

The **Datasets** menu lists a curated catalog (seaborn-data + vega-datasets, plus a sample Parquet). Selecting one downloads it through the server proxy (Kaggle isn't usable directly — its files need an authenticated API token; the catalog is structured so a Kaggle source can be added later behind `KAGGLE_USERNAME`/`KAGGLE_KEY`) and writes it into the Pyodide worker's MEMFS at `/data/<filename>`. Mounted paths are injected into the agent's system prompt so it can `pd.read_csv("/data/iris.csv")`. The kernel persists across cells but is fresh on reload (IndexedDB persistence is deliberately deferred).

## Bun-specific notes

- DB driver is `bun:sql` (built-in Postgres client) via `drizzle-orm/bun-sql`.
- `@hono/node-server` is retained for the `node:http` top-level dispatcher (Bun's node compat handles it); rewriting the dispatch as a fetch-to-Express bridge wasn't worth the bridge code.
- `package.json` pins every `@tiptap/*` to `2.1.13` via `overrides` — AdminJS's design-system declares `^2.1.13` which bun otherwise resolves to a newer API-incompatible version.

## What's stubbed

- Browser agent (pi-agent-core + Pyodide).
- ECS Fargate IaC.
- Initial drizzle migration files (`bun run db:generate` creates them).
- Anthropic prompt-token estimation uses `chars/4`; swap to `/v1/messages/count_tokens` for precision.
