import { test } from "node:test";
import assert from "node:assert/strict";
import { runSync, getLastSyncRun, type SyncEnv } from "../src/sync.ts";
import type { KVLike } from "../../../shared/kv.ts";

const SHOP = "box-craft-demo.myshopify.com";

interface FakeRow {
	shop: string;
	trigger: string;
	started_at: number;
	finished_at: number | null;
	variants: number | null;
	status: string;
	error: string | null;
}

function fakeD1() {
	const rows: FakeRow[] = [];
	return {
		db: {
			prepare(query: string) {
				return {
					bind(...args: unknown[]) {
						return {
							async run() {
								if (query.includes("INSERT INTO sync_runs")) {
									const [shop, trigger, started_at] = args as [string, string, number];
									rows.push({ shop, trigger, started_at, finished_at: null, variants: null, status: "running", error: null });
								} else if (query.includes("UPDATE sync_runs") && query.includes("status = 'ok'")) {
									const [finished_at, variants, shop, started_at] = args as [number, number, string, number];
									const row = rows.find((r) => r.shop === shop && r.started_at === started_at && r.status === "running");
									if (row) {
										row.finished_at = finished_at;
										row.variants = variants;
										row.status = "ok";
									}
								} else if (query.includes("UPDATE sync_runs") && query.includes("status = 'error'")) {
									const [finished_at, error, shop, started_at] = args as [number, string, string, number];
									const row = rows.find((r) => r.shop === shop && r.started_at === started_at && r.status === "running");
									if (row) {
										row.finished_at = finished_at;
										row.error = error;
										row.status = "error";
									}
								}
							},
							async first<T>() {
								if (query.includes("FROM sync_runs")) {
									const [shop, cutoff] = args as [string, number];
									const match = rows.find((r) => r.shop === shop && r.status === "running" && r.started_at > cutoff);
									return (match ? { id: 1 } : null) as T | null;
								}
								return null;
							},
							async all<T>() {
								return { results: [] as T[] };
							},
						};
					},
				};
			},
		},
		rows,
	};
}

function fakeKv() {
	const puts: Array<{ key: string; value: string }> = [];
	return {
		kv: {
			async put(key: string, value: string) {
				puts.push({ key, value });
			},
		} as unknown as KVLike,
		puts,
	};
}

function mockCtx() {
	const waited: Promise<unknown>[] = [];
	return { waitUntil: (p: Promise<unknown>) => waited.push(p), waited };
}

function backfillFetch(variantCount = 1): typeof fetch {
	return (async () =>
		Response.json({
			data: {
				productVariants: {
					pageInfo: { hasNextPage: false, endCursor: null },
					edges: Array.from({ length: variantCount }, (_, i) => ({
						node: {
							id: `gid://shopify/ProductVariant/${i}`,
							inventoryItem: {
								id: `gid://shopify/InventoryItem/${i}`,
								inventoryLevels: {
									pageInfo: { hasNextPage: false, endCursor: null },
									edges: [{ node: { location: { id: "gid://shopify/Location/1" }, quantities: [{ name: "available", quantity: 1 }] } }],
								},
							},
						},
					})),
				},
			},
		})) as typeof fetch;
}

test("a fresh sync writes KV entries and records an ok sync_runs row and event", async () => {
	const { db, rows } = fakeD1();
	const { kv, puts } = fakeKv();
	const ctx = mockCtx();
	const env: SyncEnv = { DB: db, LOCATION_BITMAP: kv };

	const result = await runSync(env, ctx, SHOP, "tok", "manual", () => 1000, backfillFetch(2));

	assert.deepEqual(result, { status: "ok", variants: 2 });
	assert.equal(puts.length, 4); // 2 variants x (bitmap entry + inventory-item entry)
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "ok");
	assert.equal(rows[0].variants, 2);
	await Promise.all(ctx.waited);
});

