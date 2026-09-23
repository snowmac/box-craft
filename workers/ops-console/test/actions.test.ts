import { test } from "node:test";
import assert from "node:assert/strict";
import { rerunStoreSetup, triggerSync, forceSetupReRun, pruneEventsNow } from "../src/actions.ts";
import type { D1Like } from "../../../shared/events.ts";

const SHOP = "box-craft-demo.myshopify.com";

function mockKv(preSeed?: Record<string, unknown>) {
	const store = new Map<string, string>();
	if (preSeed) {
		for (const [k, v] of Object.entries(preSeed)) store.set(k, JSON.stringify(v));
	}
	return {
		async get(key: string, type?: string) {
			const raw = store.get(key) ?? null;
			return raw && type === "json" ? JSON.parse(raw) : raw;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		store,
	};
}

function mockDb() {
	const inserts: unknown[][] = [];
	return {
		db: {
			prepare: () => ({
				bind: (...args: unknown[]) => {
					inserts.push(args);
					return { run: async () => {}, first: async () => null, all: async () => ({ results: [] }) };
				},
			}),
		},
		inserts,
	};
}

function mockCtx() {
	return { waitUntil: () => {} };
}

function withMockedFetch(handler: () => Promise<Response>, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = handler as typeof fetch;
	return run().finally(() => {
		globalThis.fetch = original;
	});
}

test("rerunStoreSetup reports no token when the shop was never installed", async () => {
	const shopTokens = mockKv();
	const result = await rerunStoreSetup(shopTokens as never, SHOP);
	assert.equal(result.ok, false);
	assert.match(result.message, /No stored token/);
});

test("rerunStoreSetup succeeds when ensureStoreSetup's Admin API calls succeed", async () => {
	const shopTokens = mockKv({ [`shop:${SHOP}`]: { accessToken: "tok", scope: "x", installedAt: "x" } });

	await withMockedFetch(
		async () =>
			Response.json({
				data: {
					products: { nodes: [{ id: "gid://shopify/Product/1", variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }] } }] },
					publications: { nodes: [{ id: "gid://shopify/Publication/1", channels: { nodes: [{ handle: "online_store" }] } }] },
					product: { publishedOnPublication: true },
					cartTransforms: { nodes: [{ id: "gid://shopify/CartTransform/1", metafield: { value: "gid://shopify/ProductVariant/1" } }] },
				},
			}),
		async () => {
			const result = await rerunStoreSetup(shopTokens as never, SHOP);
			assert.equal(result.ok, true);
			assert.match(result.message, new RegExp(SHOP));
		},
	);
});

test("rerunStoreSetup reports the error when ensureStoreSetup fails", async () => {
	const shopTokens = mockKv({ [`shop:${SHOP}`]: { accessToken: "tok", scope: "x", installedAt: "x" } });

	await withMockedFetch(
		async () => new Response("server error", { status: 500 }),
		async () => {
			const result = await rerunStoreSetup(shopTokens as never, SHOP);
			assert.equal(result.ok, false);
			assert.match(result.message, /failed/);
		},
	);
});

test("triggerSync reports no token when the shop was never installed", async () => {
	const shopTokens = mockKv();
	const { db } = mockDb();
	const env = { DB: db, LOCATION_BITMAP: {} as never, SHOP_TOKENS: shopTokens as never };
	const result = await triggerSync(env as never, mockCtx() as never, SHOP);
	assert.equal(result.ok, false);
	assert.match(result.message, /No stored token/);
});

test("triggerSync reports success with the variant count", async () => {
	const shopTokens = mockKv({ [`shop:${SHOP}`]: { accessToken: "tok", scope: "x", installedAt: "x" } });
	const { db } = mockDb();
	const puts: unknown[] = [];
	const kv = { put: async (k: string, v: string) => puts.push([k, v]) };
	const env = { DB: db, LOCATION_BITMAP: kv as never, SHOP_TOKENS: shopTokens as never };

	await withMockedFetch(
		async () =>
			Response.json({
				data: { productVariants: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
			}),
		async () => {
			const result = await triggerSync(env as never, mockCtx() as never, SHOP);
			assert.equal(result.ok, true);
			assert.match(result.message, /0 variants/);
		},
	);
});

test("triggerSync reports failure when the backfill call fails", async () => {
	const shopTokens = mockKv({ [`shop:${SHOP}`]: { accessToken: "tok", scope: "x", installedAt: "x" } });
	const { db } = mockDb();
	const env = { DB: db, LOCATION_BITMAP: {} as never, SHOP_TOKENS: shopTokens as never };

	await withMockedFetch(
		async () => new Response("nope", { status: 500 }),
		async () => {
			const result = await triggerSync(env as never, mockCtx() as never, SHOP);
			assert.equal(result.ok, false);
			assert.match(result.message, /failed/);
		},
	);
});

test("forceSetupReRun clears setupAt but keeps the rest of the record", async () => {
	const shopTokens = mockKv({
		[`shop:${SHOP}`]: { accessToken: "tok", scope: "read_x", installedAt: "install-time", setupAt: "setup-time" },
	});
	const result = await forceSetupReRun(shopTokens as never, SHOP);
	assert.equal(result.ok, true);

	const updated = JSON.parse(shopTokens.store.get(`shop:${SHOP}`)!);
	assert.equal(updated.setupAt, undefined);
	assert.equal(updated.accessToken, "tok");
	assert.equal(updated.scope, "read_x");
	assert.equal(updated.installedAt, "install-time");
});

test("forceSetupReRun reports no token when the shop was never installed", async () => {
	const shopTokens = mockKv();
	const result = await forceSetupReRun(shopTokens as never, SHOP);
	assert.equal(result.ok, false);
});

test("pruneEventsNow succeeds and issues the delete query", async () => {
	const { db, inserts } = mockDb();
	const result = await pruneEventsNow(db as never as D1Like);
	assert.equal(result.ok, true);
	assert.equal(inserts.length, 1);
});

test("pruneEventsNow reports failure rather than throwing", async () => {
	const db: D1Like = {
		prepare: () => ({
			bind: () => ({
				run: async () => {
					throw new Error("D1 outage");
				},
				first: async () => null,
				all: async () => ({ results: [] }),
			}),
		}),
	};
	const result = await pruneEventsNow(db);
	assert.equal(result.ok, false);
	assert.match(result.message, /D1 outage/);
});
