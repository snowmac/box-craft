import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handleApi, type ApiEnv } from "../src/api.ts";
import type { D1Like } from "../../../shared/events.ts";

const CLIENT_ID = "client123";
const CLIENT_SECRET = "shhh";
const SHOP = "box-craft-demo.myshopify.com";

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

function mockKvNamespace(preSeed?: Record<string, unknown>) {
	const store = new Map<string, string>();
	if (preSeed) store.set(`shop:${SHOP}`, JSON.stringify(preSeed));
	return {
		async get(key: string, type?: string) {
			const raw = store.get(key) ?? null;
			return raw && type === "json" ? JSON.parse(raw) : raw;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
	};
}

// Enough of a fake D1 to exercise config/box CRUD through the real db.ts
// functions (same fake shape used in db.test.ts).
function fakeD1(): D1Like {
	const shopConfig = new Map<string, { guardrail_enabled: number; unknown_stock_policy: string }>();
	const boxes = new Map<string, Record<string, unknown>>();

	return {
		prepare(query: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async run() {
							if (query.includes("INSERT INTO shop_config")) {
								const [shop, guardrail_enabled, unknown_stock_policy] = args as [string, number, string];
								shopConfig.set(shop, { guardrail_enabled, unknown_stock_policy });
							} else if (query.includes("INSERT INTO boxes")) {
								const [shop, handle, title, collection_handle, pick_count, discount, active] = args;
								boxes.set(`${shop}\u0000${handle}`, {
									shop,
									handle,
									title,
									collection_handle,
									pick_count,
									discount,
									active,
								});
							} else if (query.includes("DELETE FROM boxes")) {
								const [shop, handle] = args as [string, string];
								boxes.delete(`${shop}\u0000${handle}`);
							}
						},
						async first<T>() {
							if (query.includes("FROM shop_config")) {
								const [shop] = args as [string];
								return (shopConfig.get(shop) as T) ?? null;
							}
							return null;
						},
						async all<T>() {
							if (query.includes("FROM boxes")) {
								const [shop] = args as [string];
								const results = [...boxes.values()].filter((r) => r.shop === shop);
								return { results: results as T[] };
							}
							return { results: [] as T[] };
						},
					};
				},
			};
		},
	};
}

function withMockedFetch(handler: (url: string) => Promise<Response>, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL) => handler(String(input));
	return run().finally(() => {
		globalThis.fetch = original;
	});
}

function metafieldSuccessFetch(): Promise<Response> {
	return Promise.resolve(
		Response.json({
			data: {
				currentAppInstallation: { id: "gid://shopify/AppInstallation/1" },
				cartTransforms: { nodes: [] },
				metafieldsSet: { userErrors: [] },
			},
		}),
	);
}

// T9: a single-page, single-variant response shaped like shared/backfill.ts's
// productVariants query, for exercising POST /api/sync end to end.
function backfillSuccessFetch(): Promise<Response> {
	return Promise.resolve(
		Response.json({
			data: {
				productVariants: {
					pageInfo: { hasNextPage: false, endCursor: null },
					edges: [
						{
							node: {
								id: "gid://shopify/ProductVariant/1",
								inventoryItem: {
									id: "gid://shopify/InventoryItem/10",
									inventoryLevels: {
										pageInfo: { hasNextPage: false, endCursor: null },
										edges: [
											{
												node: {
													location: { id: "gid://shopify/Location/1" },
													quantities: [{ name: "available", quantity: 5 }],
												},
											},
										],
									},
								},
							},
						},
					],
				},
			},
		}),
	);
}

function mockCtx() {
	return { waitUntil: () => {} };
}

function baseEnv(kv = mockKvNamespace({ accessToken: "tok", scope: "x", installedAt: "x" })): ApiEnv {
	return {
		SHOP_TOKENS: kv,
		SHOPIFY_CLIENT_ID: CLIENT_ID,
		SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
		DB: fakeD1(),
		LOCATION_BITMAP: mockKvNamespace(),
	} as unknown as ApiEnv;
}

