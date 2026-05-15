# Design Memo — Pi Agent Demo Platform

## Decision

One Node/TypeScript service on ECS Fargate fronts RDS Postgres, streams chat completions through a hand-built OpenAI-compatible gateway, and lets Electric sync agent session state to the browser in real time. Better Auth manages anonymous-first identities that link to Google or GitHub in place — same row, same history, raised quota.

| Layer | Choice | Role |
| --- | --- | --- |
| Runtime | Node 20 / TypeScript | One server process |
| HTTP | Hono | Routes, middleware, SSE |
| Database | RDS Postgres (`wal_level=logical`) | Source of truth |
| ORM | Drizzle | Schema-as-code, typed queries |
| Auth | Better Auth + anonymous + accountLinking | Gradual registration |
| Admin UI | AdminJS | Internal ops |
| Read sync | Electric (separate container) | Live UI on agent state |
| Browser agent | pi-agent-core + pi-ai + Pyodide | Demo runtime |
| Deploy | ECS Fargate, ALB, ACM, Secrets Manager | Single region, single AZ v1 |

## Architecture — three runtime processes, one source of truth

- **Browser**: `pi-agent-core` runs the agent loop. `pi-ai` calls our gateway as an OpenAI-compatible provider. Pyodide runs in a Web Worker for `python_run`. Electric client subscribes to shapes for live UI.
- **Hono app (Fargate)**: owns every write — auth handlers, `/api/inference` streaming, quota debits, message inserts, OAuth callbacks, AdminJS UI, Electric shape proxy. Stateless.
- **Electric sync (Fargate)**: Elixir process. Consumes logical replication, serves shape subscriptions over HTTP. Stateless, never receives writes.
- **RDS Postgres**: single source of truth. `wal_level=logical`, replication slot for Electric, normal pool for Hono.

Streaming bytes never flow through Electric. Electric is for row-level state; final-state row inserts propagate to other tabs after the SSE stream completes.

## Identity — the account row outlives the upgrade

1. First visit, no cookie → `signIn.anonymous()` → `user` row with `isAnonymous=true`; `virtual_keys` + `quota_buckets` seeded at anon tier.
2. Demo activity → all writes carry the anonymous `user.id` as `account_id`.
3. `signIn.social` with active anon session → `onLinkAccount({ anonymousUser, newUser })` runs one transaction that re-targets every `account_id` from `anonymousUser.id` to `newUser.id` and raises the quota tier.
4. Returning user on a new device → normal OAuth matches existing user by provider+sub.

## Data model — 8 tables, 4 sync live

| Table | Owner | Electric | Reason |
| --- | --- | --- | --- |
| `user` | Better Auth | No | PII + `isAnonymous` |
| `account` | Better Auth | No | OAuth tokens |
| `session` | Better Auth | No | Session secrets |
| `verification` | Better Auth | No | Auth ephemera |
| `virtual_keys` | App | No | Contains `key_hash` |
| `quota_buckets` | App | Yes | Live token meter |
| `agent_sessions` | App | Yes | Sidebar list |
| `agent_messages` | App | Yes | Transcript |
| `agent_tool_calls` | App | Yes | Python-cell state machine |

`account_id` is denormalized onto every Electric'd table so shape WHERE clauses stay one-liners (`account_id = X`).

## Gateway — estimate, debit, stream, reconcile

1. `adapterFor(model)` picks the provider (`openai` | `anthropic`).
2. `tryDebit(bucketId, estimate)` — one atomic conditional UPDATE; zero rows means quota exceeded → `429`.
3. Open upstream stream with `c.req.raw.signal` threaded through.
4. Forward chunks as OpenAI-formatted SSE to the browser; accumulate text + tool calls + usage.
5. In `finally`, one transaction reconciles the quota delta and inserts the assistant message, tool calls, and usage log row.

A single commit at stream end means Electric subscribers see assistant message, tool calls, and updated quota meter arrive together.

## Provider adapters

- OpenAI: passthrough; `gpt-tokenizer` for estimation.
- Anthropic: pull `system` out of `messages`; translate to Messages API; convert `content_block_delta` / `message_delta` events to OpenAI-shaped `chunk.choices[0].delta` plus a final `chunk.usage`. Estimation uses `chars/4`; reconcile after stream.

The wire to pi-ai is always OpenAI-shaped, regardless of upstream provider.

## Operations

- Two Fargate tasks (Hono app, Electric sync) + RDS Postgres.
- ALB target group for Hono: `idle_timeout.timeout_seconds = 600` (default 60s would guillotine long completions).
- No response buffering anywhere upstream of the gateway.
- Better Auth's database-backed `rateLimit` covers anonymous-signin abuse; tighten with a per-IP rule on `/api/auth/sign-in/anonymous` if needed.
- Single AZ v1 — acceptable for a demo, revisit before paid customers depend on it.
