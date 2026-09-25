# BoxCraft — Cloud Portability Notes

Reference doc, not a plan to execute. What a real migration off Cloudflare
would actually cost, as of the `portability-plan.md` refactor
(`shared/kv.ts`'s `KVLike`, `shared/debounce.ts`'s `Debouncer`, both
already in place). See `CLAUDE.md`'s "Portability" section for the rules
that keep this table accurate going forward.

| Piece | Portable today? | What a migration needs |
|---|---|---|
| Business logic (`shared/*.ts`) | Yes | Nothing — pure TS |
| D1 (`D1Like`) | Yes | One adapter class (Postgres/SQLite) |
| KV (`KVLike`) | Yes | One adapter class (Redis/Postgres table) |
| `ctx.waitUntil` (`EventContext`) | Yes | Trivial — any async task runner |
| Secrets/env vars | Yes | `process.env` maps directly |
| Cron Triggers | Yes | Any scheduler (crontab, node-cron) |
| Durable Object debounce (`Debouncer`) | Boundary only | Real new implementation (Redis + delayed job queue is the natural fit) — a couple of days, the one real rewrite |
| HTTP handler shell (`fetch(request, env, ctx)`) | No | Move to Express/Fastify/Hono per Worker. Hedge: adopting **Hono** for routing in new work makes this specific piece nearly free later (it runs identically on Workers and Node) — not required by this plan, noted as an option |
| Deploy/ops (zero-downtime deploy, global edge, DDoS protection) | No | Cloudflare gives this for free today; self-hosting means owning it — containerize, reverse proxy/TLS, load balancer, monitoring |

At current usage/economics this is not worth doing proactively — it's
insurance, not a roadmap item. Nothing here is planned or scheduled; it
exists so a future decision-maker (including a future Claude Code
session, or an acquirer's engineer) doesn't have to re-derive this
analysis from scratch if a real reason to move ever comes up.
