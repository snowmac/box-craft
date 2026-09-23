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

Second deploy attempt got through build and validation but Shopify
rejected the app block: a `url` setting's `default` can't be blank. Set it
to the Guardrail Worker's URL. Checking that URL turned up two latent bugs
that would have silently disabled location checks on every storefront (the
picker fails open):

- **The Guardrail Worker is behind Cloudflare Access** — every request to
  `box-craft.adam-bourg.workers.dev` 302s to an Access login page. Needs
  turning off in the Cloudflare dashboard (dashboard-only).
- **No CORS on `/check`.** The picker's cross-origin JSON POST triggers a
  preflight, which 404'd. Added `OPTIONS` handling and
  `Access-Control-Allow-Origin: *` (`src/cors.ts`, 3 new tests), verified
  under `wrangler dev`.

@adam.bourg then switched `/check`'s Access scope to "Previews only"
(production is public, preview builds still require login). The CORS fix
still wasn't live: the `box-craft` Workers Build was still watching the
old `claude/busy-ramanujan-1t7enc` branch, so nothing pushed to `main`
since the branch switch had deployed. Production branch changed to `main`
in Settings → Builds; the next push deployed in ~2 minutes and `/check`
now answers preflights publicly with `Access-Control-Allow-Origin: *`.

## 2026-09-23 — First Shopify app release: `boxcraft-bundles-2`

Two more deploy failures fixed on the way:
- The picker's guardrail URL setting was `type: "url"`, whose default can
  only be a store path (`/collections/all`), never blank or external.
  Switched to `type: "text"`.
- App handle `boxcraft` is taken across Shopify apps; changed to
  `boxcraft-bundles` (only affects the admin URL, `/apps/boxcraft-bundles`).

`shopify app deploy --allow-updates` then released version
`boxcraft-bundles-2`: OAuth redirect URL, `app/uninstalled` and
`inventory_levels/update` webhook subscriptions, the Cart Transform
function, and the Pick-N theme app extension are all registered with
Shopify.

## 2026-09-23 — Install worked, but no token was stored

@adam.bourg installed the app on `box-craft-demo` from the Dev Dashboard;
the embedded page loaded, but `SHOP_TOKENS` stayed empty. Cause: with
scopes declared in `shopify.app.toml`, Shopify uses **managed
installation** — it never calls `/auth`, and instead loads `/` with a
signed `id_token` the app must trade for an access token (token exchange).
The shell ignored it. Added `src/session-token.ts` (HS256 JWT
verification: signature, `aud`, `exp`/`nbf`, `dest` shop) and a
token-exchange request for an offline token; `/` now does the exchange
the first time it sees a shop. 10 new tests. `/auth` stays as a fallback
for installs from a direct link.

## 2026-09-23 — Auto-deploy for all three Workers (`7310bed`)

Wrangler has no Workers Builds commands and its OAuth login gets an auth
error from the Builds API, so `webhook-consumer` and `app-backend` now
deploy from GitHub Actions (`.github/workflows/deploy-workers.yml`) on
push to `main` when their files or `shared/` change, after tests +
typecheck. @adam.bourg created a `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare
Workers") and added it as a repo secret. First run (`35884850348`)
deployed both. `box-craft` stays on Workers Builds.

## 2026-09-23 — Token stored, backfill run, guardrail verified live

- After the app-backend deploy, reloading the embedded app ran token
  exchange: `SHOP_TOKENS` now holds `shop:box-craft-demo.myshopify.com`,
  and a read-only Admin API call with it succeeded.
- Dev store needed no inventory changes: its generated test products
  already span Shop location, My Custom Location, and the Snow City
  Warehouse fulfillment-service location.
- **First real backfill run**: 26 variants → 52 KV entries (bitmap +
  inventory-item map), no errors.
- Live `/check` against real inventory: Minimal + Videographer →
  compatible (Shop); Multi-location + Minimal → compatible (Shop only);
  3p Fulfilled + Minimal → blocked (both reported as conflicting, since
  removing either fixes it); Out of Stock + Minimal → blocked (only the
  out-of-stock variant reported).

## 2026-09-23 — Cart Transform activation on install

Found before the checkout test: a deployed Cart Transform does nothing
until the app calls `cartTransformCreate` per store, and there was no
placeholder bundle product. app-backend now runs an idempotent store setup
on first load after install — find or create a hidden "BoxCraft Bundle"
product, then activate the function with that variant in the cart
transform's own metafield (the function now reads
`cartTransform.metafield` instead of an invented shop metafield). Added
scopes `write_products` + `write_cart_transforms`, and token re-exchange
when a stored token doesn't cover current scopes. API shapes checked by
introspecting the live store's Admin API. 11 new tests (31 in
app-backend), function rebuilt and re-run.

Released as `boxcraft-bundles-3`. On the next admin load the app
re-exchanged its token (now `read_inventory,read_locations,
write_cart_transforms,write_products`) and store setup ran cleanly:
"BoxCraft Bundle" product created, Cart Transform
`gid://shopify/CartTransform/146080110` active with the parent variant in
its `$app` metafield.