// A fetch stub whose promise the test controls directly, so a "still
// running" sync can be held open for exactly as long as a test needs
// without leaving a dangling unresolved promise behind afterward.
function deferredFetch(): { fetchImpl: typeof fetch; resolve: () => void } {
	let resolveFn!: (r: Response) => void;
	const fetchImpl = (() => new Promise<Response>((resolve) => (resolveFn = resolve))) as unknown as typeof fetch;
	return {
		fetchImpl,
		resolve: () =>
			resolveFn(
				Response.json({
					data: { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
				}),
			),
	};
}

test("an in-flight run blocks a concurrent one for the same shop", async () => {
	const { db, rows } = fakeD1();
	const { kv } = fakeKv();
	const ctx = mockCtx();
	const env: SyncEnv = { DB: db, LOCATION_BITMAP: kv };

	const { fetchImpl, resolve } = deferredFetch();
	const firstRun = runSync(env, ctx, SHOP, "tok", "manual", () => 1000, fetchImpl);

	// Give the first run's INSERT a tick to land before starting the second.
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "running");

	const second = await runSync(env, ctx, SHOP, "tok", "manual", () => 1000 + 60_000, backfillFetch());
	assert.deepEqual(second, { status: "skipped" });

	resolve();
	await firstRun;
});

test("a run more than 10 minutes old no longer blocks a new one", async () => {
	const { db } = fakeD1();
	const { kv } = fakeKv();
	const ctx = mockCtx();
	const env: SyncEnv = { DB: db, LOCATION_BITMAP: kv };

	const { fetchImpl, resolve } = deferredFetch();
	const firstRun = runSync(env, ctx, SHOP, "tok", "manual", () => 1000, fetchImpl);
	await new Promise((r) => setTimeout(r, 0));

	const second = await runSync(env, ctx, SHOP, "tok", "manual", () => 1000 + 11 * 60 * 1000, backfillFetch());
	assert.equal(second.status, "ok");

	resolve();
	await firstRun;
});

test("a backfill failure records an error sync_runs row and event, and returns status error", async () => {
	const { db, rows } = fakeD1();
	const { kv, puts } = fakeKv();
	const ctx = mockCtx();
	const env: SyncEnv = { DB: db, LOCATION_BITMAP: kv };
	const failingFetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

	const result = await runSync(env, ctx, SHOP, "tok", "manual", () => 1000, failingFetch);

	assert.equal(result.status, "error");
	assert.ok(result.error);
	assert.equal(puts.length, 0);
	assert.equal(rows[0].status, "error");
	assert.ok(rows[0].error);
});

test("a D1 outage (unbound DB) still lets the sync run and write KV", async () => {
	const { kv, puts } = fakeKv();
	const ctx = mockCtx();
	const env = { DB: undefined as never, LOCATION_BITMAP: kv } satisfies SyncEnv;

	const result = await runSync(env, ctx, SHOP, "tok", "manual", () => 1000, backfillFetch(1));

	assert.equal(result.status, "ok");
	assert.equal(puts.length, 2);
});

// A separate, purpose-built fake for getLastSyncRun's own query shape —
// the fakeD1() above is tailored to runSync's guard-check query
// specifically (different bound args), so reusing it here would
// misinterpret this query's args.
function fakeD1WithRow(row: {
	started_at: number;
	finished_at: number | null;
	variants: number | null;
	status: string;
} | null) {
	return {
		prepare: (query: string) => ({
			bind: (..._args: unknown[]) => ({
				run: async () => {},
				first: async <T>() => (query.includes("FROM sync_runs") ? (row as T | null) : null),
				all: async <T>() => ({ results: [] as T[] }),
			}),
		}),
	};
}

test("getLastSyncRun returns null when a shop has never synced", async () => {
	const result = await getLastSyncRun(fakeD1WithRow(null), SHOP);
	assert.equal(result, null);
});

test("getLastSyncRun returns the most recent run's fields", async () => {
	const db = fakeD1WithRow({ started_at: 1000, finished_at: 1500, variants: 26, status: "ok" });
	const result = await getLastSyncRun(db, SHOP);
	assert.deepEqual(result, { startedAt: 1000, finishedAt: 1500, variants: 26, status: "ok" });
});
