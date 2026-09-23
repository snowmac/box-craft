import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { bitmapKey } from "../shared/bitmap.ts";

function mockKv(entries: Record<string, unknown>) {
	return {
		async get(key: string) {
			return key in entries ? JSON.stringify(entries[key]) : null;
		},
	};
}

// Tracks only "INSERT INTO events" binds — a shop_config lookup (T6) also
// calls prepare().bind() on this same mock, but as a SELECT, not an event.
function mockDb() {
	const inserts: unknown[][] = [];
	return {
		db: {
			prepare: (query: string) => ({
				bind: (...args: unknown[]) => {
					if (query.includes("INSERT INTO events")) inserts.push(args);
					return { run: async () => {}, first: async () => null, all: async () => ({ results: [] }) };
				},
			}),
		},
		inserts,
	};
}

// A mockDb whose shop_config SELECT returns a specific stored row, so
// handleCheck's shop_config lookup (T6) can be exercised end to end without
// touching the events INSERT path (which mockDb() above covers).
function mockDbWithShopConfig(row: { guardrail_enabled: number; unknown_stock_policy: string }) {
	const inserts: unknown[][] = [];
	return {
		db: {
			prepare: (query: string) => ({
				bind: (...args: unknown[]) => ({
					run: async () => {
						inserts.push(args);
					},
					first: async <T>() => (query.includes("FROM shop_config") ? (row as T) : null),
					all: async () => ({ results: [] }),
				}),
			}),
		},
		inserts,
	};
}

function mockCtx() {
	const waited: Promise<unknown>[] = [];
	return { waitUntil: (p: Promise<unknown>) => waited.push(p), waited };
}

async function flush(ctx: ReturnType<typeof mockCtx>) {
	await Promise.all(ctx.waited);
}

test("POST /check records a check event with shop, compatible, and unknown count", async () => {
	const kv = mockKv({
		[bitmapKey("gid://shopify/ProductVariant/1")]: { locations: ["L1"], updatedAt: "" },
		// variant 2 has no bitmap entry at all
	});
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({
			variantIds: ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
			shop: "box-craft-demo.myshopify.com",
		}),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	assert.equal(response.status, 200);
	assert.equal(inserts.length, 1);
	const [, shop, source, type, level, data] = inserts[0] as [unknown, string, string, string, string, string];
	assert.equal(shop, "box-craft-demo.myshopify.com");
	assert.equal(source, "guardrail");
	assert.equal(type, "check");
	assert.equal(level, "info");
	const parsed = JSON.parse(data);
	assert.equal(parsed.n, 2);
	assert.equal(parsed.unknown, 1); // variant 2 had no entry
	assert.equal(parsed.failOpen, false);
	assert.equal(typeof parsed.ms, "number");
});

test("POST /check with an invalid shop value records shop as null rather than rejecting", async () => {
	const kv = mockKv({});
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({ variantIds: ["1"], shop: "not-a-real-shop.com" }),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	assert.equal(response.status, 200);
	assert.equal(inserts[0][1], null);
});

test("a KV read failure records an error event and still fails open", async () => {
	const kv = {
		async get() {
			throw new Error("KV outage");
		},
	};
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({ variantIds: ["1", "2"] }),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	const body = (await response.json()) as { compatible: boolean; failOpen: boolean };
	assert.equal(body.compatible, true);
	assert.equal(body.failOpen, true);
	assert.equal(inserts.length, 1);
	assert.equal(inserts[0][3], "error");
	assert.equal(inserts[0][4], "error");
});

test("an empty variantIds array short-circuits without recording an event", async () => {
	const kv = mockKv({});
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({ variantIds: [] }),
	});

	await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	assert.equal(inserts.length, 0);
});

test("event recording never breaks the response even if DB is unbound (undefined)", async () => {
	const kv = mockKv({ [bitmapKey("gid://shopify/ProductVariant/1")]: { locations: ["L1"], updatedAt: "" } });
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({ variantIds: ["gid://shopify/ProductVariant/1"] }),
	});

	const response = await worker.fetch(
		request,
		{ LOCATION_BITMAP: kv as never, DB: undefined as never },
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 200);
});

