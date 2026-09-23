import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOrdersPaidWebhook } from "../src/index.ts";

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

// Realistic-shaped fixture — trimmed to the fields this handler reads,
// deliberately no customer name/email/address (D-no-PII).
function ordersPaidFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: 5678901234,
		line_items: [
			{ quantity: 1, price: "19.99", properties: [{ name: "_bundle_id", value: "bundle-abc" }] },
			{ quantity: 1, price: "29.99", properties: [{ name: "_bundle_id", value: "bundle-abc" }] },
		],
		...overrides,
	};
}

async function makeRequest(payload: object, shop: string | null = "box-craft-demo.myshopify.com") {
	const body = JSON.stringify(payload);
	const signature = await sign(body, SECRET);
	const headers: Record<string, string> = { "X-Shopify-Hmac-Sha256": signature };
	if (shop) headers["X-Shopify-Shop-Domain"] = shop;
	return new Request("https://webhook-consumer.example/webhooks/orders-paid", {
		method: "POST",
		headers,
		body,
	});
}

test("an order with a bundle records one bundle_sold event with order id, count, and revenue", async () => {
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = await makeRequest(ordersPaidFixture());
	const response = await handleOrdersPaidWebhook(
		request,
		{ SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db } as never,
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 202);
	assert.equal(inserts.length, 1);
	const [, shop, source, type, , data] = inserts[0] as [unknown, string, string, string, string, string];
	assert.equal(shop, "box-craft-demo.myshopify.com");
	assert.equal(source, "webhook");
	assert.equal(type, "bundle_sold");
	assert.deepEqual(JSON.parse(data), { orderId: 5678901234, bundleCount: 1, revenueCents: 4998 });
});

test("an order with no bundle line items records no event", async () => {
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = await makeRequest(ordersPaidFixture({ line_items: [{ quantity: 1, price: "9.99" }] }));
	const response = await handleOrdersPaidWebhook(
		request,
		{ SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db } as never,
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 202);
	assert.equal(inserts.length, 0);
});

test("an unauthorized request (bad HMAC) never reaches event recording", async () => {
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://webhook-consumer.example/webhooks/orders-paid", {
		method: "POST",
		headers: { "X-Shopify-Hmac-Sha256": "not-a-real-signature" },
		body: JSON.stringify(ordersPaidFixture()),
	});
	const response = await handleOrdersPaidWebhook(
		request,
		{ SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db } as never,
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 401);
	assert.equal(inserts.length, 0);
});

test("an unparseable payload returns 400 rather than throwing", async () => {
	const { db, inserts } = mockDb();
	const ctx = mockCtx();
	const body = "not json";
	const signature = await sign(body, SECRET);

	const request = new Request("https://webhook-consumer.example/webhooks/orders-paid", {
		method: "POST",
		headers: { "X-Shopify-Hmac-Sha256": signature, "X-Shopify-Shop-Domain": "box-craft-demo.myshopify.com" },
		body,
	});
	const response = await handleOrdersPaidWebhook(
		request,
		{ SHOPIFY_WEBHOOK_SECRET: SECRET, DB: db } as never,
		ctx,
	);
	await flush(ctx);

	assert.equal(response.status, 400);
	assert.equal(inserts.length, 0);
});
