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
