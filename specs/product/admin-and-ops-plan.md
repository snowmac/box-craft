# BoxCraft — Merchant Admin, Ops Console & Data Layer: Agent Work Plan

2026-09-23 · Written for an agent to execute end to end **without asking
@adam.bourg**. Every decision below is made; each carries a default and a
one-line reason so it can be overridden later. Things that genuinely need
a human are batched in **Human checkpoints** at the end — do everything
else first, then stop there.

Read first: `specs/product/work-log.md` (current state), `assumptions.md`
(open decisions this plan resolves), `technical-spec.md`.

## Goals

1. **Data layer** — record what the app does (guardrail checks, bundles
   added, bundles sold, webhooks, setup/sync runs, errors) so both UIs
   have something to show.
2. **Merchant admin page** — the embedded page at app-backend `GET /`
   becomes a real app home: setup checklist, metrics, and configuration
   (bundle boxes + discounts, guardrail behavior, inventory sync).
3. **Operator console** — a private Cloudflare Worker for @adam.bourg:
   per-store status, event/log explorer, error view, KV inspector, and
   debug actions.

## Ground rules (non-negotiable)

- **Lightweight UI: plain HTML, CSS, vanilla JS.** No React, no Polaris
  React, no bundler, no build step. HTML from template strings in the
  Worker, one small CSS file and one small JS module per surface, served
  by the Worker. App Bridge's CDN script is the only third-party script
  (required for embedded apps). Style the admin page to feel native
  (system font stack, Shopify-admin-like spacing/cards) with hand-written
  CSS.
- **TDD** as in the rest of the repo: pure logic in small modules with
  `node --test` tests; Workers stay thin. Every package's `npm test` and
  `npx tsc --noEmit` must pass before each commit.
- **Commit and push to `main`** after each task (Workers auto-deploy).
  Update `work-log.md` as you go. Commit messages end with the
  Co-Authored-By line used elsewhere in the repo.
- **No PII.** Events never store customer names, emails, addresses, or
  order contents beyond ids, counts and money totals.
- Never print secrets or access tokens in logs, output, or commits.

## Decisions (defaults — override later if wanted)

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | Event/config store | **Cloudflare D1** database `boxcraft`, bound as `DB` to all Workers | SQL for metrics + log queries from both UIs; low volume at this stage |
| D2 | Platform logs | Enable **Workers Logs** (`[observability] enabled = true`) on all 4 Workers; log one JSON object per line | Free searchable logs in the CF dashboard with zero code |
| D3 | Event retention | 90 days, pruned by a daily Cron Trigger | Keeps D1 small |
| D4 | Write path | Events written with `ctx.waitUntil(...)`; a failed event write never fails the request | `/check` latency and fail-open must not regress |
| D5 | Shop identity on `/check` | Picker sends `shop` (from `window.Shopify.shop`) in the body; Worker records it, validates `*.myshopify.com`, still answers if missing | Needed for per-store metrics + config |
| D6 | Unknown-stock policy (resolves open decision) | Per shop, **default `allow`** (fail open): variants with no bitmap entry are ignored in the intersection. Merchant can switch to `block` | Consistent with fail-open elsewhere; avoids new products blocking bundles |
| D7 | Guardrail on/off | Per shop, default **on** | — |
| D8 | Bundle boxes | Merchant defines named **boxes**: `handle`, `title`, `collection` (by handle), `pick_count`, `discount` | "Multiple bundle boxes" requested |
| D9 | Box → storefront | App writes all boxes as JSON to an **app-installation metafield** (`boxcraft.boxes`, type `json`); the Liquid block reads `app.metafields.boxcraft.boxes` and has one setting, **Box handle** (default `default`). Existing block settings stay as fallback when no box matches | Shopify-native, no runtime fetch, works in the theme editor |
| D10 | Discount model | Per box: `none` \| `percent` (one %) \| `tiered` (list of `{min_items, percent}`, highest matching tier wins). Default `none` | Covers common cases; Cart Transform already emits `percentageDecrease` |
| D11 | **Price trust (security fix)** | Cart Transform **stops trusting `_bundle_price`** from the cart. Picker adds `_bundle_box` (box handle) instead; the function reads box discount rules from the **cart transform metafield** (`$app` / `boxes`, JSON, written by app-backend) and computes the % itself. `_bundle_price` stays display-only | Today a shopper can edit the line property and change the price; with discounts that becomes real money |
| D12 | Inventory sync | Move backfill logic into `shared/backfill.ts`; run it (a) during store setup, (b) from **Sync now** in admin, (c) daily Cron on app-backend for every installed shop. app-backend gets a `LOCATION_BITMAP` binding and writes KV directly (no REST token) | Removes the laptop-only manual step |
| D13 | Sales metrics | Subscribe to `orders/paid` (needs `read_orders`); webhook-consumer records `bundle_sold` per order line with `_bundle_id` (order id, bundle count, bundle revenue only) | "Bundles sold / revenue" needs real orders. **Note:** for App Store release, order webhooks require Protected Customer Data approval — fine on dev stores; flag in `assumptions.md` |
| D14 | Merchant API auth | Admin page JS gets a session token via App Bridge (`await shopify.idToken()`), sends `Authorization: Bearer <token>`; server verifies with existing `verifySessionToken` | Standard embedded-app auth; code already exists |
| D15 | Ops console | New Worker `workers/ops-console` (`box-craft-ops`). Auth: `OPS_TOKEN` secret; login form sets an HttpOnly, Secure, SameSite=Strict cookie holding an HMAC of the token; every route checks it. Human checkpoint adds Cloudflare Access on top | Works without dashboard steps; Access is defense in depth |
| D16 | Ops console reach into Shopify | Reads shop tokens from `SHOP_TOKENS` (bind it read-only by convention) to run diagnostic Admin API queries and actions | Needed for "re-run setup", cart transform status |
| D17 | Charts | Tiny inline SVG sparklines/bars drawn by vanilla JS; numbers first | No chart library |

