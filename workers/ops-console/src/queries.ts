// T14: read-only D1/KV queries for the console's views. Kept separate from
// app-backend's own data modules (db.ts, performance.ts) even though they
// share the same D1 schema — these query shapes (filtering, pagination,
// error grouping) are specific to what an operator needs to see, not what
// the merchant admin page or the Workers themselves need.
import type { D1Like } from "../../../shared/events.ts";
import { getShopConfig, type ShopConfig } from "../../../shared/shop-config.ts";
import { getLastSyncRun, type LastSyncRun } from "../../app-backend/src/sync.ts";
import { loadPerformanceMetrics } from "../../app-backend/src/performance.ts";

export interface ShopRecord {
	shop: string;
	installedAt: string;
	setupAt?: string;
	scope: string;
}

// SHOP_TOKENS holds the only list of installed shops there is — there's no
// separate "shops" table. Keys are "shop:<domain>".
export async function listShops(shopTokens: KVNamespace): Promise<ShopRecord[]> {
	const shops: ShopRecord[] = [];
	let cursor: string | undefined;
	do {
		const list = await shopTokens.list({ prefix: "shop:", cursor });
		for (const key of list.keys) {
			const record = await shopTokens.get<{ installedAt: string; setupAt?: string; scope: string }>(
				key.name,
				"json",
			);
			if (record) {
				shops.push({ shop: key.name.slice("shop:".length), ...record });
			}
		}
		cursor = list.list_complete ? undefined : list.cursor;
	} while (cursor);
	return shops;
}

export interface OverviewShopRow {
	shop: string;
	installedAt: string;
	setupAt: string | null;
	scope: string;
	config: ShopConfig;
	lastSync: LastSyncRun | null;
	last24h: { guardrailChecks: number; blockedPercent: number; errors: number };
}

const ONE_DAY = 1;

export async function loadOverviewShops(env: { DB: D1Like; SHOP_TOKENS: KVNamespace }): Promise<OverviewShopRow[]> {
	const shops = await listShops(env.SHOP_TOKENS);
	return Promise.all(
		shops.map(async (s) => {
			const [config, lastSync, metrics] = await Promise.all([
				getShopConfig(env.DB, s.shop),
				getLastSyncRun(env.DB, s.shop),
				loadPerformanceMetrics(env.DB, s.shop, ONE_DAY),
			]);
			return {
				shop: s.shop,
				installedAt: s.installedAt,
				setupAt: s.setupAt ?? null,
				scope: s.scope,
				config,
				lastSync,
				last24h: {
					guardrailChecks: metrics.guardrailChecks,
					blockedPercent: metrics.blockedPercent,
					errors: metrics.failOpens,
				},
			};
		}),
	);
}

