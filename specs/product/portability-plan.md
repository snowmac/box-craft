# BoxCraft — Cloud Portability: Agent Work Plan

2026-09-25 · Written for an agent to execute end to end **without asking
@adam.bourg**. Every decision below is made; each carries a default and a
one-line reason so it can be overridden later. This plan has no Human
checkpoints — it's a behavior-preserving refactor plus documentation, not
a migration or a live-infra change; normal push-to-`main` auto-deploy is
sufficient.

## Why (not a migration — insurance)

Not planning to move off Cloudflare. Planning to stay **nimble**: if a
future reason ever justified moving (cost at large scale, an acquirer's
existing AWS/GCP footprint, a Cloudflare outage or pricing shock), the
move should be cheap, not a rewrite. Today the codebase is already
*partially* portable by accident — `shared/d1.ts`'s `D1Like` interface
means D1 could be swapped for Postgres/SQLite by writing one adapter.
`shared/events.ts`'s `EventContext` already abstracts `ctx.waitUntil`.
Business logic in `shared/*.ts` is already pure, framework-agnostic TS.
This plan closes the two real gaps (KV has no such interface; the
Durable Object has no interface at all) and turns the informal pattern
into an explicit, checked rule so it doesn't erode as the codebase grows.

**Scope boundary — read this first:** this plan does **not** build a
Redis-backed debouncer, does **not** containerize anything, does **not**
touch deploy tooling, and does **not** migrate anything anywhere. It
draws interface boundaries and writes down what a real migration would
still cost. Building the actual alternative implementations is
explicitly out of scope until there's a real reason to.

## Ground rules

- Every task is a **behavior-preserving refactor**: the full test suite
  (all 6 packages: root, `workers/app-backend`, `workers/webhook-consumer`,
  `workers/ops-console`, `shopify-app/test/pick-n-picker`,
  `shopify-app/extensions/cart-transform`) and every package's
  `npx tsc --noEmit` must be green before and after each task, with
  identical pass counts — a refactor that changes test counts or behavior
  is a bug, not a task well done.
- No `wrangler.toml` changes. These are type-level interface changes;
  Cloudflare's real `KVNamespace` already structurally satisfies the
  narrow interface this plan defines (TypeScript structural typing — no
  runtime wrapper needed for KV, same as `D1Like` needs none for D1
  today). Zero deploy risk.
- Commit and push to `main` after each task, per this repo's existing
  convention. Update `work-log.md`.

## Decisions

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | KV abstraction | New `shared/kv.ts` defines `KVLike` — scoped to exactly the methods this codebase actually calls: `get(key): Promise<string \| null>`, `get<T>(key, "json"): Promise<T \| null>`, `put(key, value): Promise<void>`, `delete(key): Promise<void>`, `list(opts: {prefix?: string; cursor?: string}): Promise<{keys: {name: string}[]; list_complete: boolean; cursor?: string}>`. Every `shared/` and `workers/*/src/*.ts` file that isn't a Worker's own `Env` binding declaration is retyped from `KVNamespace` to `KVLike` | Mirrors `D1Like`'s existing pattern; a future non-Cloudflare KV backend (Redis, Postgres table) needs one adapter class, not a rewrite of every caller |
| D2 | Durable Object isolation | New `shared/debounce.ts` defines a `Debouncer` interface capturing the actual contract ("collapse a burst of per-key updates into one write after a quiet window"), not Cloudflare's Durable Object API shape. `workers/webhook-consumer`'s route code depends on `Debouncer`, not `env.SKU_DEBOUNCER` directly; the existing `SkuDebouncer` Durable Object becomes that interface's one (Cloudflare-specific) implementation, reached through a single thin adapter file | This is the one genuinely non-portable primitive (actor model + alarms have no equivalent elsewhere) — the goal isn't to make it portable today, it's to make sure only *one file* would need rewriting on a real migration, not every caller |
| D3 | Formal rules, not just a pattern | Create `CLAUDE.md` at the repo root (none exists today) with a "Portability rules" section — see exact text in T3 | An informal pattern followed by one person/session erodes; a written rule a future agent or engineer actually reads doesn't |
| D4 | Migration cost map | A new `specs/product/portability-notes.md` documents, plainly, what's free vs. real work in a future migration — see T4 | So a future decision-maker (including a future Claude Code session, or an acquirer's engineer) doesn't have to re-derive this conversation's analysis from scratch |
| D5 | What's explicitly *not* touched | `D1Like` (already done), `EventContext`/`ctx.waitUntil` (already done), secrets/env vars (already plain strings, portable as-is), Cron Triggers (any scheduler works, no code depends on Cloudflare's specifically) | Call these out so nobody "fixes" something already fine — wasted work this plan should prevent, not cause |

## Tasks

### T1. `KVLike` interface + retype every consumer

- `shared/kv.ts`: define `KVLike` per D1's shape above. Unit test: a
  plain in-memory `Map`-backed mock implementing `KVLike` (no Cloudflare
  types anywhere in the test file) passes through every exported function
  that currently takes a `KVNamespace` — this is the proof the interface
  is complete and minimal.
