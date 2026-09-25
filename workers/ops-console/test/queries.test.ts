import { test } from "node:test";
import assert from "node:assert/strict";
import {
	queryEvents,
	getErrorGroups,
	checkWorkerHealth,
	listShops,
	getRecentEventsForShop,
	getSyncHistory,
} from "../src/queries.ts";
import type { D1Like } from "../../../shared/events.ts";
import type { KVLike } from "../../../shared/kv.ts";

function eventRow(overrides: Partial<{ id: number; ts: number; shop: string | null; source: string; type: string; level: string; data: string | null }> = {}) {
	return {
		id: 1,
		ts: 1000,
		shop: "box-craft-demo.myshopify.com",
		source: "guardrail",
		type: "check",
		level: "info",
		data: null,
		...overrides,
	};
}

function fakeD1ForEvents(rows: ReturnType<typeof eventRow>[]) {
	const calls: { query: string; args: unknown[] }[] = [];
	const db: D1Like = {
		prepare: (query: string) => ({
			bind: (...args: unknown[]) => ({
				run: async () => {},
				first: async () => null,
				all: async <T>() => {
					calls.push({ query, args });
					// Very small fake query engine: apply WHERE clauses in the
					// same order queryEvents builds them, then LIMIT/OFFSET.
					let filtered = rows;
					let argIndex = 0;
					const whereMatch = query.match(/WHERE (.+) ORDER BY/);
					if (whereMatch) {
						const conditions = whereMatch[1].split(" AND ");
						for (const cond of conditions) {
							const value = args[argIndex++];
							const field = cond.split(" ")[0] as keyof ReturnType<typeof eventRow>;
							if (cond.includes(">=")) {
								filtered = filtered.filter((r) => (r.ts as number) >= (value as number));
							} else if (cond.includes("<=")) {
								filtered = filtered.filter((r) => (r.ts as number) <= (value as number));
							} else {
								filtered = filtered.filter((r) => r[field] === value);
							}
						}
					}
					const limit = args[argIndex] as number;
					const offset = args[argIndex + 1] as number;
					return { results: filtered.slice(offset, offset + limit) as T[] };
				},
			}),
		}),
	};
	return { db, calls };
}

test("queryEvents returns all rows and hasMore=false when under a page", async () => {
	const { db } = fakeD1ForEvents([eventRow({ id: 1 }), eventRow({ id: 2 })]);
	const page = await queryEvents(db, {}, 0);
	assert.equal(page.rows.length, 2);
	assert.equal(page.hasMore, false);
});

test("queryEvents reports hasMore=true when there's a next page", async () => {
	const rows = Array.from({ length: 51 }, (_, i) => eventRow({ id: i }));
	const { db } = fakeD1ForEvents(rows);
	const page = await queryEvents(db, {}, 0);
	assert.equal(page.rows.length, 50);
	assert.equal(page.hasMore, true);
});

test("queryEvents filters by shop, source, type, and level together", async () => {
	const { db } = fakeD1ForEvents([
		eventRow({ id: 1, shop: "a.myshopify.com", source: "guardrail", type: "check", level: "info" }),
		eventRow({ id: 2, shop: "b.myshopify.com", source: "guardrail", type: "check", level: "info" }),
		eventRow({ id: 3, shop: "a.myshopify.com", source: "webhook", type: "check", level: "info" }),
	]);
	const page = await queryEvents(db, { shop: "a.myshopify.com", source: "guardrail" }, 0);
	assert.equal(page.rows.length, 1);
	assert.equal(page.rows[0].id, 1);
});

test("queryEvents applies a time range filter", async () => {
	const { db } = fakeD1ForEvents([eventRow({ id: 1, ts: 100 }), eventRow({ id: 2, ts: 5000 })]);
	const page = await queryEvents(db, { sinceMs: 1000, untilMs: 10000 }, 0);
	assert.equal(page.rows.length, 1);
	assert.equal(page.rows[0].id, 2);
});

test("queryEvents pages using LIMIT/OFFSET based on the page number", async () => {
	const rows = Array.from({ length: 120 }, (_, i) => eventRow({ id: i }));
	const { db } = fakeD1ForEvents(rows);
	const page1 = await queryEvents(db, {}, 1);
	assert.equal(page1.rows[0].id, 50);
});

test("getErrorGroups groups guardrail/webhook-shaped errors by where+message", async () => {
	const db = fakeD1ForErrors([
		{ ts: 100, type: "error", data: JSON.stringify({ where: "check", message: "bitmap read failed" }) },
		{ ts: 200, type: "error", data: JSON.stringify({ where: "check", message: "bitmap read failed" }) },
		{ ts: 300, type: "error", data: JSON.stringify({ where: "shop_config", message: "config read failed" }) },
	]);
	const groups = await getErrorGroups(db, 0);
	assert.equal(groups.length, 2);
	const bitmapGroup = groups.find((g) => g.where === "check");
	assert.equal(bitmapGroup?.count, 2);
	assert.equal(bitmapGroup?.firstSeen, 100);
	assert.equal(bitmapGroup?.lastSeen, 200);
});

