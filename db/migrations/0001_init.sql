-- BoxCraft D1 schema. Applied with:
--   npx wrangler d1 migrations apply boxcraft --remote
-- See specs/product/admin-and-ops-plan.md for the design (D1) and
-- specs/product/work-log.md for when this actually ran.

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- epoch ms
  shop TEXT,                      -- *.myshopify.com, nullable (unknown caller)
  source TEXT NOT NULL,           -- guardrail | picker | webhook | app | cron
  type TEXT NOT NULL,             -- see event types in admin-and-ops-plan.md
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
  discount TEXT NOT NULL DEFAULT '{"type":"none"}', -- JSON, see D10
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