## Data model (D1, `db/migrations/0001_init.sql`)

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- epoch ms
  shop TEXT,                      -- *.myshopify.com, nullable (unknown caller)
  source TEXT NOT NULL,           -- guardrail | picker | webhook | app | cron
  type TEXT NOT NULL,             -- see event types below
  level TEXT NOT NULL DEFAULT 'info', -- info | warn | error
  data TEXT                       -- small JSON, no PII
);
CREATE INDEX events_shop_ts ON events(shop, ts);
CREATE INDEX events_type_ts ON events(type, ts);
CREATE INDEX events_level_ts ON events(level, ts);

CREATE TABLE shop_config (
  shop TEXT PRIMARY KEY,
  guardrail_enabled INTEGER NOT NULL DEFAULT 1,
  unknown_stock_policy TEXT NOT NULL DEFAULT 'allow', -- allow | block
  updated_at INTEGER NOT NULL
);

CREATE TABLE boxes (
  shop TEXT NOT NULL,
  handle TEXT NOT NULL,           -- [a-z0-9-]{1,40}
  title TEXT NOT NULL,
  collection_handle TEXT,
  pick_count INTEGER NOT NULL,    -- 1..20
  discount TEXT NOT NULL DEFAULT '{"type":"none"}', -- JSON per D10
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (shop, handle)
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  trigger TEXT NOT NULL,          -- setup | manual | cron
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  variants INTEGER,
  status TEXT NOT NULL,           -- running | ok | error
  error TEXT
);
```

**Event types:** `check` (data: `n`, `compatible`, `failOpen`,
`unknown`, `ms`), `bundle_added` (`items`, `box`, `listPrice`),
`bundle_sold` (`orderId`, `bundles`, `revenue`, `currency`),
`webhook_inventory` (`written`/`dropped_unknown_item`), `setup`
(`ok`/`error`, `step`), `token_exchange`, `sync` (links `sync_runs.id`),
`error` (any caught exception: `where`, `message`).

## Tasks

Do them in order; each ends with tests passing, commit, push, and a
work-log line. "Verify" steps use `curl`, `wrangler d1 execute --remote`,
and (if the Chrome extension is connected) the browser.

### Phase 1 — Data layer

**T1. D1 database + shared event helper**
- `npx wrangler d1 create boxcraft`; add `[[d1_databases]] binding="DB"`
  to all three existing `wrangler.toml`s; add `db/migrations/0001_init.sql`
  (schema above); apply with `wrangler d1 migrations apply boxcraft --remote`.
- `shared/events.ts`: `recordEvent(db, ctx, {shop, source, type, level?, data})`
  — builds the row, `ctx.waitUntil(db.prepare(...).run().catch(() => {}))`.
  Pure `buildEventRow()` unit-tested (truncates `data` > 2 KB, rejects
  PII-looking keys like `email`, `name`, `address`).
- Add `[observability] enabled = true` to every `wrangler.toml` (D2).
- Accept: tests pass; `wrangler d1 execute boxcraft --remote --command "select count(*) from events"` works.

**T2. Instrument the Guardrail Worker**
- `/check` reads optional `shop`, records a `check` event (D4, D5);
  records `error` on KV failure (still fails open).
- Accept: live `/check` call with `shop` → row visible in D1 within seconds;
  `/check` p50 latency unchanged (compare 20 calls before/after).

**T3. Instrument webhook-consumer and app-backend**
- webhook-consumer: `webhook_inventory` events (written vs dropped unknown item).
- app-backend: `token_exchange`, `setup` (per step, errors with message),
  every caught error → `error` event.
- Accept: reloading the embedded app writes `setup` rows.

**T4. Retention cron** — daily Cron Trigger on app-backend deleting
events older than 90 days (D3). Unit-test the cutoff math.

### Phase 2 — Config + storefront + pricing

**T5. Shop config + boxes API (app-backend)**
- `src/api.ts`: `GET /api/overview`, `GET/PUT /api/config`,
  `GET/POST /api/boxes`, `PUT/DELETE /api/boxes/:handle`,
  `POST /api/sync`. All require a valid session token (D14); shop comes
  from the token, never from the request body.
- Validation module (`src/validate.ts`) with tests: handle format, pick
  count 1–20, discount shape (percent 0–90, tiers sorted, min_items ≥ 1).
- On any box change: write boxes JSON to (a) the app-installation
  metafield `boxcraft.boxes` (D9) and (b) the cart transform metafield
  `$app`/`boxes` (D11). Needs a `currentAppInstallation { id }` lookup.
- Seed: store setup creates a `default` box (pick 4, collection from
  nothing, discount none) if the shop has none.
- Accept: unit tests for validation + metafield payload builders;
  `curl` without a token → 401.

**T6. Guardrail honors per-shop config**
- Guardrail Worker reads `shop_config` for the shop (cache in memory per
  isolate for 60 s). `guardrail_enabled=0` → `{compatible:true, disabled:true}`.
  `unknown_stock_policy='allow'` → variants with no bitmap entry are left
  out of the intersection (D6); `block` keeps today's behavior.
- Tests in `shared/intersection` for both policies.
- Accept: a variant id with no KV entry + a real one → compatible under
  `allow`, blocked under `block`.

**T7. Picker reads boxes; styling fixes**
- Liquid: new setting `box_handle` (text, default `default`); look up
  `app.metafields.boxcraft.boxes.value` for that handle and use its
  collection / pick count / title; fall back to existing settings.
  Render `data-box`, `data-shop="{{ shop.permanent_domain }}"`.
- JS: send `shop` to `/check`; add `_bundle_box` line property; fire a
  `bundle_added` beacon (`navigator.sendBeacon` to guardrail
  `POST /events` with a `text/plain` JSON body so no CORS preflight is
  needed; it accepts only `bundle_added` with a strict schema and
  rate-limits per IP via a simple in-memory window).
- Add `assets/pick-n-picker.css`: visible selected state for
  `[aria-pressed="true"]`, disabled state, blocked message, responsive
  grid. Keep it small (< 3 KB).
- Show the discount in the picker ("Save 10% on 4") when the box has one.
- Accept: picker tests extended; `shopify theme check` clean.

**T8. Cart Transform computes the price (D10, D11)**
- Input query adds `cartTransform { boxes: metafield(key:"boxes") { value } }`
  and line attribute `_bundle_box`; drop reliance on `_bundle_price`.
- `group-bundles.ts`: `discountPercent(box, itemCount)` pure function;
  unknown box or `none` → no price adjustment. Integer math as today.
- Tests: none/percent/tiered, tier boundaries, unknown box, tampered
  `_bundle_price` has no effect.
- Accept: `shopify app function build` + `function run` against a
  replayed real input (see work log) produce the expected %.

**T9. Inventory sync in the Worker (D12)**
- `shared/backfill.ts` (pure: GraphQL paging + entry building, with an
  injected fetch); `scripts/backfill.ts` becomes a thin CLI over it.
- app-backend: bind `LOCATION_BITMAP`; `runSync(shop, trigger)` writes
  KV via binding (batches), records `sync_runs` + `sync` event. Called
  from store setup, `POST /api/sync`, and a daily cron over all shops in
  `SHOP_TOKENS`. Guard against concurrent runs per shop (skip if a
  `running` row < 10 min old).
- Accept: `POST /api/sync` on box-craft-demo → `sync_runs` row `ok`
  with `variants=26`; KV entries' `updatedAt` refreshed.

**T10. Orders → bundles sold (D13)**
- Add `read_orders` scope and `orders/paid` webhook (uri on
  webhook-consumer `/webhooks/orders-paid`) to `shopify.app.toml` and
  `SHOPIFY_SCOPES`. Handler: HMAC verify, group line items by
  `_bundle_id` property, record one `bundle_sold` event per order.
- Tests with a fixture payload (no real customer data in fixtures).
- (Deploy of the scope is a human checkpoint.)

### Phase 3 — Merchant admin page (app-backend `GET /`)

**T11. Page shell + styles**
- `src/admin/page.ts` (HTML template), `src/admin/admin.css`,
  `src/admin/admin.js` served at `/admin.css`, `/admin.js` with long
  cache + version query. App Bridge script + `shopify-api-key` meta stay.
- Layout: header ("BoxCraft"), then cards: **Setup**, **Performance**,
  **Boxes**, **Location guardrail**, **Inventory sync**. Native-feeling
  CSS: system fonts, 16 px radius cards, subtle borders, admin-like
  greys, responsive single column < 768 px. Respect
  `prefers-color-scheme` only if trivial.
- The current "setup didn't finish" state becomes a banner inside the
  page with a Retry button.

**T12. Cards**
- **Setup checklist** (from `/api/overview`): token ✓, bundle product
  published ✓, cart transform active ✓, last inventory sync (time), Pick-N
  block on a live theme (best effort: check the published theme's
  `templates/product.json` via Admin API — if that needs `read_themes`,
  instead show a "Add to theme" deep link:
  `https://{shop}/admin/themes/current/editor?template=product&addAppBlockId={client_id}/pick-n-picker&target=mainSection`).