## 2026-09-23 — Storefront test on the dev store

- The generated test theme couldn't render app blocks; @adam.bourg
  switched the store to the Savor theme and added the Pick-N block via a
  theme-editor deep link (`addAppBlockId=<client_id>/pick-n-picker`).
  Automation couldn't drive the theme editor (blank captures), so that
  step was manual.
- First real picker test: 4 boards all stocked at Shop location were
  **wrongly blocked**. Cause: the storefront uses numeric variant ids
  (`variant.id`) while the bitmap is keyed by GID, so every lookup
  missed. Fixed in the Guardrail Worker (`toVariantGid` normalization at
  lookup, 3 tests).
- Noticed along the way: selected picker cards have no visual selected
  state (styling gap), and unknown variants block instead of failing open
  (logged as an open decision in `assumptions.md`).

### Guardrail fix deployed; first real Cart Transform run

- `box-craft` Workers Builds had been failing since `7310bed` with "the
  build token selected for this build has been deleted or rolled" (it
  used a token from another project). @adam.bourg set a new build token;
  the variant-id fix deployed and the same 4-board bundle became
  compatible on the live storefront.
- Added that bundle to cart: 4 lines with the right `_bundle_id` /
  `_bundle_price`, but no merge at cart or checkout. `shopify app logs`
  showed the function running successfully and emitting the correct
  `linesMerge` — with `percentageDecrease: "0"`. Cause: summing prices as
  floats (699.95+729.95+749.95+600 = 2779.8500000000004) made an at-list
  bundle look discounted by a hair. Now computed in integer cents, and a
  0% adjustment is omitted. Replaying Shopify's real logged input through
  the new build gives a clean merge with no price field.

### First end-to-end bundle merge

After `boxcraft-bundles-4` the function emitted a clean merge (no price
field) but Shopify still didn't apply it. A Shopify staff reply on the dev
forum traced this symptom to "how a bundle's parent variant publication is
resolved on the merge path". Publishing the "BoxCraft Bundle" product to
the Online Store channel (done in the admin via Chrome) fixed it: cart
and checkout now show **one "BoxCraft Bundle" line at $2,779.85 with the
4 boards as components**. v1's core flow works end to end on the dev
store.

### Store setup publishes the bundle product

`ensureStoreSetup` now creates the bundle product as `UNLISTED` and
publishes it to the Online Store publication (found by catalog title),
and publishes an existing unpublished one — covering installs from before
this fix. New scope `write_publications`. Verified by hand first on
box-craft-demo: with the parent set to UNLISTED the merge still applies,
and the product drops out of `/collections/all`; it still appeared in
search suggestions right after the change (likely index lag — unverified).
Direct link `/products/boxcraft-bundle` stays reachable by design.

