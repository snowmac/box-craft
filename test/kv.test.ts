import { test } from "node:test";
import assert from "node:assert/strict";
import type { KVLike } from "../shared/kv.ts";

// A plain in-memory Map-backed mock implementing KVLike — no Cloudflare
// types anywhere in this file. Proves the interface is complete (every
// method this codebase actually calls) and minimal (nothing here needs
// more than this).
function createMockKv(): KVLike {
	const store = new Map<string, string>();
	return {
		async get<T>(key: string, type?: "json"): Promise<string | T | null> {
			const value = store.get(key) ?? null;
			if (value === null) return null;
			return type === "json" ? (JSON.parse(value) as T) : value;
		},
		async put(key: string, value: string): Promise<void> {
			store.set(key, value);
		},
		async delete(key: string): Promise<void> {
			store.delete(key);
		},
		async list(options?: { prefix?: string; cursor?: string }) {
			const prefix = options?.prefix ?? "";
			const keys = [...store.keys()]
				.filter((k) => k.startsWith(prefix))
				.sort()
				.map((name) => ({ name }));
			return { keys, list_complete: true };
		},
	};
}

test("KVLike mock: put then get (string)", async () => {
	const kv = createMockKv();
	await kv.put("a", "hello");
	assert.equal(await kv.get("a"), "hello");
});

test("KVLike mock: get returns null for a missing key", async () => {
	const kv = createMockKv();
	assert.equal(await kv.get("missing"), null);
});

test("KVLike mock: put then get (json)", async () => {
	const kv = createMockKv();
	await kv.put("rec", JSON.stringify({ n: 1 }));
	assert.deepEqual(await kv.get<{ n: number }>("rec", "json"), { n: 1 });
});

test("KVLike mock: delete removes the key", async () => {
	const kv = createMockKv();
	await kv.put("a", "1");
	await kv.delete("a");
	assert.equal(await kv.get("a"), null);
});

test("KVLike mock: list filters by prefix", async () => {
	const kv = createMockKv();
	await kv.put("shop:a.myshopify.com", "1");
	await kv.put("shop:b.myshopify.com", "1");
	await kv.put("sku:xyz", "1");
	const result = await kv.list({ prefix: "shop:" });
	assert.deepEqual(
		result.keys.map((k) => k.name),
		["shop:a.myshopify.com", "shop:b.myshopify.com"],
	);
	assert.equal(result.list_complete, true);
});