- **Performance** (7/30-day toggle): bundles added, bundles sold, bundle
  revenue, add→sold conversion, guardrail checks, % blocked, fail-opens.
  Numbers + one sparkline per metric (D17).
- **Boxes**: table + inline form (create/edit/delete), discount editor
  (none / % / tiers), copyable handle.
- **Location guardrail**: on/off toggle, unknown-stock policy radio
  (allow/block) with one-line explanations.
- **Inventory sync**: last run (time, variants, status), **Sync now**
  button (disables while running, polls `/api/overview`).
- Accept: works inside the Shopify admin iframe on box-craft-demo
  (verify via Chrome if connected); all API calls authorized with
  session tokens; no console errors.

### Phase 4 — Operator console (`workers/ops-console`)

**T13. Scaffold + auth**
- New Worker `box-craft-ops`: bindings `DB`, `SHOP_TOKENS`,
  `LOCATION_BITMAP`; secrets `OPS_TOKEN`, `SHOPIFY_CLIENT_SECRET`
  (set via `wrangler secret put`, value from a generated random string
  for `OPS_TOKEN` — write it to the local macOS keychain with
  `security add-generic-password -s box-craft-ops -a adam -w <token>`,
  never print it).
- Login page → cookie (D15). Add the Worker to
  `.github/workflows/deploy-workers.yml`.
