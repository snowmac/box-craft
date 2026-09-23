# BoxCraft — Work Log

Chronological record of what's been done on this repo, for @adam.bourg.
Written retroactively from commit history and session context — see
`specs/product/assumptions.md` for the design decisions and open items
behind this work, not repeated here.

## 2026-09-22 — Planning and technical spec

- Wrote `specs/product/draft.md`: the BoxCraft product plan (problem,
  solution, architecture, phased build plan, pricing, go-to-market,
  risks, timeline).
- Wrote `specs/product/technical-spec.md`: system architecture, data
  models, API contracts, sequence flows, non-functional requirements,
  testing/rollout plan.

## 2026-09-22 — Cloudflare pipeline bring-up

- Connected the `snowmac/box-craft` GitHub repo to Cloudflare Workers
  Builds. First deploy failed ("Could not detect a directory containing
  static files") — root cause was the Cloudflare project being
  configured for static-asset detection rather than reading
  `wrangler.toml`'s Worker config; also found the Git connection had
  silently disconnected. Fixed both; first real deploy went green.
- Scaffolded the Guardrail Worker skeleton (`wrangler.toml`, `src/`,
  `package.json`) so the pipeline had something real to build.

## 2026-09-22 — v1 + v2 core engineering (`b46f168`)

Implemented the full v1 (one-time bundles) and v2 (location guardrails)
engineering backlog from the Implementation Tasks doc — 15 tracked tasks,
40 unit tests, all passing:

- **Guardrail Worker** (root, deployed as Cloudflare project `box-craft`):
  `POST /check` with set-intersection compatibility logic, fail-open on
  any bitmap read failure.
- **Webhook consumer** (`workers/webhook-consumer`): separate Worker,
  HMAC-verified `inventory_levels/update` handling, Durable-Object-based
  debounce (collapses event bursts to one KV write per SKU). Found and
  fixed a real design gap along the way: Shopify's webhook payload
  carries `inventory_item_id`, not the variant GID the bitmap is keyed
  by — resolved with an `inventory_item_id -> variant GID` lookup
  populated by backfill.
- **Backfill script** (`scripts/backfill.ts`): Admin API → KV population
  via Cloudflare's bulk-write REST endpoint.
- **Cart Transform function** (`shopify-app/extensions/cart-transform`):
  grouping by `_bundle_id`, `linesMerge` output, selling-plan skip logic
  — all pure, unit-tested functions plus a thin Shopify Functions runtime
  adapter.
- **Pick-N picker theme extension**
  (`shopify-app/extensions/pick-n-picker`): Liquid app block + JS —
  selection state, add-to-cart with `_bundle_id`/`_bundle_price`,
  guardrail wiring with client-side debounce and fail-open.

Wrote `specs/product/assumptions.md` alongside this, logging every
judgment call made without sign-off, known gaps, and manual setup steps.
None of it had been deployed or run against a real store at this point.

## 2026-09-22 — Wiring in real values as they arrived

- `b22d18d`: real `LOCATION_BITMAP` KV namespace id
  (`fd681a5957544826b82e98f16df52950`) and Shopify Partner app `client_id`
  (`d3f114303ecd6de5e650b4bdb96106f6`), both provided by @adam.bourg.
- `88101a2`: real `dev_store_url` (`box-craft-demo.myshopify.com`), the
  Partner Dashboard dev store created for this project.
- `206910a`: noted the app-backend hosting decision as explicitly
  deferred, per request.

## 2026-09-22 — Cloudflare deploy bug #2: npm ci lockfile failure (`2245e1b`)

Cloudflare's Workers Build started running `npm ci` once a
`package-lock.json` was present, failing with "Missing:
@types/node@22.20.4 from lock file" — despite the lockfile being
genuinely in sync (`npm ci` succeeded locally; regenerating it changed
nothing but wrangler's patch version). Root cause: an npm-version
compatibility quirk between local npm (10.9.7) and Cloudflare's build
image (npm 10.9.2). Fix: stopped committing `package-lock.json` for all
three Worker projects — nothing at deploy time needs it, since `wrangler
deploy` bundles TypeScript itself and fetches its own copy of wrangler
fresh via `npx` regardless.

## 2026-09-22 — App-backend Worker (`f02b877`)

Decided to build a real app-backend rather than rely on `shopify app
dev`'s local tunnel. Scope came out smaller than a typical OAuth+billing
backend because the plan already specifies Managed Pricing over
hand-rolled `AppSubscriptionCreate` calls — Shopify hosts the
plan-selection screen natively, so this Worker never touches the Billing
API. Built (`workers/app-backend`):

- `GET /auth` — redirect to Shopify's OAuth authorize URL, CSRF state in
  an HttpOnly cookie.
- `GET /auth/callback` — OAuth HMAC verification (a different algorithm
  from webhook HMAC — hex digest over sorted query params), state check,
  token exchange, storage in KV keyed by shop domain.
- `GET /` — minimal embedded admin shell confirming install succeeded.
- `POST /webhooks/app/uninstalled` — HMAC-verified cleanup of the stored
  token.

10 new tests (shop domain validation against SSRF/open-redirect,
authorize URL construction, OAuth HMAC verification), 40 total across 5
packages.

## 2026-09-22 — Local Cloudflare provisioning script (`ee0658c`, `a86250f`)

Built `scripts/setup-cloudflare.mjs` (assumes a local `wrangler login`)
to automate what a Cloudflare API token *can* do: create the
`SHOP_TOKENS` KV namespace, set secrets, deploy `webhook-consumer` and
`app-backend` directly, and wire the resulting URL into
`wrangler.toml`/`shopify.app.toml`. Simplified to a single required
secret (`SHOPIFY_CLIENT_SECRET`) after confirming standard TOML-declared
webhooks are signed with the client secret, so
`SHOPIFY_WEBHOOK_SECRET` doesn't need to be provided separately. Added
`scripts/setup-cloudflare.sh`, an interactive wrapper that prompts for
the secret with masked input instead of requiring it as a plain env var.

## 2026-09-22 — Branch cleanup

Switched the working branch from `claude/busy-ramanujan-1t7enc` to `main`
per request — all future work commits and pushes directly to `main`.
(GitHub default-branch setting and deleting the old branch are dashboard
actions outside what any available tool can do; left to @adam.bourg.)

## 2026-09-22 — Fixed setup script deploy-order bug (`4559d85`)

First real run of `setup-cloudflare.sh` failed: "Secret edit failed...
the latest version of your Worker isn't currently deployed" — Cloudflare's
newer versioning model requires a Worker to have a deployed version
before `wrangler secret put` can attach a secret to it, and these were
brand-new Workers. Fixed by reordering the script to deploy both Workers
first (they work fine with secrets unset), then set secrets.

## 2026-09-22/23 — Cloudflare side went live (`46a3d83`, `bbc29be`)

@adam.bourg re-ran the fixed script successfully:

- `workers/app-backend` deployed and live at
  `https://box-craft-app-backend.adam-bourg.workers.dev`
- `workers/webhook-consumer` deployed with `SHOPIFY_WEBHOOK_SECRET` set
- `SHOP_TOKENS` KV namespace provisioned
  (`0a36a18ea3344074a5bec4e4c2575f1e`)
- `shopify.app.toml`'s `application_url`/`redirect_urls` wired to the
  real URL

Pulled that in, cleaned up now-stale "placeholder"/"not yet provisioned"
comments across both `wrangler.toml` files and `shopify.app.toml`, and
updated `assumptions.md`'s manual-steps checklist to match.

## 2026-09-23 — Pre-deploy fixes to the Shopify app

Reviewed the Shopify side against Shopify's official templates before the
first `shopify app deploy`. Found and fixed three things that would have
broken it:

- **Missing `inventory_levels/update` webhook subscription.**
  `shopify.app.toml` only declared `app/uninstalled`, so Shopify would
  never have sent inventory events to the webhook-consumer and the bitmap
  would have gone stale after backfill. Added it with the consumer's
  absolute URL (checked live via `/health`).
- **Cart Transform pricing used a field that doesn't exist.**
  `linesMerge` only accepts `price.percentageDecrease`; `fixedPricePerUnit`
  is expand/update-only. The function now converts `_bundle_price` into a
  percentage off the merged lines' list total. Tests updated and extended
  (12 passing).
- **Cart Transform extension couldn't build.** Its toml ran
  `npm run build`, which didn't exist. Restructured to the official
  `functions-cart-transform-js` layout (`src/index.ts`,
  `export = "cart-transform-run"`, empty build command,
  `@shopify/shopify_function`, checked-in `schema.graphql`). Verified:
  `shopify app function build` compiles to wasm, and `shopify app function
  run` against a sample cart returns the expected merge.

Noted along the way: the Pick-N picker sets `_bundle_price` to the plain
sum of the selected variants' prices, so there's no bundle discount yet —
bundles currently check out at list price.

First `shopify app deploy` attempt (run by @adam.bourg) logged in and
built the function, then failed validation on the theme extension: it
contained a `test/` directory (only `assets`/`blocks`/`locales`/`snippets`
are allowed). Moved the picker tests to `shopify-app/test/pick-n-picker/`,
added `locales/en.default.json`, and replaced the parser-blocking
`script_tag` filter with a module `<script>` tag. `shopify theme check` is
now clean.

## Where things stand now

**Live:** Guardrail Worker (`box-craft`), webhook consumer, app-backend —
all three Cloudflare Workers deployed with real bindings/secrets.

**Not yet done** (see `assumptions.md` for full detail):
- `cd shopify-app && shopify app deploy` — registers the real OAuth
  redirect URL and `app/uninstalled` webhook subscription with Shopify.
  Without this, an install attempt fails with a redirect_uri mismatch
  even though the Worker is live.
- Managed Pricing plan configuration in the Partner Dashboard.
- Dev store needs 2+ locations with split test inventory (currently just
  created, not yet configured this way).
- `scripts/backfill.ts` hasn't been run against real data yet.
- No bundle discount: the picker's `_bundle_price` equals the list
  total, so the Cart Transform merges at list price.
- No integration/load tests, no real end-to-end checkout test on the dev
  store yet.
- Billing test flow, App Store listing/submission, Go-to-Market tasks —
  not started.