// Default bound to globalThis: the bare `fetch` reference loses the
// receiver workerd's fetch needs, throwing "Illegal invocation" on every
// call — silently caught below as `false` ("down"), which is why the
// Overview page reported every Worker down despite all three answering
// curl fine (found live, 2026-09-24; see sync.ts's runSync for the same
// bug and why node's tests never catch it).
export async function checkWorkerHealth(url: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<boolean> {
	try {
		const res = await fetchImpl(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
		return res.ok;
	} catch {
		return false;
	}
}

export interface EventRow {
	id: number;
	ts: number;
	shop: string | null;
	source: string;
	type: string;
	level: string;
	data: string | null;
}

export async function getRecentEventsForShop(db: D1Like, shop: string, limit = 50): Promise<EventRow[]> {
	const { results } = await db
		.prepare("SELECT id, ts, shop, source, type, level, data FROM events WHERE shop = ? ORDER BY ts DESC LIMIT ?")
		.bind(shop, limit)
		.all<EventRow>();
	return results;
}

export interface SyncRunRow {
	id: number;
	trigger: string;
	started_at: number;
	finished_at: number | null;
	variants: number | null;
	status: string;
	error: string | null;
}

export async function getSyncHistory(db: D1Like, shop: string, limit = 20): Promise<SyncRunRow[]> {
	const { results } = await db
		.prepare(
			"SELECT id, trigger, started_at, finished_at, variants, status, error FROM sync_runs WHERE shop = ? ORDER BY started_at DESC LIMIT ?",
		)
		.bind(shop, limit)
		.all<SyncRunRow>();
	return results;
}

export interface EventFilters {
	shop?: string;
	source?: string;
	type?: string;
	level?: string;
	sinceMs?: number;
	untilMs?: number;
}

export interface EventPage {
	rows: EventRow[];
	hasMore: boolean;
}

const EVENTS_PAGE_SIZE = 50;

export async function queryEvents(db: D1Like, filters: EventFilters, page: number): Promise<EventPage> {
	const clauses: string[] = [];
	const args: unknown[] = [];

	if (filters.shop) {
		clauses.push("shop = ?");
		args.push(filters.shop);
	}
	if (filters.source) {
		clauses.push("source = ?");
		args.push(filters.source);
	}
	if (filters.type) {
		clauses.push("type = ?");
		args.push(filters.type);
	}
	if (filters.level) {
		clauses.push("level = ?");
		args.push(filters.level);
	}
	if (filters.sinceMs !== undefined) {
		clauses.push("ts >= ?");
		args.push(filters.sinceMs);
	}
	if (filters.untilMs !== undefined) {
		clauses.push("ts <= ?");
		args.push(filters.untilMs);
	}

	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	// Fetch one extra row to know whether there's a next page without a
	// separate COUNT(*) query.
	const offset = Math.max(0, page) * EVENTS_PAGE_SIZE;
	const query = `SELECT id, ts, shop, source, type, level, data FROM events ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`;
	const { results } = await db
		.prepare(query)
		.bind(...args, EVENTS_PAGE_SIZE + 1, offset)
		.all<EventRow>();

	const hasMore = results.length > EVENTS_PAGE_SIZE;
	return { rows: results.slice(0, EVENTS_PAGE_SIZE), hasMore };
}

export interface ErrorGroup {
	where: string;
	message: string;
	count: number;
	firstSeen: number;
	lastSeen: number;
}

// Error events aren't perfectly uniform: the guardrail/webhook ones use
// data.where/data.message, but app-backend's token_exchange/setup/sync
// errors use data.step/data.error (or just a status code) instead — there
// was never one shared error-event schema. Normalized here rather than
// changing every call site, so a genuinely mixed history still groups
// sensibly instead of dumping everything into one "undefined/undefined"
// bucket.
function normalizeErrorKey(row: { type: string; data: string | null }): { where: string; message: string } {
	let parsed: Record<string, unknown> = {};
	if (row.data) {
		try {
			parsed = JSON.parse(row.data) as Record<string, unknown>;
		} catch {
			// fall through with parsed = {}
		}
	}
	const where = (parsed.where as string) ?? (parsed.step as string) ?? row.type;
	const message =
		(parsed.message as string) ??
		(parsed.error as string) ??
		(parsed.status !== undefined ? `status ${parsed.status}` : "(no message)");
	return { where, message };
}

export async function getErrorGroups(db: D1Like, sinceMs: number): Promise<ErrorGroup[]> {
	const { results } = await db
		.prepare("SELECT ts, type, data FROM events WHERE level = 'error' AND ts >= ? ORDER BY ts ASC")
		.bind(sinceMs)
		.all<{ ts: number; type: string; data: string | null }>();

	const groups = new Map<string, ErrorGroup>();
	for (const row of results) {
		const { where, message } = normalizeErrorKey(row);
		const key = `${where}\u0000${message}`;
		const existing = groups.get(key);
		if (existing) {
			existing.count++;
			existing.lastSeen = row.ts;
		} else {
			groups.set(key, { where, message, count: 1, firstSeen: row.ts, lastSeen: row.ts });
		}
	}
	return [...groups.values()].sort((a, b) => b.count - a.count);
}