- Accept: every route except `/login` and `/health` → 302 to login
  without the cookie; tests for cookie sign/verify.

**T14. Views** (same lightweight HTML/CSS/JS rules)
- **Overview:** all shops (from `SHOP_TOKENS` keys + `shop_config`):
  installed, scopes, setupAt, last sync, 24 h checks / blocked / errors;
  health of the 3 public Workers (`/health` fetched server-side).
- **Store detail:** config, boxes, last 50 events, sync history, cart
  transform + bundle product status (live Admin API query), token scope
  (never the token).
- **Events explorer:** filter by shop, source, type, level, time range;
  paginated; JSON `data` expandable. Auto-refresh toggle (poll 5 s).
- **Errors:** `level='error'` grouped by `where`+`message`, counts,
  first/last seen.
- **KV inspector:** look up a variant (numeric or GID) → bitmap entry;
  look up an inventory item id → mapped variant.
- **Guardrail tester:** paste variant ids + shop → calls live `/check`,
  shows result and which variants lack bitmap data.
- **Actions** (POST + confirm dialog in-page, not `window.confirm`):
  re-run store setup, run sync, force token re-exchange (clears
  `setupAt`), prune events now.
- Accept: each view renders against real D1 data from box-craft-demo.

**T15. Docs** — add an "Operating BoxCraft" section to `work-log.md`
(where logs live, how to reach the console, how to run each action) and
update `assumptions.md` (D6 resolved, D11 security fix, D13 PCD note).

## Human checkpoints (do everything else first, then stop and list these)

1. **`shopify app deploy --allow-updates`** from `shopify-app/` — ships
   the picker (T7), function (T8), and new scope/webhook (T10). Then open
   the BoxCraft app in box-craft-demo admin and approve `read_orders`.
2. **Theme editor:** set the Pick-N block's **Box handle** to `default`
   (or confirm fallback works without it).
3. **GitHub Actions token:** if the D1 deploy fails with a permissions
   error, add **D1: Edit** to the `CLOUDFLARE_API_TOKEN` token in the
   Cloudflare dashboard.
4. **Optional hardening:** in Cloudflare → `box-craft-ops` → Domains →
   enable Cloudflare Access (account members) on the workers.dev URL.
5. **Share the ops console URL** and where the `OPS_TOKEN` is stored
   (keychain entry `box-craft-ops`).

## Out of scope

Managed Pricing / billing, App Store listing, Shopify function-run log
ingestion (Shopify doesn't push these; use `shopify app logs`), load
testing, multi-currency discount display beyond the shop currency.
