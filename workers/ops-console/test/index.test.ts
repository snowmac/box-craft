import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { signOpsSession, OPS_SESSION_COOKIE } from "../src/auth.ts";

const OPS_TOKEN = "test-ops-token";

function baseEnv(): { DB: never; SHOP_TOKENS: never; LOCATION_BITMAP: never; OPS_TOKEN: string; SHOPIFY_CLIENT_ID: string; SHOPIFY_CLIENT_SECRET: string } {
	return {
		DB: undefined as never,
		SHOP_TOKENS: undefined as never,
		LOCATION_BITMAP: undefined as never,
		OPS_TOKEN,
		SHOPIFY_CLIENT_ID: "client123",
		SHOPIFY_CLIENT_SECRET: "shhh",
	};
}

test("GET /health is public", async () => {
	const request = new Request("https://box-craft-ops.example/health");
	const response = await worker.fetch(request, baseEnv() as never);
	assert.equal(response.status, 200);
});

test("GET /login is public and renders the login form", async () => {
	const request = new Request("https://box-craft-ops.example/login");
	const response = await worker.fetch(request, baseEnv() as never);
	assert.equal(response.status, 200);
	const html = await response.text();
	assert.match(html, /name="token"/);
});

test("POST /login with the correct token sets a session cookie and redirects home", async () => {
	const form = new FormData();
	form.set("token", OPS_TOKEN);
	const request = new Request("https://box-craft-ops.example/login", { method: "POST", body: form });
	const response = await worker.fetch(request, baseEnv() as never);

	assert.equal(response.status, 302);
	assert.equal(response.headers.get("Location"), "/");
	const setCookie = response.headers.get("Set-Cookie") ?? "";
	assert.match(setCookie, new RegExp(`^${OPS_SESSION_COOKIE}=`));
	assert.match(setCookie, /HttpOnly/);
});

test("POST /login with the wrong token is rejected without a cookie", async () => {
	const form = new FormData();
	form.set("token", "not-the-token");
	const request = new Request("https://box-craft-ops.example/login", { method: "POST", body: form });
	const response = await worker.fetch(request, baseEnv() as never);

	assert.equal(response.status, 401);
	assert.equal(response.headers.get("Set-Cookie"), null);
});

test("every route except /login and /health redirects to /login without a valid cookie", async () => {
	const env = baseEnv() as never;
	for (const path of ["/", "/overview", "/anything"]) {
		const response = await worker.fetch(new Request(`https://box-craft-ops.example${path}`), env);
		assert.equal(response.status, 302, `expected 302 for ${path}`);
		assert.equal(response.headers.get("Location"), "/login", `expected redirect to /login for ${path}`);
	}
});

test("a request with a garbage cookie is also redirected to /login", async () => {
	const request = new Request("https://box-craft-ops.example/", {
		headers: { Cookie: `${OPS_SESSION_COOKIE}=not-a-real-signature` },
	});
	const response = await worker.fetch(request, baseEnv() as never);
	assert.equal(response.status, 302);
	assert.equal(response.headers.get("Location"), "/login");
});

test("a request with a valid session cookie reaches the protected home route", async () => {
	const sessionValue = await signOpsSession(OPS_TOKEN);
	const request = new Request("https://box-craft-ops.example/", {
		headers: { Cookie: `${OPS_SESSION_COOKIE}=${sessionValue}` },
	});
	const response = await worker.fetch(request, baseEnv() as never);
	assert.equal(response.status, 200);
});

test("POST /logout clears the session cookie and redirects to /login", async () => {
	const request = new Request("https://box-craft-ops.example/logout", { method: "POST" });
	const response = await worker.fetch(request, baseEnv() as never);
	assert.equal(response.status, 302);
	assert.equal(response.headers.get("Location"), "/login");
	assert.match(response.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
});
