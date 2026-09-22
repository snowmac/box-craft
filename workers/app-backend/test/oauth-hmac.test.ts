import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyShopifyOAuthHmac } from "../../../shared/oauth-hmac.ts";

const SECRET = "test-client-secret";

async function sign(params: URLSearchParams, secret: string): Promise<string> {
	const pairs: string[] = [];
	for (const [key, value] of params.entries()) {
		if (key === "hmac" || key === "signature") continue;
		pairs.push(`${key}=${value}`);
	}
	pairs.sort();
	const message = pairs.join("&");

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

test("accepts a correctly signed OAuth callback query string", async () => {
	const params = new URLSearchParams({
		code: "authcode",
		shop: "box-craft-demo.myshopify.com",
		state: "nonce123",
		timestamp: "1700000000",
	});
	params.set("hmac", await sign(params, SECRET));

	assert.equal(await verifyShopifyOAuthHmac(params, SECRET), true);
});

test("rejects a callback with a tampered shop param", async () => {
	const params = new URLSearchParams({
		code: "authcode",
		shop: "box-craft-demo.myshopify.com",
		state: "nonce123",
		timestamp: "1700000000",
	});
	params.set("hmac", await sign(params, SECRET));
	params.set("shop", "attacker-store.myshopify.com");

	assert.equal(await verifyShopifyOAuthHmac(params, SECRET), false);
});

test("rejects a missing hmac param", async () => {
	const params = new URLSearchParams({ shop: "box-craft-demo.myshopify.com" });
	assert.equal(await verifyShopifyOAuthHmac(params, SECRET), false);
});

test("rejects an hmac signed with the wrong secret", async () => {
	const params = new URLSearchParams({
		code: "authcode",
		shop: "box-craft-demo.myshopify.com",
	});
	params.set("hmac", await sign(params, "wrong-secret"));

	assert.equal(await verifyShopifyOAuthHmac(params, SECRET), false);
});