- Retype every non-`Env`-declaration usage: `shared/bitmap.ts` (if it
  takes KV directly — check), `workers/app-backend/src/sync.ts`
  (`writeBitmapEntries`), `workers/app-backend/src/index.ts`'s
  `ensureShopReady`/`exchangeForOfflineToken`/handlers that take
  `env.SHOP_TOKENS`/`env.LOCATION_BITMAP` as a parameter (not the `Env`
  interface field itself — that stays `KVNamespace`, since it's the one
  place binding the real Cloudflare type to the config), `workers/ops-console/src/kv-inspector.ts`,
  `workers/ops-console/src/queries.ts`'s `listShops`, `workers/ops-console/src/actions.ts`,
  `workers/webhook-consumer/src/debouncer.ts` and `index.ts`, root
  `src/index.ts`'s guardrail check handler.
- Accept: every package's `npm test` and `npx tsc --noEmit` green,
  identical test counts to before this task. `grep -rn "KVNamespace"
  shared/ workers/*/src workers/*/test src/` returns matches **only** in
  each Worker's `Env` interface declaration (confirms the boundary held).

### T2. `Debouncer` interface around the Durable Object

- `shared/debounce.ts`: `export interface Debouncer { schedule(skuKey:
  string, update: PendingUpdate): Promise<void>; }` (name/shape the
  update payload to match `debouncer.ts`'s existing `PendingUpdate`).
- `workers/webhook-consumer/src/debouncer-adapter.ts` (or similar): the
  one file allowed to reach into `env.SKU_DEBOUNCER` (the Durable Object
  namespace binding) — wraps it to satisfy `Debouncer`.
- `workers/webhook-consumer/src/index.ts`'s webhook handler takes a
  `Debouncer` (or constructs the adapter once and passes it), not the raw
  binding, past that one adapter file.
- Accept: existing debouncer tests unchanged and green (they already test
  `SkuDebouncer`'s internal logic directly — that's fine and stays, this
  task only changes what the *route handler* depends on); `npx tsc
  --noEmit` green; `grep -rn "SKU_DEBOUNCER" workers/webhook-consumer/src`
  returns matches only in the `Env` interface and the one adapter file.

### T3. `CLAUDE.md` — portability rules

Create at repo root:

```markdown
# BoxCraft — Repo Rules

## Portability

BoxCraft runs on Cloudflare Workers today. That's not expected to change,
but the codebase is kept nimble on purpose — see
`specs/product/portability-plan.md` and `portability-notes.md` for why and
what a migration would actually cost.

Rules, binding on all future work in `shared/` and any Worker's business
logic (not its thin entry-point routing):

1. **`shared/` never imports a Cloudflare-specific ambient type directly**
   — no `KVNamespace`, `D1Database`, `DurableObject`,
   `DurableObjectState`, `ExecutionContext`. Only the narrow `*Like`
   interfaces defined in `shared/` (`D1Like`, `KVLike`, `EventContext`,
   `Debouncer`) are allowed past that boundary.
2. **A Worker's own top-level `Env` interface is the only place a real
   Cloudflare binding type is named.** Everything else — every function
   that does real work — takes the narrow interface. This works for free
   via TypeScript structural typing for D1/KV; it needs one small adapter
   file for anything with genuinely different semantics elsewhere (the
   Durable Object debouncer is the one example so far).
3. **A new external dependency (new storage primitive, new platform API)
   gets a narrow interface in `shared/`, scoped to exactly the methods
   actually called, before any code calls it.** Never reach for the
   vendor SDK type directly from business logic, even "just this once."
4. Secrets/env vars and `ctx.waitUntil` don't need this treatment — they're
   already plain strings and an `EventContext.waitUntil` call
   respectively, portable as-is. Don't add ceremony where there's already
   none needed.
```

### T4. `specs/product/portability-notes.md` — the migration cost map

Write a short reference doc (not a plan to execute) with a table:

| Piece | Portable today? | What a migration needs |
|---|---|---|
| Business logic (`shared/*.ts`) | Yes | Nothing — pure TS |
| D1 (`D1Like`) | Yes | One adapter class (Postgres/SQLite) |
| KV (`KVLike`, post-T1) | Yes | One adapter class (Redis/Postgres table) |
| `ctx.waitUntil` (`EventContext`) | Yes | Trivial — any async task runner |
| Secrets/env vars | Yes | `process.env` maps directly |
| Cron Triggers | Yes | Any scheduler (crontab, node-cron) |
| Durable Object debounce (`Debouncer`, post-T2) | Boundary only | Real new implementation (Redis + delayed job queue is the natural fit) — a couple of days, the one real rewrite |
| HTTP handler shell (`fetch(request, env, ctx)`) | No | Move to Express/Fastify/Hono per Worker. Hedge: adopting **Hono** for routing in new work makes this specific piece nearly free later (it runs identically on Workers and Node) — not required by this plan, noted as an option |
| Deploy/ops (zero-downtime deploy, global edge, DDoS protection) | No | Cloudflare gives this for free today; self-hosting means owning it — containerize, reverse proxy/TLS, load balancer, monitoring |

Close with the same honest conclusion reached in conversation: at current
usage/economics this is not worth doing proactively — it's insurance, not
a roadmap item.

### T5. Work log entry

Standard entry in `work-log.md`: what was refactored, why, confirmation
that behavior didn't change (test counts before/after).

## Out of scope (explicitly, so it isn't assumed later)

- Building the Redis-backed debouncer or any other concrete non-Cloudflare
  implementation.
- Any containerization, deploy pipeline, or infra work.
- Moving the HTTP handler shell to Hono/Express/Fastify (noted as an
  option in T4, not executed).
- Anything involving AWS, GCP, or any other specific target platform —
  this plan is deliberately platform-agnostic insurance, not a migration
  plan toward a named destination.
