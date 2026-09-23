import { test } from "node:test";
import assert from "node:assert/strict";
import {
	isValidShopDomain,
	buildAuthorizeUrl,
	buildTokenExchangeRequest,
	buildEmbeddedAppUrl,
	buildOfflineTokenExchangeRequest,
} from "../src/oauth.ts";

test("isValidShopDomain accepts a real myshopify.com host", () => {
	assert.equal(isValidShopDomain("box-craft-demo.myshopify.com"), true);
});

test("isValidShopDomain rejects a non-myshopify.com host (SSRF/open-redirect guard)", () => {
	assert.equal(isValidShopDomain("evil.com"), false);
	assert.equal(isValidShopDomain("myshopify.com.evil.com"), false);
	assert.equal(isValidShopDomain("not-myshopify.com"), false);
});

test("isValidShopDomain rejects an empty or malformed value", () => {
	assert.equal(isValidShopDomain(""), false);
	assert.equal(isValidShopDomain("javascript:alert(1)"), false);
});

test("buildAuthorizeUrl includes all required OAuth params", () => {
	const url = new URL(
		buildAuthorizeUrl({
			shop: "box-craft-demo.myshopify.com",
			clientId: "client123",
			scopes: "read_products,read_inventory",
			redirectUri: "https://app.example.com/auth/callback",
			state: "nonce123",
		}),
	);

	assert.equal(url.hostname, "box-craft-demo.myshopify.com");
	assert.equal(url.pathname, "/admin/oauth/authorize");
	assert.equal(url.searchParams.get("client_id"), "client123");
	assert.equal(url.searchParams.get("scope"), "read_products,read_inventory");
	assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.com/auth/callback");
	assert.equal(url.searchParams.get("state"), "nonce123");
});

test("buildTokenExchangeRequest targets the correct shop and carries the code", () => {
	const req = buildTokenExchangeRequest(
		"box-craft-demo.myshopify.com",
		"client123",
		"secret456",
		"authcode789",
	);
	assert.equal(req.url, "https://box-craft-demo.myshopify.com/admin/oauth/access_token");
	const body = JSON.parse(req.body);
	assert.equal(body.client_id, "client123");
	assert.equal(body.client_secret, "secret456");
	assert.equal(body.code, "authcode789");
});

test("buildEmbeddedAppUrl points into Shopify admin, not this Worker", () => {
	const url = buildEmbeddedAppUrl("box-craft-demo.myshopify.com", "client123");
	assert.equal(url, "https://box-craft-demo.myshopify.com/admin/apps/client123");
});

test("buildOfflineTokenExchangeRequest trades a session token for an offline access token", () => {
	const req = buildOfflineTokenExchangeRequest("box-craft-demo.myshopify.com", "client123", "secret456", "the.id.token");
	assert.equal(req.url, "https://box-craft-demo.myshopify.com/admin/oauth/access_token");
	assert.deepEqual(JSON.parse(req.body), {
		client_id: "client123",
		client_secret: "secret456",
		grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
		subject_token: "the.id.token",
		subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
		requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
	});
});