test("guardrail_enabled=0 short-circuits to {compatible:true, disabled:true} without touching the bitmap", async () => {
	const { db } = mockDbWithShopConfig({ guardrail_enabled: 0, unknown_stock_policy: "block" });
	const ctx = mockCtx();
	let kvCalled = false;
	const kv = {
		async get() {
			kvCalled = true;
			return null;
		},
	};

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({
			variantIds: ["1", "2"],
			shop: "guardrail-disabled-test.myshopify.com",
		}),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { compatible: true, disabled: true });
	assert.equal(kvCalled, false);
});

test("unknown_stock_policy=allow: an unknown variant is ignored rather than blocking (D6 accept criteria)", async () => {
	const { db } = mockDbWithShopConfig({ guardrail_enabled: 1, unknown_stock_policy: "allow" });
	const ctx = mockCtx();
	const kv = mockKv({
		[bitmapKey("gid://shopify/ProductVariant/1")]: { locations: ["L1"], updatedAt: "" },
		// variant 2 has no bitmap entry at all
	});

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({
			variantIds: ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
			shop: "policy-allow-test.myshopify.com",
		}),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	const body = (await response.json()) as { compatible: boolean; locations: string[] };
	assert.equal(body.compatible, true);
	assert.deepEqual(body.locations, ["L1"]);
});

test("unknown_stock_policy=block: an unknown variant blocks the selection", async () => {
	const { db } = mockDbWithShopConfig({ guardrail_enabled: 1, unknown_stock_policy: "block" });
	const ctx = mockCtx();
	const kv = mockKv({
		[bitmapKey("gid://shopify/ProductVariant/1")]: { locations: ["L1"], updatedAt: "" },
		// variant 2 has no bitmap entry at all
	});

	const request = new Request("https://box-craft.example/check", {
		method: "POST",
		body: JSON.stringify({
			variantIds: ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
			shop: "policy-block-test.myshopify.com",
		}),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: kv as never, DB: db }, ctx);
	await flush(ctx);

	const body = (await response.json()) as { compatible: boolean };
	assert.equal(body.compatible, false);
});

test("POST /events records a well-formed bundle_added beacon and returns 202", async () => {
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/events", {
		method: "POST",
		headers: { "CF-Connecting-IP": "1.2.3.4" },
		body: JSON.stringify({
			type: "bundle_added",
			shop: "box-craft-demo.myshopify.com",
			boxHandle: "default",
			itemCount: 4,
			totalPrice: 99.96,
		}),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: mockKv({}) as never, DB: db }, ctx);
	await flush(ctx);

	assert.equal(response.status, 202);
	assert.equal(inserts.length, 1);
	const [, shop, source, type] = inserts[0] as [unknown, string, string, string];
	assert.equal(shop, "box-craft-demo.myshopify.com");
	assert.equal(source, "picker");
	assert.equal(type, "bundle_added");
});

test("POST /events rejects a malformed payload with 400 and records nothing", async () => {
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft.example/events", {
		method: "POST",
		body: JSON.stringify({ type: "bundle_added", shop: "not-a-shop" }),
	});

	const response = await worker.fetch(request, { LOCATION_BITMAP: mockKv({}) as never, DB: db }, ctx);
	await flush(ctx);

	assert.equal(response.status, 400);
	assert.equal(inserts.length, 0);
});

test("POST /events rate-limits repeated calls from the same IP", async () => {
	const { db } = mockDb();
	const ctx = mockCtx();
	const ip = "9.9.9.9-rate-limit-test";

	const makeRequest = () =>
		new Request("https://box-craft.example/events", {
			method: "POST",
			headers: { "CF-Connecting-IP": ip },
			body: JSON.stringify({
				type: "bundle_added",
				shop: "box-craft-demo.myshopify.com",
				boxHandle: "default",
				itemCount: 2,
				totalPrice: 10,
			}),
		});

	const statuses: number[] = [];
	for (let i = 0; i < 31; i++) {
		const res = await worker.fetch(makeRequest(), { LOCATION_BITMAP: mockKv({}) as never, DB: db }, ctx);
		statuses.push(res.status);
	}
	await flush(ctx);

	assert.ok(statuses.slice(0, 30).every((s) => s === 202));
	assert.equal(statuses[30], 429);
});