Released as `boxcraft-bundles-5`; the new scope was approved (via
Chrome, at @adam.bourg's request) on
box-craft-demo. First run failed ("Online Store publication not found"):
catalog titles are really "Channel Catalog <id> for Online Store". Now
matched by channel handle `online_store` (`8db2aff`, test fixture updated
to the real API shape). **Publish path verified for real:** unpublished
the bundle product via the API, reloaded the app → setup republished it
(`UNLISTED`, on Online Store) and checkout still merges into one
"BoxCraft Bundle" line.

## 2026-09-23 — Admin/ops plan: T1 data layer foundation

Started executing `specs/product/admin-and-ops-plan.md` (agent-executable
plan for the merchant admin page, ops console, and D1-backed event/config
data layer). Working through it task by task (T1–T15), committing and
pushing after each.

**T1 done:** `db/migrations/0001_init.sql` (events, shop_config, boxes,
sync_runs tables per D1 in the plan). `shared/events.ts`: pure
`buildEventRow()` (defaults, PII-key rejection via pattern match on
email/name/phone/address/customer, truncates `data` over ~2KB into a
still-valid-JSON wrapper rather than corrupting it) plus `recordEvent()`,
which never throws synchronously — even a PII-rejected or DB-down write
can't break the caller's request (D4). 8 new tests.

**T2 done:** `/check` now records a `check` event per call (`n`,
`compatible`, `unknown` — count of variant ids with no bitmap entry at
all, `ms`) and an `error` event on KV failure (still returns
`failOpen: true`). Accepts an optional `shop` in the request body,
validated against `*.myshopify.com` before recording (D5) — an
invalid or missing value never blocks the response, it's just recorded
as `null`. Found the pre-existing `src/index.ts` imports lacked `.ts`
extensions (fine for wrangler's bundler, but broke direct
`node --test` execution needed to unit-test the fetch handler) — fixed
alongside adding 5 new tests that exercise the handler directly with
mock KV/D1/ctx, including one confirming an unbound `DB` (not yet
provisioned — see T1) degrades to a silent no-op rather than a 500.

Added `[[d1_databases]]` (commented placeholder, same pattern as the KV
namespaces) and `[observability] enabled = true` to all three existing
`wrangler.toml` files. Extended `scripts/setup-cloudflare.mjs` to create
the `boxcraft` D1 database, apply the migration, and wire the real
`database_id` into all three — this needs a real Cloudflare login this
session doesn't have, same reason the KV namespace/secrets steps were
scripted rather than run directly.

**T3 done:** webhook-consumer records a `webhook_inventory` event per
call (`status: "written"` or `"dropped_unknown_item"`), plus an `error`
event if the inventory-item-to-variant-GID KV lookup itself fails
(still accepts the webhook either way). Reads `X-Shopify-Shop-Domain`
for the event's shop. Found `SkuDebouncer`'s constructor used TS
parameter-property syntax, unsupported by Node's strip-only mode —
only surfaced now because a test needed to load `debouncer.ts`
directly for the first time (transitively, via `src/index.ts`); fixed
to plain assignment, no behavior change.

app-backend now records `token_exchange` events (`ok: true/false` +
status on failure) on both the managed-installation token-exchange
path and the direct `/auth/callback` OAuth path, and a `setup` event
(`step: "store_setup"`, `ok`, `error` message on failure) around
`ensureStoreSetup`. 9 new tests across both Workers (4 webhook-consumer,
5 app-backend) covering written/dropped/error paths, token
re-exchange triggering a real setup re-run, and the already-installed
no-op case.

**T4 done — Phase 1 (data layer) complete.** `shared/retention.ts`:
`eventRetentionCutoff()` (pure, 90-day default per D3) and
`pruneOldEvents()` (the actual `DELETE FROM events WHERE ts < ?`),
shared so the daily cron and T14's future "prune events now" ops
action both call the same place instead of duplicating the query.
app-backend gets a `scheduled` handler on a `0 3 * * *` Cron Trigger
(`[triggers]` in its `wrangler.toml`) that calls it via
`ctx.waitUntil`. 4 new tests (cutoff math, the DELETE query/bound
value, and the scheduled handler wiring itself).

**T5 done — Phase 2 started: shop config + boxes API (app-backend).**
`shared/boxes.ts`: the `Box`/`Discount` types and `defaultBox()` used
across app-backend and (later) the Cart Transform/picker.

`shared/d1.ts`: widened the D1 type beyond T1's INSERT-only shape to
also cover `first()`/`all()`, needed for config/box reads. First
attempt typed `bind()` to return itself, which made every existing
mock "missing run/first/all" under tsc even though those methods were
visibly present — a recursive-interface trap. Fixed by splitting into
`D1PreparedStatementLike` (has `bind()`) and a separate
`D1ResultLike` (`run`/`first`/`all`) that `bind()` returns. Mechanically
updated 5 existing test files' mock D1 objects to the fuller shape.

`workers/app-backend/src/`:
- `validate.ts` — pure validation for box input (handle pattern,
  pick-count range, discount shape including strictly-ascending tiered
  percents) and config input (`guardrail_enabled`,
  `unknown_stock_policy`); collects every error, not just the first.
  17 tests.
- `admin-client.ts` — `adminClient()`/`ADMIN_API_VERSION` extracted out
  of `index.ts` so both it and the new API module share one place that
  calls the Admin API.
- `db.ts` — D1 CRUD for `shop_config` and `boxes`
  (get/upsert config, list/upsert/delete box, `seedDefaultBoxIfNone` —
  idempotent, only seeds when a shop has zero boxes). 8 tests against a
  custom in-memory fake D1 (map-based, matches the real query shapes)
  rather than a generic stub, needed to actually exercise upsert/list/
  delete/seed semantics.
- `boxes-metafield.ts` — `writeBoxesMetafields()`: on any box change,
  writes the full current box list to the app-installation metafield
  (`boxcraft.boxes`, what the picker reads) and, if a Cart Transform is
  active, to its own `$app` metafield too (D9/D11 — the function will
  read its private copy in T8 rather than trusting anything from the
  storefront). 4 tests.
- `api.ts` — `handleApi()`, mounted at app-backend's `/api/*`. Every
  route requires a valid App Bridge session token (D14); the shop
  always comes from the verified token, never the request body/query.
  Routes: `GET /api/overview`, `GET`/`PUT /api/config`,
  `GET`/`POST /api/boxes`, `PUT`/`DELETE /api/boxes/:handle`, and a
  `POST /api/sync` stub (501, real implementation in T9). Box
  create/update/delete isn't transactional with the Shopify metafield
  sync — the D1 write always persists; if the sync throws, the
  response is `207` with a `syncError` field instead of failing the
  whole request, since there's no clean cross-service rollback. 13
  tests.

Wired `seedDefaultBoxIfNone` into `ensureShopReady` right after store
setup succeeds, so every shop has a `default` box the first time its
boxes list is read.

122 tests total across all three packages (root 33, webhook-consumer
8, app-backend 81), typecheck clean everywhere.

**T6 done — Guardrail honors per-shop config.** `shared/shop-config.ts`:
`getShopConfig`/`upsertShopConfig` moved here from app-backend's
`db.ts` (which now just re-exports them) so the Guardrail Worker can
read the same `shop_config` table without depending on the app-backend
package. `shared/shop-config-cache.ts`: a small isolate-local cache
(`createShopConfigCache()`/`getCachedShopConfig()`, 60s TTL, keyed by
shop) — built as an injectable interface rather than a bare module-level
`Map` so tests can use an isolated cache per case.

`/check` now looks up the calling shop's config before doing any bitmap
work: `guardrail_enabled=0` short-circuits to
`{compatible:true, disabled:true}` without touching KV at all; a config
read failure fails open (default config) the same way a bitmap read
failure already did, rather than risk blocking a shopper over a D1
outage.

`shared/intersection.ts`: `checkCompatibility()` takes an optional
`UnknownStockPolicy` (`"allow" | "block"`, default `"block"` — matches
the old, only behavior, so existing callers/tests are unaffected), and
`VariantLocations` gained an optional `known` flag. Under `"allow"`
(D6's per-shop default), a variant with no bitmap entry at all is
dropped from the intersection rather than treated as available
nowhere — a product created after the last backfill no longer blocks
every bundle it's added to. Under `"block"`, unknown variants still
block, as before. `src/index.ts` sets `known: false` for exactly the
variants whose KV lookup returned no entry, and passes the shop's
policy through.

12 new tests: 4 for the config cache (null-shop shortcut, TTL hit/miss,
per-shop isolation), 5 for the two policies in `shared/intersection`
(including the plan's own accept criteria: unknown + known variant is
compatible under `allow`, blocked under `block`), 3 end-to-end on the
Worker itself (`disabled:true`, and the allow/block policies wired
through a real `/check` call). 134 tests total across all three
packages (root 45, webhook-consumer 8, app-backend 81), typecheck
clean everywhere.

**T7 done — Picker reads boxes; styling fixes.** The block's Liquid
now looks up `app.metafields.boxcraft.boxes.value` for the box matching
its (new) **Box handle** setting (default `default`) and uses its
title/collection/pick-count/discount instead of the block's own
settings, which now only serve as the fallback for a store with no
boxes configured. Renders `data-shop="{{ shop.permanent_domain }}"`
and `data-box="<handle>"`, and shows a "Save X% on N" line when the
matched box has a `percent` or `tiered` discount (highest tier, via
Liquid's `last` filter — tiers are already validated ascending in
`validate.ts`).

`pick-n-picker.js`: `/check` now sends `shop` alongside `variantIds`
(D5); add-to-cart writes a `_bundle_box` line property (the box
handle) alongside the existing `_bundle_id`/`_bundle_price` — this is
what T8's Cart Transform will key its own price computation off of
instead of trusting `_bundle_price` from the cart. On a successful
add, fires a `bundle_added` beacon via `navigator.sendBeacon` (defaults
to a `text/plain` body — a "simple request", so no CORS preflight, and
the response is never read back) to a new Guardrail Worker route,
`POST /events`.

`/events` (`src/index.ts`): validates the beacon against a strict
schema (`src/bundle-added-event.ts` — exact `type`, a real
`*.myshopify.com` shop, a bounded box handle, an integer item count,
a finite bounded price; anything else is dropped, extra fields are
ignored rather than recorded, so nothing PII-shaped can sneak through
even if a caller tried) and rate-limits per `CF-Connecting-IP` with a
small in-isolate sliding window (`shared/rate-limit.ts` —
`createRateLimiter()`, not distributed, but enough to blunt a single
abusive client hitting an endpoint that needs no auth). Records a
`bundle_added` event (source `picker`) on success.

Added `assets/pick-n-picker.css` (2.2 KB, under the 3 KB budget):
visible `[aria-pressed="true"]` selected state, disabled/blocked
states, a responsive grid.

14 new tests (3 rate-limit, 7 bundle-added-event schema, 3 `/events`
end-to-end on the Guardrail Worker, 1 picker beacon-payload test, plus
the existing `buildAddToCartPayload` test extended to cover
`_bundle_box`). 147 tests across the three Worker packages (root 58,
webhook-consumer 8, app-backend 81), 7 in the picker's own suite, 14
in cart-transform — all passing, typecheck clean. `shopify theme
check` on the extension: clean, no offenses.

**T8 done — Cart Transform computes the price server-side (D10,
D11).** The function's input query drops `cart.lines.cost` and the
`_bundle_price` line attribute entirely — not just "ignores" them,
they're no longer even fetched, so there's nothing left to tamper
with. It now also reads a second cart-transform metafield,
`boxes` (aliased in the query, same `$app`-reserved namespace as the
existing `bundle_parent_variant_id` one — T5's `boxes-metafield.ts`
already writes both), and the line attribute `_bundle_box` the picker
started sending in T7.

`group-bundles.ts`: new `discountPercent(box: BundleBox | undefined,
itemCount: number)` — pure, and the whole price decision now runs
through it rather than a bundleCents-vs-listCents comparison. Unknown
box (deleted, or a stale handle) or a `"none"` discount both return 0
(no price adjustment, merges at list); `"percent"` returns its flat
percent regardless of item count; `"tiered"` returns the highest
tier whose `min_items` the bundle's line count meets (tiers are
already validated strictly ascending by `validate.ts`, so a forward
scan keeping the last match is correct). `BundleBox` is a small type
local to this extension (not imported from `shared/boxes.ts`) so the
Function's bundle stays self-contained rather than reaching outside
the extension directory. The previous cents-based
percentage-from-price-difference math is gone entirely — the percent
now comes straight from the merchant's own box config, so there's no
floating-point drift to guard against the way the old bundleCents/
listCents comparison had to.

Rewrote `group-bundles.test.ts` for the new design: `discountPercent`
directly (unknown/none/percent/tiered, tier boundaries, between
tiers), and `buildCartTransformOperations` end to end (unknown box
handle, no boxes metafield at all, `"none"` box, a tiered box picking
the right tier from line count, and — the D11 point made concrete — a
line object with a smuggled `bundlePrice` field that the function
never reads, proving a tampered `_bundle_price` has zero effect). 20
tests, up from 12, all passing; typecheck clean.

Couldn't complete the plan's own accept check (`shopify app function
build` + `function run` against a replayed real input) from this
sandbox: the CLI's javy/wasm build step downloads
`shopify_functions_javy_v4.wasm` from `cdn.shopify.com`, which this
session's egress policy blocks (403 at the proxy, confirmed via
`/root/.ccr/README.md`'s guidance — an org policy denial, not
something to route around). Deferred to a human checkpoint below;
@adam.bourg previously ran this same build step successfully from a
machine with full network access (see the "Pre-deploy fixes" and
"First end-to-end bundle merge" entries above) — same asset, should
build cleanly there.

