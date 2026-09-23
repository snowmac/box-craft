import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebhook } from "../src/index.ts";
import { inventoryItemMapKey } from "../../../shared/bitmap.ts";

const SECRET = "test-shopify-webhook-secret";

async function sign(body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	const bytes = new Uint8Array(signature);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function mockKv(entries: Record<string, string>) {
	return {
		async get(key: string) {
			return key in entries ? entries[key] : null;
		},
	};
}

function mockDebouncer() {
	const calls: unknown[] = [];
	return {
		namespace: {
			idFromName: (name: string) => name,
			get: () => ({
				fetch: async (_url: string, opts: { body: string }) => {
					calls.push(JSON.parse(opts.body));
					return new Response("queued");
				},
			}),
		},
		calls,
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

async function makeRequest(payload: object, shop: string | null = "box-craft-demo.myshopify.com") {
	const body = JSON.stringify(payload);
	const signature = await sign(body, SECRET);
	const headers: Record<string, string> = { "X-Shopify-Hmac-Sha256": signature };
	if (shop) headers["X-Shopify-Shop-Domain"] = shop;
	return new Request("https://webhook-consumer.example/webhooks/inventory-levels-update", {
		method: "POST",
		headers,
		body,
	});
}

test("a known inventory_item_id records a written event and dispatches to the debouncer", async () => {
	const kv = mockKv({ [inventoryItemMapKey("123")]: "gid://shopify/ProductVariant/1" });
	const { namespace, calls } = mockDebouncer();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = await makeRequest({ inventory_item_id: 123, location_id: 456, available: 5 });
	const response = await handleWebhook(
		request,
		{ LOCATION_BITMAP: kv as never, SKU_DEBOUNCER: namespace as never, SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db },
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 202);
	assert.equal(calls.length, 1);
	assert.equal(inserts.length, 1);
	const [, shop, source, type, , data] = inserts[0] as [unknown, string, string, string, string, string];
	assert.equal(shop, "box-craft-demo.myshopify.com");
	assert.equal(source, "webhook");
	assert.equal(type, "webhook_inventory");
	assert.deepEqual(JSON.parse(data), { status: "written" });
});

test("an unmapped inventory_item_id records a dropped_unknown_item event and doesn't touch the debouncer", async () => {
	const kv = mockKv({}); // no mapping
	const { namespace, calls } = mockDebouncer();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = await makeRequest({ inventory_item_id: 999, location_id: 456, available: 5 });
	const response = await handleWebhook(
		request,
		{ LOCATION_BITMAP: kv as never, SKU_DEBOUNCER: namespace as never, SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db },
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 202);
	assert.equal(calls.length, 0);
	assert.equal(inserts.length, 1);
	const data = JSON.parse(inserts[0][5] as string);
	assert.deepEqual(data, { status: "dropped_unknown_item" });
});

test("a KV lookup failure records an error event and still accepts the webhook", async () => {
	const kv = {
		async get() {
			throw new Error("KV outage");
		},
	};
	const { namespace } = mockDebouncer();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = await makeRequest({ inventory_item_id: 123, location_id: 456, available: 5 });
	const response = await handleWebhook(
		request,
		{ LOCATION_BITMAP: kv as never, SKU_DEBOUNCER: namespace as never, SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db },
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 202);
	assert.equal(inserts.length, 1);
	assert.equal(inserts[0][3], "error");
	assert.equal(inserts[0][4], "error");
});

test("an unauthorized request (bad HMAC) never reaches event recording", async () => {
	const kv = mockKv({});
	const { namespace } = mockDebouncer();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://webhook-consumer.example/webhooks/inventory-levels-update", {
		method: "POST",
		headers: { "X-Shopify-Hmac-Sha256": "not-a-real-signature" },
		body: JSON.stringify({ inventory_item_id: 123, location_id: 456, available: 5 }),
	});
	const response = await handleWebhook(
		request,
		{ LOCATION_BITMAP: kv as never, SKU_DEBOUNCER: namespace as never, SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db },
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 401);
	assert.equal(inserts.length, 0);
});
