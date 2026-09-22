import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyShopifyHmac } from "../../../shared/hmac.ts";

const SECRET = "test-shopify-webhook-secret";

async function sign(body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(body),
	);
	const bytes = new Uint8Array(signature);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

test("accepts a correctly signed payload", async () => {
	const body = JSON.stringify({ inventory_item_id: 1, location_id: 2, available: 5 });
	const signature = await sign(body, SECRET);
	const valid = await verifyShopifyHmac(body, signature, SECRET);
	assert.equal(valid, true);
});

test("rejects a tampered payload", async () => {
	const originalBody = JSON.stringify({ inventory_item_id: 1, location_id: 2, available: 5 });
	const signature = await sign(originalBody, SECRET);
	const tamperedBody = JSON.stringify({ inventory_item_id: 1, location_id: 2, available: 999 });
	const valid = await verifyShopifyHmac(tamperedBody, signature, SECRET);
	assert.equal(valid, false);
});

test("rejects a missing signature header", async () => {
	const body = JSON.stringify({ inventory_item_id: 1, location_id: 2, available: 5 });
	const valid = await verifyShopifyHmac(body, null, SECRET);
	assert.equal(valid, false);
});

test("rejects a signature produced with the wrong secret", async () => {
	const body = JSON.stringify({ inventory_item_id: 1, location_id: 2, available: 5 });
	const signature = await sign(body, "wrong-secret");
	const valid = await verifyShopifyHmac(body, signature, SECRET);
	assert.equal(valid, false);
});
