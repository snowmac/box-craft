import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightResponse, withCors } from "../src/cors.ts";

test("preflight allows a cross-origin JSON POST from any storefront", () => {
	const res = preflightResponse();
	assert.equal(res.status, 204);
	assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
	assert.match(res.headers.get("Access-Control-Allow-Methods") ?? "", /POST/);
	assert.match(res.headers.get("Access-Control-Allow-Headers") ?? "", /Content-Type/i);
});

test("withCors adds the allow-origin header and keeps status and body", async () => {
	const res = withCors(Response.json({ compatible: false }, { status: 200 }));
	assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { compatible: false });
});

test("withCors also applies to error responses so the storefront can read them", () => {
	const res = withCors(Response.json({ error: "bad" }, { status: 400 }));
	assert.equal(res.status, 400);
	assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});
