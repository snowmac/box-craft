import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.ts";

const CLIENT_ID = "client123";
const CLIENT_SECRET = "shhh";
const SCOPES = "read_inventory,read_locations,write_products,write_cart_transforms,write_publications";

function b64url(input: string | Buffer): string {
	return Buffer.from(input).toString("base64url");
}

function signIdToken(shop: string, overrides: Record<string, unknown> = {}): string {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iss: `https://${shop}/admin`,
		dest: `https://${shop}`,
		aud: CLIENT_ID,
		sub: "1",
		exp: now + 60,
		nbf: now - 5,
		iat: now - 5,
		jti: "abc",
		...overrides,
	};
	const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = b64url(JSON.stringify(payload));
	const sig = createHmac("sha256", CLIENT_SECRET).update(`${head}.${body}`).digest("base64url");
	return `${head}.${body}.${sig}`;
}

function mockKvNamespace() {
	const store = new Map<string, string>();
	return {
		async get(key: string, type?: string) {
			const raw = store.get(key) ?? null;
			return raw && type === "json" ? JSON.parse(raw) : raw;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		async delete(key: string) {
			store.delete(key);
		},
		store,
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

function baseEnv(overrides: Record<string, unknown> = {}) {
	return {
		SHOP_TOKENS: mockKvNamespace(),
		SHOPIFY_CLIENT_ID: CLIENT_ID,
		SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
		SHOPIFY_WEBHOOK_SECRET: "webhook-secret",
		SHOPIFY_SCOPES: SCOPES,
		APP_URL: "https://box-craft-app-backend.example.workers.dev",
		...overrides,
	};
}

function withMockedFetch(handler: (input: string) => Promise<Response>, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL) => handler(String(input));
	return run().finally(() => {
		globalThis.fetch = original;
	});
}

test("GET / with a valid id_token and an already-installed, already-set-up store records no events", async () => {
	const shop = "box-craft-demo.myshopify.com";
	const env = baseEnv();
	// Pre-seed a token that already covers current scopes and is already set up.
	await env.SHOP_TOKENS.put(
		`shop:${shop}`,
		JSON.stringify({ accessToken: "tok", scope: SCOPES, installedAt: "x", setupAt: "already-done" }),
	);
	const { db, inserts } = mockDb();
	const ctx = mockCtx();
	const idToken = signIdToken(shop);

	const request = new Request(`https://box-craft-app-backend.example.workers.dev/?id_token=${idToken}`);
	const response = await worker.fetch(request, { ...env, DB: db } as never, ctx);
	await flush(ctx);
	const html = await response.text();

	assert.match(html, /BoxCraft is installed/);
	// Already set up (setupAt present) -> ensureStoreSetup never called, no new events.
	assert.equal(inserts.length, 0);
});

test("GET / with a stale-scope token re-exchanges and re-verifies setup, recording both events", async () => {
	// A fresh exchange discards the old record's setupAt, so store setup
	// genuinely re-runs too — this exercises both event types together.
	// ensureStoreSetup's own multi-step GraphQL sequence is covered by
	// store-setup.test.ts; here it's just made to fail generically so this
	// test stays focused on (and robust to changes in) the event wiring.
	const shop = "box-craft-demo.myshopify.com";
	const env = baseEnv();
	await env.SHOP_TOKENS.put(
		`shop:${shop}`,
		JSON.stringify({ accessToken: "old", scope: "read_inventory", installedAt: "x", setupAt: "already-done" }),
	);
	const { db, inserts } = mockDb();
	const ctx = mockCtx();
	const idToken = signIdToken(shop);

	await withMockedFetch(
		async (url) => {
			if (url.includes("/admin/oauth/access_token")) {
				return Response.json({ access_token: "new-token", scope: SCOPES });
			}
			return new Response("server error", { status: 500 });
		},
		async () => {
			const request = new Request(`https://box-craft-app-backend.example.workers.dev/?id_token=${idToken}`);
			await worker.fetch(request, { ...env, DB: db } as never, ctx);
			await flush(ctx);
		},
	);

	assert.equal(inserts.length, 2);
	const [, exchangeShop, exchangeSource, exchangeType, exchangeLevel, exchangeData] = inserts[0] as [
		unknown,
		string,
		string,
		string,
		string,
		string,
	];
	assert.equal(exchangeShop, shop);
	assert.equal(exchangeSource, "app");
	assert.equal(exchangeType, "token_exchange");
	assert.equal(exchangeLevel, "info");
	assert.deepEqual(JSON.parse(exchangeData), { ok: true });

	assert.equal(inserts[1][3], "setup");
	assert.equal(inserts[1][4], "error");
	const setupData = JSON.parse(inserts[1][5] as string);
	assert.equal(setupData.step, "store_setup");
	assert.equal(setupData.ok, false);
});

test("a failed token exchange records a token_exchange error event and setup does not finish", async () => {
	const shop = "box-craft-demo.myshopify.com";
	const env = baseEnv();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();
	const idToken = signIdToken(shop);

	await withMockedFetch(
		async () => new Response("nope", { status: 401 }),
		async () => {
			const request = new Request(`https://box-craft-app-backend.example.workers.dev/?id_token=${idToken}`);
			const response = await worker.fetch(request, { ...env, DB: db } as never, ctx);
			await flush(ctx);
			const html = await response.text();
			assert.match(html, /setup didn't finish/);
		},
	);

	assert.equal(inserts.length, 1);
	assert.equal(inserts[0][3], "token_exchange");
	assert.equal(inserts[0][4], "error");
	assert.deepEqual(JSON.parse(inserts[0][5] as string), { ok: false, status: 401 });
});

test("store setup failing after a successful token exchange records both a token_exchange ok event and a setup error event", async () => {
	const shop = "box-craft-demo.myshopify.com";
	const env = baseEnv();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();
	const idToken = signIdToken(shop);

	await withMockedFetch(
		async (url) => {
			if (url.includes("/admin/oauth/access_token")) {
				return Response.json({ access_token: "new-token", scope: SCOPES });
			}
			// The GraphQL Admin API call inside ensureStoreSetup fails.
			return new Response("server error", { status: 500 });
		},
		async () => {
			const request = new Request(`https://box-craft-app-backend.example.workers.dev/?id_token=${idToken}`);
			await worker.fetch(request, { ...env, DB: db } as never, ctx);
			await flush(ctx);
		},
	);

	assert.equal(inserts.length, 2);
	assert.equal(inserts[0][3], "token_exchange");
	assert.equal(inserts[1][3], "setup");
	assert.equal(inserts[1][4], "error");
	const setupData = JSON.parse(inserts[1][5] as string);
	assert.equal(setupData.step, "store_setup");
	assert.equal(setupData.ok, false);
});

test("a missing id_token records no events and reports setup incomplete", async () => {
	const env = baseEnv();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	const request = new Request("https://box-craft-app-backend.example.workers.dev/");
	const response = await worker.fetch(request, { ...env, DB: db } as never, ctx);
	await flush(ctx);
	const html = await response.text();

	assert.match(html, /setup didn't finish/);
	assert.equal(inserts.length, 0);
});

test("the direct /auth/callback path also records a token_exchange event on success", async () => {
	const shop = "box-craft-demo.myshopify.com";
	const env = baseEnv();
	const { db, inserts } = mockDb();
	const ctx = mockCtx();

	// Build a valid callback query string signed with the client secret.
	const params = new URLSearchParams({ shop, code: "authcode", state: "nonce123" });
	const pairs: string[] = [];
	for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
	pairs.sort();
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(CLIENT_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pairs.join("&")));
	const hmac = Array.from(new Uint8Array(sigBuf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	params.set("hmac", hmac);

	await withMockedFetch(
		async () => Response.json({ access_token: "tok", scope: SCOPES }),
		async () => {
			const request = new Request(
				`https://box-craft-app-backend.example.workers.dev/auth/callback?${params.toString()}`,
				{ headers: { Cookie: "boxcraft_oauth_state=nonce123" } },
			);
			const response = await worker.fetch(request, { ...env, DB: db } as never, ctx);
			await flush(ctx);
			assert.equal(response.status, 302);
		},
	);

	assert.equal(inserts.length, 1);
	assert.equal(inserts[0][3], "token_exchange");
	assert.deepEqual(JSON.parse(inserts[0][5] as string), { ok: true });
});

test("the scheduled handler prunes old events via ctx.waitUntil", async () => {
	const env = baseEnv();
	let deleteQuery: string | null = null;
	const db = {
		prepare: (query: string) => {
			deleteQuery = query;
			return { bind: () => ({ run: async () => {} }) };
		},
	};
	const ctx = mockCtx();

	await worker.scheduled?.(undefined, { ...env, DB: db } as never, ctx as never);
	await flush(ctx);

	assert.match(deleteQuery ?? "", /DELETE FROM events WHERE ts < \?/);
});