**T9 done — Inventory sync in the Worker (D12).** `shared/backfill.ts`:
the GraphQL paging + bitmap-entry-building logic that used to live only
in `scripts/backfill.ts`, now pure and taking an injected `fetchImpl`
so it's usable both from a real Worker (a KV binding, no Cloudflare
REST token) and from the standalone script (still writing through the
REST bulk-KV endpoint, for running outside a Worker entirely).
`scripts/backfill.ts` is now a thin CLI: load env vars, call
`runBackfill()`, POST the resulting entries to Cloudflare's bulk-KV
endpoint — no behavior change, same 26-variants-to-52-KV-entries
result, just the core logic moved out and shared.

`workers/app-backend/src/sync.ts`: `runSync(env, ctx, shop,
accessToken, trigger)` — inserts a `running` `sync_runs` row, calls
`runBackfill`, writes the resulting entries to `LOCATION_BITMAP`
(added as a real binding to app-backend's `wrangler.toml`, same
namespace id the Guardrail Worker and webhook-consumer already use) in
batches of 20 concurrent `put()`s, then closes the row out as `ok`
(with the variant count) or `error` (with the message), and records a
`sync` event either way. Guards against concurrent runs per shop: a
`sync_runs` row still `running` and started within the last 10 minutes
skips the new run rather than stacking it. Every D1 step — the guard
read, the start-row insert, the finish-row update — is independently
best-effort; a D1 outage never stops the KV write itself, matching the
rest of the app's fail-open posture. The row to close out is
identified by `(shop, started_at)` rather than an autoincrement id,
since the minimal `D1Like` type doesn't expose `run().meta.last_row_id`
and that pair is unique enough in practice for this diagnostic data.
`now` and `fetchImpl` are both injectable (default to the real
clock/`fetch`) purely so the 10-minute window and the backfill call
are deterministically testable.