function request(path: string, opts: RequestInit & { token?: string | null } = {}) {
	const { token, ...init } = opts;
	const headers = new Headers(init.headers);
	if (token !== null) headers.set("Authorization", `Bearer ${token ?? signIdToken(SHOP)}`);
	return new Request(`https://box-craft-app-backend.example.workers.dev${path}`, { ...init, headers });
}

test("a request with no Authorization header is rejected with 401", async () => {
	const env = baseEnv();
	const req = request("/api/overview", { token: null });
	const res = await handleApi(req, new URL(req.url), env, mockCtx());
	assert.equal(res.status, 401);
});

test("a request with an invalid session token is rejected with 401", async () => {
	const env = baseEnv();
	const req = request("/api/overview", { token: "not-a-real-token" });
	const res = await handleApi(req, new URL(req.url), env, mockCtx());
	assert.equal(res.status, 401);
});

test("a valid token for a shop with no stored access token is rejected with 401", async () => {
	const env = baseEnv(mockKvNamespace()); // no pre-seeded record for SHOP
	const req = request("/api/overview");
	const res = await handleApi(req, new URL(req.url), env, mockCtx());
	assert.equal(res.status, 401);
});

test("GET /api/overview reports installed status for an authenticated shop", async () => {
	const env = baseEnv();
	const req = request("/api/overview");
	const res = await handleApi(req, new URL(req.url), env, mockCtx());
	assert.equal(res.status, 200);
	const body = (await res.json()) as any;
	assert.equal(body.shop, SHOP);
	assert.equal(body.installed, true);
});

test("GET /api/config returns defaults, PUT /api/config persists a patch", async () => {
	const env = baseEnv();

	const getRes = await handleApi(request("/api/config"), new URL("https://x/api/config"), env, mockCtx());
	assert.deepEqual(await getRes.json(), { guardrailEnabled: true, unknownStockPolicy: "allow" });

	const putRes = await handleApi(
		request("/api/config", { method: "PUT", body: JSON.stringify({ unknown_stock_policy: "block" }) }),
		new URL("https://x/api/config"),
		env,
		mockCtx(),
	);
	assert.equal(putRes.status, 200);
	assert.deepEqual(await putRes.json(), { guardrailEnabled: true, unknownStockPolicy: "block" });

	const getAgain = await handleApi(request("/api/config"), new URL("https://x/api/config"), env, mockCtx());
	assert.deepEqual(await getAgain.json(), { guardrailEnabled: true, unknownStockPolicy: "block" });
});

test("PUT /api/config with an invalid policy returns 400 with errors", async () => {
	const env = baseEnv();
	const res = await handleApi(
		request("/api/config", { method: "PUT", body: JSON.stringify({ unknown_stock_policy: "maybe" }) }),
		new URL("https://x/api/config"),
		env,
		mockCtx(),
	);
	assert.equal(res.status, 400);
	const body = (await res.json()) as any;
	assert.ok(body.errors.length > 0);
});

test("POST /api/boxes creates a box, syncs metafields, and GET /api/boxes lists it", async () => {
	const env = baseEnv();
	const newBox = {
		handle: "coffee",
		title: "Coffee Box",
		collection_handle: "coffee",
		pick_count: 6,
		discount: { type: "percent", percent: 10 },
	};

	await withMockedFetch(metafieldSuccessFetch, async () => {
		const res = await handleApi(
			request("/api/boxes", { method: "POST", body: JSON.stringify(newBox) }),
			new URL("https://x/api/boxes"),
			env,
			mockCtx(),
		);
		assert.equal(res.status, 201);
	});

	const listRes = await handleApi(request("/api/boxes"), new URL("https://x/api/boxes"), env, mockCtx());
	const { boxes } = (await listRes.json()) as any;
	assert.equal(boxes.length, 1);
	assert.equal(boxes[0].handle, "coffee");
	assert.equal(boxes[0].active, true);
});

test("POST /api/boxes with invalid input returns 400 and never reaches the metafield sync", async () => {
	const env = baseEnv();
	let fetchCalled = false;

	await withMockedFetch(
		async () => {
			fetchCalled = true;
			return metafieldSuccessFetch();
		},
		async () => {
			const res = await handleApi(
				request("/api/boxes", { method: "POST", body: JSON.stringify({ handle: "BAD HANDLE", pick_count: 999 }) }),
				new URL("https://x/api/boxes"),
				env,
				mockCtx(),
			);
			assert.equal(res.status, 400);
		},
	);

	assert.equal(fetchCalled, false);
});

