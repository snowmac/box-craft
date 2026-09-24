# BoxCraft — Multi-Pool Boxes: Agent Work Plan

2026-09-24 · Written for an agent to execute end to end **without asking
@adam.bourg**. Every decision below is made; each carries a default and a
one-line reason so it can be overridden later. Things that genuinely need
a human are batched in **Human checkpoints** at the end — do everything
else first, then stop there.

Read first: `specs/product/work-log.md` (current state — this plan starts
from the state as of "D1 provisioned; admin page went from stuck to fully
live" / the `Illegal invocation` fix, 2026-09-24), `specs/product/
admin-and-ops-plan.md` (the boxes feature this extends), `assumptions.md`.

## Problem

Today a **box** (`shared/boxes.ts`) has exactly one pool: pick N items
from one collection. That covers "pick any 4 from this collection" but
not "pick 2 from Collection A *and* 1 from Collection B in the same
bundle" — e.g. a coffee shop's "2 light roasts + 1 medium roast" bundle,
or Panera's "pick a soup and a sandwich." This plan adds **multi-pool
boxes**: a box becomes a list of `{collection, count}` pools, each with
its own required exact count, all merged into one bundle line at
checkout.

## Goals

1. A box can define 1–5 pools, each pointing at a collection with its own
   required pick count (1–20 items), instead of a single collection +
   count.
2. The storefront picker renders one section per pool, gates "Add Bundle"
   on every pool's count being met exactly, and still runs one guardrail
   check and produces one bundle across the combined selection.
3. Existing single-pool boxes (including the seeded `default` box) keep
   working with zero merchant action — they're read as a one-pool box.
4. Cart Transform pricing/discount logic needs no changes: pools are new
   *input*, but the total item count and discount tiers work exactly as
   they do today.

## Ground rules (same as `admin-and-ops-plan.md` — non-negotiable)

- Lightweight UI: plain HTML/CSS/vanilla JS, no build step, no framework.
- TDD: pure logic in small modules with `node --test`; Workers stay thin.
  Every package's `npm test` and `npx tsc --noEmit` must pass before each
  commit.
- Commit and push to `main` after each task (Workers auto-deploy). Update
  `work-log.md` as you go. Commit messages end with the Co-Authored-By
  line used elsewhere in the repo.
- No PII. Never print secrets or access tokens.
- `shopify theme check` must stay clean after any theme-extension change.

## Decisions (defaults — override later if wanted)

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | Data model | `boxes` table gets a new nullable `pools` TEXT column (JSON: `[{collection_handle, count}]`). Existing `collection_handle`/`pick_count` columns stay — untouched for any row that predates this plan | Additive migration, zero risk to the live `default` box; no forced backfill |
| D2 | Legacy synthesis | Any box read with `pools IS NULL` is synthesized in code as a single-pool box: `pools = [{collection_handle, count: pick_count}]`. Every consumer (API, metafield writer, admin UI, picker) only ever sees `pools` — there is no separate legacy code path past `shared/boxes.ts` | One normalization point, not one per consumer |
| D3 | Caps | 1–5 pools per box; 1–20 items per pool; total (sum of pool counts) ≤ 20, same ceiling as today's single-pool `pick_count` | Keeps the picker UI and Cart Transform math within already-tested ranges |
| D4 | `pick_count` stays authoritative downstream | Always stored/derived as `sum(pool.count)`. Metafields, discount tier math (`min_items`), and events keep using `pick_count` exactly as today | Cart Transform's `group-bundles.ts` and the events schema need **zero changes** |
| D5 | Metafield shape | Both `boxcraft.boxes` (app-installation) and the Cart Transform's `$app/boxes` metafield gain a `pools` array per box, alongside the existing `title`/`pick_count`/`discount`/`collection_handle` fields (the last two kept in sync as `pools[0]`/derived sum for anything still reading them) | Additive JSON — nothing existing breaks |
| D6 | Picker rendering | Liquid renders one grid section per pool: its own heading (the pool's collection title) and its own "`x / count` selected" counter. A legacy single-pool box (from D2's synthesis) renders as one section, visually identical to today | Matches the mental model of "pick 2 here, 1 there" |
| D7 | Picker selection state | `Map<poolIndex, Map<variantId, {price}>>`. "Add Bundle" enables only when **every** pool's selected size equals its required count. Guardrail check and cart payload flatten all pools into one variant-id list — unchanged from today past that point | The guardrail and Cart Transform already operate on a flat id list; no reason to teach them about pools |
| D8 | Admin UI | Boxes card's create/edit form replaces the single collection-handle/pick-count fields with a repeatable pool editor (collection handle + count per row, Add pool/Remove pool, capped at 5 client-side) | Matches D3 |
| D9 | Cart Transform / Guardrail Worker | No code changes. Add regression tests only, confirming a pools-shaped box metafield doesn't change discount or merge behavior | D4/D5 make this true by construction; tests prove it stays true |

## Data model change

```sql
-- db/migrations/0002_box_pools.sql
ALTER TABLE boxes ADD COLUMN pools TEXT; -- JSON: [{"collection_handle":"...","count":2}, ...]; NULL = legacy single-pool box
```

`shared/boxes.ts` additions:

```ts
export interface Pool {
  collection_handle: string;
  count: number; // 1..20
}

export interface Box {
  // ...existing fields unchanged...
  pools: Pool[]; // always populated — see normalizeBox
}

// Reads a raw D1 row (pools possibly null) and returns a Box with pools
// always populated per D2. The single source of legacy synthesis.
export function normalizeBox(row: BoxRow): Box;

export function totalPickCount(pools: Pool[]): number; // sum of counts, D4
```

## Tasks

Do them in order; each ends with tests passing, commit, push, and a
work-log line.

### T1. Data layer: migration + `shared/boxes.ts`

- Add `db/migrations/0002_box_pools.sql` (the `ALTER TABLE` above).
- Add `Pool` type, `normalizeBox()`, `totalPickCount()` to
  `shared/boxes.ts`. Unit tests: a row with `pools` set round-trips; a row
  with `pools: null` synthesizes `[{collection_handle, count: pick_count}]`
  from the legacy columns; `totalPickCount` sums correctly.
- Accept: `npm test` green; migration applies locally against a throwaway
  D1 (`wrangler d1 execute boxcraft --local --file=db/migrations/0002_box_pools.sql`
  in whichever package's `wrangler.toml` binds `DB`).

### T2. Validation

- Extend `workers/app-backend/src/validate.ts`: `validatePools(pools)` —
  array length 1–5, each `collection_handle` a non-empty string, each
  `count` an integer 1–20, sum ≤ 20 (D3). `validateBoxInput` now requires
  `pools` (the admin UI is being rewritten in T4 to always send it) and
  drops the old direct `collection_handle`/`pick_count` requirement —
  those become derived, not merchant-supplied.
- Unit tests: every rejection case (empty pools, >5 pools, count out of
  range, sum > 20, non-string handle) plus the happy path.
- Accept: `npm test` + `npx tsc --noEmit` green in `workers/app-backend`.

### T3. Boxes API + metafield writer

- `workers/app-backend/src/api.ts`: `POST /api/boxes` / `PUT
  /api/boxes/:handle` accept `pools`, validate via T2, store `pools` as
  JSON in the new column, and set `collection_handle`/`pick_count` from
  `pools[0].collection_handle` / `totalPickCount(pools)` (D4/D5 — keeps
  every other reader working unmodified). `GET /api/boxes` returns
  `normalizeBox()`'d rows (`pools` always present).
- `workers/app-backend/src/boxes-metafield.ts`: include `pools` in both
  the `boxcraft.boxes` and cart-transform metafield JSON payloads it
  builds.
- Tests: API round-trip (POST with pools → GET reflects it, including a
  legacy row without pools reading back synthesized); metafield payload
  builder includes `pools` and unchanged `pick_count`/`discount`/`title`.
- Accept: `npm test` + `npx tsc --noEmit` green; a `curl` (or test) POST
  with 2 pools returns 200 and the stored row round-trips.

### T4. Admin UI: pool editor

- `workers/app-backend/src/admin/admin.js` / `admin.css`: replace the
  Boxes card's single collection-handle/pick-count inputs with a
  repeatable pool row: `[collection handle text input] [count number
  input] [Remove]`, an "Add pool" button (disabled at 5 rows, per D3),
  and client-side validation mirroring T2 before submit.
- Existing boxes with no `pools` (synthesized) render as one pre-filled
  pool row when opened for edit — editing and saving upgrades that row to
  a real `pools` value going forward.
- Tests: existing `admin-js-syntax`/`admin-page` test style — pool-row
  add/remove DOM behavior, submit payload shape. Manual verify: open the
  admin page on `box-craft-demo` (Chrome, if connected), edit the seeded
  `default` box into a 2-pool box, confirm it saves and reloads correctly.
- Accept: tests green; manual edit round-trips on the real store.

### T5. Picker: Liquid + JS multi-pool rendering

- `shopify-app/extensions/pick-n-picker/blocks/pick-n-picker.liquid`:
  loop `boxcraft_box.pools` (or the block-setting fallback treated as a
  single pool, per D6) rendering one `<section>` per pool — heading =
  `collections[pool.collection_handle].title`, its own item grid (same
  markup as today, scoped to that pool), its own `x / count` counter.
  Root element gets the pools' collection handles/counts serialized into
  a `<script type="application/json" data-boxcraft-pools>` block for the
  JS to read (avoids fragile multi-value data-attributes).
- `pick-n-picker.js`: rework selection state to `Map<poolIndex,
  Map<variantId, {price}>>` per D7. "Add Bundle" enabled only when every
  pool is exactly full. Guardrail check and `/cart/add.js` payload
  flatten across all pools (concat every pool's selected variant ids) —
  `computeBundleTotal`/`buildAddToCartPayload` take the flattened
  selection exactly as they do today, so those functions are unchanged;
  only the DOM-wiring layer (`initPicker`) changes.
- CSS: pool section spacing/heading style, small addition to
  `pick-n-picker.css`.
- Tests: extend `shopify-app/test/pick-n-picker/picker-logic.test.ts`
  with multi-pool scenarios (partial pools don't enable Add; exactly-full
  pools do; flattened payload has one entry per selected variant across
  all pools). `shopify theme check` clean.
- Accept: tests green; `shopify theme check` clean; on a `shopify app
  function run`-style local check or (better) the real dev store, a
  2-pool box (e.g. 2 items from Collection A + 1 from Collection B)
  renders as two sections and only enables Add once both are full.

### T6. Cart Transform / Guardrail regression tests (D9)

- No production code change expected. Add a test in
  `shopify-app/extensions/cart-transform/test/group-bundles.test.ts`
  feeding a pools-shaped box (from the cart-transform metafield JSON)
  through `discountPercent`/the merge logic, asserting identical output
  to the single-pool equivalent with the same `pick_count`/`discount`.
  Add a guardrail intersection test with variant ids drawn from two
  different "pools" (just a flat id list to the guardrail — confirms
  nothing here needs to know about pools).
- Accept: new tests pass without touching non-test files. If a test
  fails, that's a real finding — stop and fix the actual code (should not
  happen per D4/D5's design, but verify rather than assume).

### T7. Docs

- `work-log.md`: entry for this plan's execution, same style as the
  admin-and-ops-plan.md entries.
- `assumptions.md`: note the pool cap (D3), and that a box created before
  this plan keeps working unmigrated (D2) until a merchant re-saves it.

## Human checkpoints (do everything else first, then stop and list these)

1. **`shopify app deploy --allow-updates`** from `shopify-app/` — ships
   the picker's multi-pool Liquid/JS/CSS (T5). Expect the same kind of
   review/validation pass as prior deploys.
2. **D1 migration**: `npx wrangler d1 migrations apply boxcraft --remote`
   for `0002_box_pools.sql` — schema-only `ALTER TABLE ADD COLUMN`, safe,
   but still a live-database action for @adam.bourg to run, same as
   `0001_init.sql` was.
3. **Real multi-pool verification on `box-craft-demo`**: create two small
   test collections (e.g. "Light Roast", "Medium Roast" with a couple of
   products each), build a 2-pool box in the admin UI (2 from Light + 1
   from Medium), add the block to a product page, and confirm: the
   picker renders two sections, Add Bundle only enables once both pools
   are full, and checkout merges all 3 into one bundle line at the
   correct (undiscounted-by-default) price.
4. **Theme editor**: if this box uses a different handle than `default`,
   set the Pick-N block's Box handle setting to match, same as before.

## Out of scope

- Optional pools (today every pool is required — no "pick 2 from A, and
  optionally 1 more from B"). 
- Per-pool discounts (discount stays one rule for the whole box, applied
  to the total item count, per D4).
- Reordering/renaming pools after creation beyond simple edit-and-resave.
- Any change to the location guardrail's compatibility logic — it
  already treats the bundle as a flat variant list and needs none.
