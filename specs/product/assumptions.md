# BoxCraft — Implementation Assumptions & Open Items

2026-09-22 · Written while implementing the tasks in the BoxCraft
Implementation Tasks doc. Every judgment call made without explicit
sign-off is logged here so it can be reviewed and corrected rather than
silently baked in.

## What was actually buildable in this session

This session has no Shopify Partner account, no dev store, no Cloudflare
account credentials (`wrangler whoami` confirms not authenticated), and no
browser for interactive OAuth. That rules out: running `shopify app init`
or `shopify app generate extension` against a real app, creating KV
namespaces or Durable Object migrations against the real account, running
the backfill script against a real store, and anything in the Billing,
App Store, and Go-to-Market sections of the tasks doc (those need a
Partner account, real merchant data, and human business actions and
weren't attempted at all).

Everything below is pure code: written, unit-tested (40 tests across 5
packages, all passing), and typechecked. The root Guardrail Worker has a
real Cloudflare deploy and a real KV binding as of this session; the other
two Workers and the Shopify app pieces are **not yet deployed or run
against a real Shopify store.**

## Repo layout

```
/                                  Guardrail Worker (deployed as the
                                    "box-craft" Cloudflare project, real
                                    KV binding active)
/shared/                           Pure logic shared across all 3 Workers
/workers/webhook-consumer/         Second Cloudflare Worker, NOT YET
                                    connected to a Cloudflare project —
                                    see "Manual steps" below
/workers/app-backend/              Third Cloudflare Worker: OAuth install
                                    flow, embedded admin shell,
                                    app/uninstalled cleanup. NOT YET
                                    connected to a Cloudflare project.
/scripts/backfill.ts               One-time Admin API -> KV backfill
/shopify-app/                      Hand-scaffolded Shopify app + extensions
  shopify.app.toml
  extensions/cart-transform/       Cart Transform function
  extensions/pick-n-picker/        Theme app extension
```

## Cloudflare deploy pipeline fix (found and fixed mid-build)

Cloudflare's Workers Build started running `npm ci` once we committed a
`package-lock.json`, which failed on their build image (npm 10.9.2) with
"Missing: @types/node@22.20.4 from lock file" — even though the lockfile
was genuinely in sync with `package.json` (`npm ci` succeeds locally on
npm 10.9.7, and regenerating the lockfile from scratch changed nothing but
wrangler's patch version). This looks like an npm-version compatibility
quirk, not a real dependency problem. Fix: stopped committing
`package-lock.json` for all three Worker projects (kept locally,
gitignored) — nothing at deploy time needs it, since `wrangler deploy`
bundles TypeScript itself and fetches its own copy of wrangler fresh via
`npx` regardless of what's in `node_modules`. Without a lockfile present,
Cloudflare's build no longer runs an install step at all.

## App-backend scope decision

The user chose to build a real app-backend Worker rather than rely on
`shopify app dev`'s local tunnel. Its scope turned out smaller than a
generic "OAuth + billing + admin UI" backend would suggest, because the
Product Plan already specifies **Managed Pricing** (Partner
Dashboard-hosted plans) over hand-rolled `AppSubscriptionCreate` calls —
so Shopify hosts the entire plan-selection screen natively during install,
and this Worker never needs to call the Billing API itself. Its actual job
is just: OAuth install (`/auth`, `/auth/callback`), storing the resulting
access token per shop, a minimal embedded admin shell confirming install
succeeded, and cleaning up the stored token on `app/uninstalled`.

## Design decisions made without explicit sign-off

- **Debounce mechanism**: implemented via a Durable Object
  (`SkuDebouncer`, SQLite-backed) with an alarm that resets on every event
  and fires once 3000ms after the last event for that SKU. This was a
  choice between that and a Cloudflare Queue with a batch timeout; the
  Durable Object was picked because it gives an exact one-write-per-window
  guarantee and is simpler to reason about/test than queue batch timing.
  **3000ms is an unvalidated default** — the task doc's own acceptance
  criteria only specifies "under a burst of 50+ events in 5 seconds, 1
  write not 50," which this satisfies, but the real number should come
  from beta merchant webhook volume once available.

- **Bitmap keying gap (found and fixed mid-build)**: the Technical Spec
  keys the bitmap by variant GID, but Shopify's `inventory_levels/update`
  webhook payload only carries `inventory_item_id`, not a variant GID.
  Resolved by having the backfill script also write an
  `inventory_item_id -> variant GID` lookup into the same KV namespace
  (`invitem:{id}` keys), which the webhook consumer reads before writing
  to the bitmap. If no mapping exists yet for a given `inventory_item_id`
  (e.g. a variant created after the last backfill), the webhook consumer
  **drops that event** rather than writing under a guessed key — it relies
  on the next backfill run to catch up. This means: until backfill has run
  at least once, inventory webhooks for brand-new variants are silently
  no-ops.

- **`conflictingVariants` algorithm**: the API contract in the Technical
  Spec doesn't define exactly which variant IDs to return when a selection
  is incompatible. Implemented as: if removing any single variant would
  make the rest compatible, that variant is "the conflict"; otherwise every
  variant in the selection is reported. Not specified anywhere else — worth
  checking it matches what the storefront's blocked-state UI actually wants
  to show shoppers.

- **Fail-open scope**: the Guardrail Worker fails open (`compatible: true`)
  not just on a KV read error, but also implicitly whenever the KV binding
  itself isn't configured at all (calling `.get()` on `undefined` throws,
  which the same try/catch swallows). This means **the guardrail will
  silently always allow everything until the KV namespace is actually
  provisioned and bound** — it won't error loudly to signal
  misconfiguration. Worth deciding if that's the right failure mode for a
  clearly-broken-setup case versus a real runtime outage.

- **Cart Transform placeholder bundle product**: the function reads the
  merged line's `parentVariantId` from a shop metafield,
  `boxcraft.bundle_parent_variant_id`. This namespace/key is my own
  invention — the "Configure placeholder bundle product" task says this
  gets set up once per store at install, but doesn't specify how the
  function should look it up. Whatever writes that metafield during
  install needs to use this exact namespace/key, or the function needs to
  be changed to match.

- **`fixedPricePerUnit` semantics**: implemented so the merged line's
  `fixedPricePerUnit` equals the `_bundle_price` cart attribute directly
  (one bundle = one priced unit), rather than dividing by a summed
  quantity. This matches the acceptance criteria's literal wording ("matches
  `_bundle_price` attribute value exactly") but **the exact quantity/pricing
  semantics of Shopify's `linesMerge` operation haven't been independently
  verified against live Shopify docs or a real deploy** — flagged in
  `run.ts` for re-verification before shipping.

- **Cart Transform JS runtime adapter shape**: `run.ts`'s exported `run(input)`
  function is my best understanding of what Shopify's JS Functions runtime
  (`@shopify/shopify_function`) expects, but wasn't generated from or
  checked against a real `shopify app generate extension` scaffold (no
  Partner-linked app available to generate one from). Re-verify this and
  the `shopify.extension.toml` field names against
  shopify.dev/docs/api/functions and `shopify app function typegen` before
  the first real deploy.

- **Theme extension guardrail wiring**: the app block has a merchant-facing
  "Guardrail Worker URL" text setting that a merchant would have to
  manually paste in. That's almost certainly not the real intended install
  flow (more likely the app should inject this automatically at install
  time via app-embed config), but there's no install flow built yet to
  wire it up differently, so this is a placeholder that at least makes the
  block functional and demoable today.

- **No auth on `/check` or store-scoping**: per the spec's own note ("no
  session, no auth beyond store validation for v1"), but store validation
  itself isn't implemented — the Guardrail Worker currently has no
  concept of which store is calling it, so it can't yet distinguish
  tenants if this is meant to serve multiple stores from one deployment.

- **OAuth state stored in an HttpOnly cookie, not KV**: CSRF protection
  for the OAuth callback uses a signed, short-lived cookie set at `/auth`
  and compared at `/auth/callback`, rather than a server-side session
  store. Simpler and stateless, but means the install flow only works if
  the merchant's browser carries cookies between the two requests
  (true for a normal browser flow, just flagging the assumption).

- **`inventory_item_id -> variant GID` mapping reused nowhere here**: the
  app-backend Worker doesn't touch the bitmap or that mapping at all —
  it's a separate concern (OAuth + token storage only), with its own KV
  namespace (`SHOP_TOKENS`) rather than reusing `LOCATION_BITMAP`. Access
  tokens are secrets; deliberately not mixed into the same namespace as
  the bitmap data.

- **Embedded admin shell is intentionally minimal**: just confirms install
  succeeded and points the merchant at the theme editor to add the Pick-N
  block. No settings UI, since v1 has no merchant-facing config beyond
  what the theme editor already provides (per the Technical Spec). This
  may need to grow once billing/tier state needs to be surfaced somewhere
  merchant-visible.

## Known gaps (explicitly out of scope for what a headless session can do)

- **No live deploy or real-store test** of any of this. All verification
  is unit tests against pure logic; none of it has run inside the actual
  Cloudflare Workers runtime (Miniflare/`vitest-pool-workers`) or a real
  Shopify dev store checkout.
- **No integration or load tests** — the QA tasks calling for a seeded
  KV/D1 fixture tested "against the actual Worker runtime," k6 load
  testing for the guardrail's p95 latency, and webhook consumer load
  testing all need a deployed environment and are not done.
- **Backfill script is untested** against a real Admin API token or a real
  KV namespace — written correctly per Shopify's current (non-deprecated)
  `quantities` API and Cloudflare's KV bulk-write REST endpoint, but never
  actually run.
- **Billing, App Store submission, and Go-to-Market tasks** — not
  attempted. These need a Shopify Partner account, real merchant
  relationships, and business decisions (trial length, which subscription
  app to target for v3) that are the user's to make, not something to
  infer.

## Manual steps needed before any of this goes live

1. ~~Provision the KV namespace.~~ **Done** — `LOCATION_BITMAP` namespace
   id `fd681a5957544826b82e98f16df52950` is now wired into both
   `wrangler.toml` files. Still needed: add the same binding via the
   Cloudflare dashboard (Bindings → Add binding) on the `box-craft`
   Workers project if it isn't picked up automatically from
   `wrangler.toml` on the next deploy.
2. **Deploy `workers/webhook-consumer` and `workers/app-backend`, create
   the `SHOP_TOKENS` namespace, and set all three secrets** —
   `scripts/setup-cloudflare.mjs` automates this entire step. Run
   `npx wrangler login` locally, then:
   ```
   SHOPIFY_CLIENT_SECRET=... SHOPIFY_WEBHOOK_SECRET=... \
     node scripts/setup-cloudflare.mjs
   ```
   It creates the KV namespace, sets secrets, direct-deploys both
   Workers (this creates them on the account even without a Git-connected
   Workers Build project), and wires the resulting app-backend URL into
   both `workers/app-backend/wrangler.toml` and `shopify.app.toml`
   automatically. Still not scriptable even with a Cloudflare login:
   Git-connecting either Worker to a Workers Build project for
   auto-deploy-on-push (dashboard-only, no CLI/API for it) — both are
   live either way via this script's direct deploy, just not
   auto-redeployed on future pushes until you do that one-time dashboard
   step.
3. ~~Register a Shopify Partner app.~~ **Partially done** — real
   `client_id` (`d3f114303ecd6de5e650b4bdb96106f6`) and `dev_store_url`
   (`box-craft-demo.myshopify.com`) are now in `shopify.app.toml`, and
   `application_url`/`redirect_urls` get filled in automatically by
   `setup-cloudflare.mjs` above. Still needed: push that config to the
   real Partner app with `shopify login` + `shopify app deploy` (out of
   scope for a script that assumes only a Cloudflare login) — this
   registers the real redirect URL and the `app/uninstalled` webhook
   subscription with Shopify. Also still open: the Cart Transform
   function's runtime adapter shape in `run.ts` needs verification
   against a real `shopify app generate extension` scaffold or
   `shopify app deploy`.
4. **Set up a dev store with 2+ locations** with split inventory to
   actually exercise the full/partial/zero-overlap guardrail scenarios —
   nothing here has been checked against real Shopify inventory data yet.
5. **Run the backfill script** once the above exist, with real
   `SHOPIFY_ADMIN_ACCESS_TOKEN` / `CLOUDFLARE_API_TOKEN` values, before
   expecting the guardrail to do anything other than fail open.
6. **Configure Managed Pricing** in the Partner Dashboard (Starter
   $19/mo, Pro $49/mo per the Pricing plan) — this is a dashboard
   configuration, not code, and is what makes the plan-selection screen
   appear automatically during install. Nothing in `workers/app-backend`
   needs to change for this.
