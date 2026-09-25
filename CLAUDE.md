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
