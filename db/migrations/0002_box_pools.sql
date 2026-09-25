-- Multi-pool boxes (specs/product/multi-pool-boxes-plan.md, D1). Applied
-- with:
--   npx wrangler d1 migrations apply boxcraft --remote
-- Additive: existing rows keep pools NULL and are read as a single-pool
-- box (shared/boxes.ts's normalizeBox synthesizes pools from the legacy
-- collection_handle/pick_count columns, which stay untouched).

ALTER TABLE boxes ADD COLUMN pools TEXT; -- JSON: [{"collection_handle":"...","count":2}, ...]; NULL = legacy single-pool box