test("getErrorGroups normalizes app-backend's step/error-shaped errors too", async () => {
	const db = fakeD1ForErrors([
		{ ts: 100, type: "setup", data: JSON.stringify({ step: "store_setup", ok: false, error: "cartTransformCreate failed" }) },
	]);
	const groups = await getErrorGroups(db, 0);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].where, "store_setup");
	assert.equal(groups[0].message, "cartTransformCreate failed");
});

test("getErrorGroups falls back to a status-shaped message when there's no message or error field", async () => {
	const db = fakeD1ForErrors([{ ts: 100, type: "token_exchange", data: JSON.stringify({ ok: false, status: 401 }) }]);
	const groups = await getErrorGroups(db, 0);
	assert.equal(groups[0].message, "status 401");
	assert.equal(groups[0].where, "token_exchange");
});

test("getErrorGroups sorts by count descending", async () => {
	const db = fakeD1ForErrors([
		{ ts: 1, type: "error", data: JSON.stringify({ where: "a", message: "x" }) },
		{ ts: 2, type: "error", data: JSON.stringify({ where: "b", message: "y" }) },
		{ ts: 3, type: "error", data: JSON.stringify({ where: "b", message: "y" }) },
		{ ts: 4, type: "error", data: JSON.stringify({ where: "b", message: "y" }) },
	]);
	const groups = await getErrorGroups(db, 0);
	assert.equal(groups[0].where, "b");
	assert.equal(groups[0].count, 3);
});

function fakeD1ForErrors(rows: Array<{ ts: number; type: string; data: string | null }>): D1Like {
	return {
		prepare: () => ({
			bind: () => ({
				run: async () => {},
				first: async () => null,
				all: async <T>() => ({ results: rows as unknown as T[] }),
			}),
		}),
	};
}

test("checkWorkerHealth returns true for a 200 /health response", async () => {
	const fetchImpl = (async () => new Response("ok", { status: 200 })) as typeof fetch;
	assert.equal(await checkWorkerHealth("https://example.workers.dev", fetchImpl), true);
});

test("checkWorkerHealth returns false for a non-ok response", async () => {
	const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
	assert.equal(await checkWorkerHealth("https://example.workers.dev", fetchImpl), false);
});

test("checkWorkerHealth returns false rather than throwing on a network error", async () => {
	const fetchImpl = (async () => {
		throw new Error("network down");
	}) as typeof fetch;
	assert.equal(await checkWorkerHealth("https://example.workers.dev", fetchImpl), false);
});

test("listShops reads shop records from SHOP_TOKENS by prefix", async () => {
	const store = new Map<string, unknown>([
		["shop:a.myshopify.com", { installedAt: "x", scope: "read_x" }],
		["shop:b.myshopify.com", { installedAt: "y", scope: "read_y", setupAt: "z" }],
	]);
	const kv = {
		async list({ prefix }: { prefix?: string }) {
			const keys = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name }));
			return { keys, list_complete: true, cursor: undefined };
		},
		async get(key: string) {
			return store.get(key) ?? null;
		},
	} as unknown as KVLike;

	const shops = await listShops(kv);
	assert.equal(shops.length, 2);
	assert.deepEqual(
		shops.map((s) => s.shop).sort(),
		["a.myshopify.com", "b.myshopify.com"],
	);
});

test("getRecentEventsForShop scopes the query to the shop and orders newest first", async () => {
	const seen: unknown[] = [];
	const db: D1Like = {
		prepare: (query: string) => ({
			bind: (...args: unknown[]) => ({
				run: async () => {},
				first: async () => null,
				all: async <T>() => {
					seen.push({ query, args });
					return { results: [] as T[] };
				},
			}),
		}),
	};
	await getRecentEventsForShop(db, "a.myshopify.com", 25);
	const call = seen[0] as { query: string; args: unknown[] };
	assert.match(call.query, /ORDER BY ts DESC/);
	assert.deepEqual(call.args, ["a.myshopify.com", 25]);
});

test("getSyncHistory scopes the query to the shop", async () => {
	const seen: unknown[] = [];
	const db: D1Like = {
		prepare: (query: string) => ({
			bind: (...args: unknown[]) => ({
				run: async () => {},
				first: async () => null,
				all: async <T>() => {
					seen.push({ query, args });
					return { results: [] as T[] };
				},
			}),
		}),
	};
	await getSyncHistory(db, "a.myshopify.com");
	const call = seen[0] as { query: string; args: unknown[] };
	assert.match(call.query, /FROM sync_runs WHERE shop = \?/);
	assert.equal(call.args[0], "a.myshopify.com");
});