Wired into all three places the plan calls for: `ensureShopReady`
calls it once, right after store setup, so a fresh install gets a
populated bitmap immediately instead of staying fully fail-open until
someone runs the old laptop-only script or the next daily cron;
`POST /api/sync` (previously a 501 stub) now runs it for real and
returns `{status, variants}` or `{status, error}` (502 on error, 200
otherwise); and app-backend's existing `scheduled` handler (T4's prune
cron) now also enumerates every shop in `SHOP_TOKENS` via
`.list({prefix:"shop:"})` and runs a `"cron"`-triggered sync for each —
sequentially, and `runSync` never throws, so one shop's failure can't
stop the rest.

26 new tests: 7 for `shared/backfill.ts` (entry building, zero-quantity
filtering, location sorting, cursor pagination, a variant with no
usable inventory-item id, Admin API HTTP/GraphQL error handling), 5 for
`sync.ts` directly (a full ok run, the concurrent-run guard actually
blocking an in-flight sync via a deferred-fetch stub, the 10-minute
window expiring, a backfill failure recording `error`, and a D1 outage
still completing the KV write), and 2 end-to-end through
`POST /api/sync` in `api.test.ts` (ok with a mocked Admin API response,
502 on failure) — the pre-existing scheduled-handler test's mock
`SHOP_TOKENS` gained a `.list()` implementation to match. 160 tests
across the three Worker packages (root 65, webhook-consumer 8,
app-backend 87), typecheck clean everywhere.

