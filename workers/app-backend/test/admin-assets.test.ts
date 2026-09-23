import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { ADMIN_CSS } from "../src/admin/admin.css.ts";
import { ADMIN_JS } from "../src/admin/admin.js.ts";

function mockCtx() {
	return { waitUntil: () => {} };
}

const env = {
	SHOP_TOKENS: {} as never,
	SHOPIFY_CLIENT_ID: "client123",
	SHOPIFY_CLIENT_SECRET: "shhh",
	SHOPIFY_WEBHOOK_SECRET: "webhook-secret",
	SHOPIFY_SCOPES: "read_inventory",
	APP_URL: "https://box-craft-app-backend.example.workers.dev",
	DB: undefined as never,
	LOCATION_BITMAP: {} as never,
};

test("GET /admin.css serves the stylesheet with a long-cache, immutable header", async () => {
	const request = new Request("https://box-craft-app-backend.example.workers.dev/admin.css?v=1");
	const response = await worker.fetch(request, env, mockCtx() as never);

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "text/css; charset=utf-8");
	assert.match(response.headers.get("Cache-Control") ?? "", /immutable/);
	assert.equal(await response.text(), ADMIN_CSS);
});

test("GET /admin.js serves the script with a long-cache, immutable header", async () => {
	const request = new Request("https://box-craft-app-backend.example.workers.dev/admin.js?v=1");
	const response = await worker.fetch(request, env, mockCtx() as never);

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "application/javascript; charset=utf-8");
	assert.match(response.headers.get("Cache-Control") ?? "", /immutable/);
	assert.equal(await response.text(), ADMIN_JS);
});