test("PUT /api/boxes/:handle updates in place, URL handle wins over any conflicting body value", async () => {
	const env = baseEnv();
	const box = { title: "V1", collection_handle: null, pick_count: 4, discount: { type: "none" } };

	await withMockedFetch(metafieldSuccessFetch, async () => {
		await handleApi(
			request("/api/boxes", { method: "POST", body: JSON.stringify({ ...box, handle: "default" }) }),
			new URL("https://x/api/boxes"),
			env,
			mockCtx(),
		);
		const res = await handleApi(
			request("/api/boxes/default", {
				method: "PUT",
				body: JSON.stringify({ ...box, title: "V2", handle: "different-handle" }),
			}),
			new URL("https://x/api/boxes/default"),
			env,
			mockCtx(),
		);
		assert.equal(res.status, 200);
		const updated = (await res.json()) as any;
		assert.equal(updated.handle, "default");
		assert.equal(updated.title, "V2");
	});
});

test("DELETE /api/boxes/:handle removes it", async () => {
	const env = baseEnv();
	await withMockedFetch(metafieldSuccessFetch, async () => {
		await handleApi(
			request("/api/boxes", {
				method: "POST",
				body: JSON.stringify({ handle: "temp", title: "T", collection_handle: null, pick_count: 4, discount: { type: "none" } }),
			}),
			new URL("https://x/api/boxes"),
			env,
			mockCtx(),
		);
		const delRes = await handleApi(
			request("/api/boxes/temp", { method: "DELETE" }),
			new URL("https://x/api/boxes/temp"),
			env,
			mockCtx(),
		);
		assert.equal(delRes.status, 204);
	});

	const listRes = await handleApi(request("/api/boxes"), new URL("https://x/api/boxes"), env, mockCtx());
	const { boxes } = (await listRes.json()) as any;
	assert.deepEqual(boxes, []);
});

test("a metafield sync failure still keeps the D1 write, reported as 207", async () => {
	const env = baseEnv();
	await withMockedFetch(
		async () => new Response("server error", { status: 500 }),
		async () => {
			const res = await handleApi(
				request("/api/boxes", {
					method: "POST",
					body: JSON.stringify({ handle: "default", title: "T", collection_handle: null, pick_count: 4, discount: { type: "none" } }),
				}),
				new URL("https://x/api/boxes"),
				env,
				mockCtx(),
			);
			assert.equal(res.status, 207);
			const body = (await res.json()) as any;
			assert.ok(body.syncError);
		},
	);

	const listRes = await handleApi(request("/api/boxes"), new URL("https://x/api/boxes"), env, mockCtx());
	const { boxes } = (await listRes.json()) as any;
	assert.equal(boxes.length, 1); // saved despite the sync failure
});

test("POST /api/sync runs a real inventory sync and returns ok with the variant count", async () => {
	const env = baseEnv();
	await withMockedFetch(backfillSuccessFetch, async () => {
		const res = await handleApi(
			request("/api/sync", { method: "POST" }),
			new URL("https://x/api/sync"),
			env,
			mockCtx(),
		);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.equal(body.status, "ok");
		assert.equal(body.variants, 1);
	});
});

test("POST /api/sync surfaces an Admin API failure as a 502 with the error", async () => {
	const env = baseEnv();
	await withMockedFetch(
		async () => new Response("server error", { status: 500 }),
		async () => {
			const res = await handleApi(
				request("/api/sync", { method: "POST" }),
				new URL("https://x/api/sync"),
				env,
				mockCtx(),
			);
			assert.equal(res.status, 502);
			const body = (await res.json()) as any;
			assert.equal(body.status, "error");
			assert.ok(body.error);
		},
	);
});

test("an unknown /api route returns 404", async () => {
	const env = baseEnv();
	const res = await handleApi(request("/api/nope"), new URL("https://x/api/nope"), env, mockCtx());
	assert.equal(res.status, 404);
});