Couldn't run the plan's own accept check (`POST /api/sync` against the
real `box-craft-demo` store, confirming a `sync_runs` row `ok` with
`variants=26` and refreshed KV `updatedAt`s) — this sandbox has no
real Cloudflare/Shopify credentials, and D1 itself isn't provisioned
yet in production either (still a commented-out binding in all three
`wrangler.toml` files, pending the `scripts/setup-cloudflare.mjs` run
noted back in T1). Deferred to the same human checkpoint as the rest
of D1 provisioning.

**T10 done — Orders → bundles sold (D13).** Added `read_orders` to
`shopify.app.toml`'s scopes and `SHOPIFY_SCOPES` in app-backend's
`wrangler.toml` (kept in sync, per that file's existing convention),
plus an `orders/paid` webhook subscription pointed at
webhook-consumer's new `POST /webhooks/orders-paid`. Scope growth
means the next admin load re-exchanges the token and re-runs setup —
already-generic handling from earlier tasks, no new code needed for
that part.

`workers/webhook-consumer/src/orders-paid.ts`:
`computeBundleSaleSummary(payload)` — pure, groups an order's line
items by their `_bundle_id` property (same property the picker sets
on add-to-cart) and returns `{orderId, bundleCount, revenueCents}`, or
`null` for an order with no bundle line items (so the handler records
nothing). `bundleCount` is the number of *distinct* bundle ids in the
order, not the number of bundle line items — an order can contain more
than one bundle. Revenue is summed in integer cents across every
bundle line, same float-avoidance reasoning as the Cart Transform's
old price math. The handler
(`handleOrdersPaidWebhook`) follows the same shape as the existing
`inventory_levels/update` handler: HMAC-verify with
`SHOPIFY_WEBHOOK_SECRET`, parse, and record one `bundle_sold` event
(source `webhook`) — `orderId`/`bundleCount`/`revenueCents` only, no
line item titles or customer data, matching the plan's no-PII rule.

**Open question, not resolved here:** whether `_bundle_id` actually
survives onto an order's line item(s) once the Cart Transform function
has merged a bundle's cart lines into one parent "BoxCraft Bundle"
line (T8) hasn't been checked against a real paid order — nothing in
this session can place one. `computeBundleSaleSummary` groups whatever
line items the webhook payload actually contains, which is correct
either way, but if the merge drops the custom attribute from the
parent line (plausible — Shopify's own docs are unclear on whether
per-component cart attributes promote to the synthesized parent line),
bundle sales would go unrecorded despite bundles still merging and
charging correctly at checkout. Flagged in the code comment; needs a
real test order on `box-craft-demo` after the next `shopify app
deploy` to confirm either way.

11 new tests: 7 for `computeBundleSaleSummary` (no bundles, one bundle
across multiple lines, two distinct bundles, non-bundle lines
excluded, quantity multiplying revenue, a missing `properties` array,
an unparseable price still counting toward `bundleCount` with zero
revenue), 4 for the webhook route itself (a fixture order recording
one event, no bundle lines recording nothing, bad HMAC rejected before
any recording, an unparseable JSON body returning 400). Fixture
payloads carry no customer name, email, or address — order id, line
prices, and the app's own cart properties only. 171 tests across the
three Worker packages (root 65, webhook-consumer 19, app-backend 87),
typecheck clean everywhere.

Per D13 and the plan's own note: order webhooks need Protected
Customer Data approval for an eventual App Store release. Not an issue
on a dev store; carrying this forward to T15's `assumptions.md` update
rather than duplicating it here.

## 2026-09-23 — Admin/ops plan, Phase 3: merchant admin page

**T11 done — Admin page shell + styles.** Replaced the one-paragraph
embedded shell (`handleEmbeddedShell`, from the original OAuth work)
with a real page shell, still plain HTML/CSS/JS per the plan's ground
rules — no React, no build step.

`src/admin/page.ts`: `renderAdminPage({clientId, installed})` — a pure
function returning the full HTML string, easy to unit-test without a
DOM. Header ("BoxCraft"), a setup-failed banner with a Retry button
(shown only when `installed` is false — same condition the old shell's
two-message branch used, now a proper element instead of swapped
text), and five empty card shells (`data-card="setup"`,
`"performance"`, `"boxes"`, `"guardrail"`, `"sync"`) each holding a
"Loading…" placeholder body for T12 to fill in. App Bridge's CDN
script and the `shopify-api-key` meta tag carry over unchanged from
the old shell — still the only third-party script per the ground
rules.

`src/admin/admin.css.ts` / `admin.js.ts`: kept as exported template
strings (like `page.ts`'s HTML) rather than literal `.css`/`.js`
files, specifically so they load identically under both Node's test
runner and wrangler's bundler with no module-rule configuration —
`wrangler.toml`'s `[[rules]]` text-import mechanism would work for
wrangler but silently break `node --experimental-strip-types --test`
trying to parse CSS as JS. Served by two new routes,
`GET /admin.css` / `GET /admin.js`, both with
`Cache-Control: public, max-age=31536000, immutable`; the HTML
references them with a `?v=${ADMIN_ASSET_VERSION}` query string (a
manually bumped constant, not a content hash — no build step to
compute one) so a future asset change invalidates the long cache by
changing the URL rather than needing a shorter max-age.

CSS: system font stack, 16px card radius, subtle borders, admin-like
greys, a 2-column card grid collapsing to 1 column under 768px, and a
`prefers-color-scheme: dark` variant (swapped CSS custom properties
only — trivial, per the plan's own "only if trivial" scoping). Under
2.1 KB.

12 new tests (5 for `renderAdminPage` — all five cards present, the
banner's presence/absence tracking `installed`, the App Bridge
script/meta tag, the versioned asset URLs; 2 for the `/admin.css` and
`/admin.js` routes' content-type and cache headers; the rest from
updating the pre-existing "already installed" test, which asserted on
now-gone literal text, to check for `data-card="setup"` and the
banner's absence instead). 178 tests across the three Worker packages
(root 65, webhook-consumer 19, app-backend 94), typecheck clean
everywhere.

Not verified in this sandbox (no way to load a real embedded app
iframe here): that the page actually renders correctly inside
Shopify's admin iframe. T12's accept criteria already calls for that
check on `box-craft-demo` once the cards have real content — deferring
the visual check to then rather than checking an intentionally
placeholder-only shell twice.

## Where things stand now (updated 2026-09-23, end of day)

### Done and verified on the dev store (`box-craft-demo`)

**v1 bundles work end to end.** Pick-N picker on a product page → live
location check → add to cart → Cart Transform merges the picks into one
"BoxCraft Bundle" line at checkout (verified: $2,779.85, 4 components;
no order placed).

- **Shopify app:** released through `boxcraft-bundles-5`. Registered:
  OAuth redirect, `app/uninstalled` + `inventory_levels/update` webhooks,
  Cart Transform function, Pick-N theme app block. Installed on
  box-craft-demo (managed installation + token exchange).
- **Store setup on install (app-backend):** stores an offline token
  (re-exchanged when scopes grow), creates/finds the "BoxCraft Bundle"
  parent product (`UNLISTED` + published to Online Store), and activates
  the Cart Transform with the parent variant in its `$app` metafield.
- **Location guardrail:** backfill run (26 variants → 52 KV entries);
  `/check` verified live for full/partial/zero overlap and out-of-stock,
  and from the real storefront picker. Public, CORS-enabled, accepts
  numeric or GID variant ids.
- **Storefront:** Savor theme with the Pick-N block on the default
  product template, collection "Automated collection", pick count 4.
- **Cloudflare:** all three Workers live and auto-deploying on push to
  `main` — `box-craft` via Workers Builds (build token replaced after it
  was rolled), `webhook-consumer` + `app-backend` via GitHub Actions
  (`deploy-workers.yml`, tests + typecheck gate each deploy).
- **Tests:** guardrail 17, app-backend 32, cart-transform 14, picker 6,
  webhook-consumer 4 — all passing.

### Left to do

**Next up — agent-executable plan:** `specs/product/admin-and-ops-plan.md`
covers the data layer (D1 events), the merchant admin page (metrics,
boxes + discounts, guardrail settings, inventory sync), and a private
ops console with logs/metrics/debug actions — all plain HTML/CSS/JS. It
resolves the unknown-stock and discount decisions with defaults, fixes a
price-tampering hole (`_bundle_price` trusted from the cart), and moves
backfill into the Worker. Human steps are batched at its end.

**Decisions needed (@adam.bourg)** — details in `assumptions.md`
- **Unknown variants block bundles** instead of failing open (products
  created after the last backfill). Fail open, or resolve via Admin API?
- **Bundle parent's direct URL** (`/products/boxcraft-bundle`) is
  reachable; a shopper could buy the $0 parent alone. Guard it or accept?
- **Bundle discount:** `_bundle_price` is the plain sum, so bundles sell
  at list. What discount model (per tier/setting)?

**Product / UX**
- Picker: no visual selected state on cards; "Number of items to pick"
  change to 2 didn't save in the editor (still 4).
- Embedded admin page redesign (scoped, not started): Polaris look plus
  a setup checklist (token, bundle product, cart transform, backfill,
  theme block with editor deep link), plan info once pricing exists.
  Needs a design pass first.
- Backfill runs by hand from a laptop; it should run automatically at
  install (and periodically) for real merchants.

**Testing gaps**
- Blocked-bundle path in the picker UI (needs a collection containing
  the 3p Fulfilled board); webhook consumer never exercised by a real
  `inventory_levels/update` event; no integration/load tests.
- Search suggestions still listed the UNLISTED bundle product right after
  the change — check it drops out (likely index lag).

**Business / launch**
- Managed Pricing plans (Starter $19, Pro $49) — needs the app's
  distribution method chosen (one-way decision).
- Billing test flow, App Store listing/submission, Go-to-Market — not
  started.
