import { test } from "node:test";
import assert from "node:assert/strict";
import { createShopConfigCache, getCachedShopConfig, CONFIG_CACHE_TTL_MS } from "../shared/shop-config-cache.ts";
import type { D1Like } from "../shared/d1.ts";

function mockD1(row: { guardrail_enabled: number; unknown_stock_policy: string } | null) {
	let calls = 0;
	const db: D1Like = {
		prepare: () => ({
			bind: () => ({
				run: async () => {},
				first: async () => {
					calls++;
					return row as never;
				},
				all: async () => ({ results: [] }),
			}),
		}),
	};
	return { db, getCalls: () => calls };
}

test("a null shop returns the default config without touching D1", async () => {
	const { db, getCalls } = mockD1(null);
	const cache = createShopConfigCache();

	const config = await getCachedShopConfig(db, null, cache, 0);

	assert.deepEqual(config, { guardrailEnabled: true, unknownStockPolicy: "allow" });
	assert.equal(getCalls(), 0);
});

test("repeated lookups within the TTL hit the cache, not D1", async () => {
	const { db, getCalls } = mockD1({ guardrail_enabled: 0, unknown_stock_policy: "block" });
	const cache = createShopConfigCache();
	const shop = "cache-hit-test.myshopify.com";

	const first = await getCachedShopConfig(db, shop, cache, 1000);
	const second = await getCachedShopConfig(db, shop, cache, 1000 + CONFIG_CACHE_TTL_MS - 1);

	assert.deepEqual(first, { guardrailEnabled: false, unknownStockPolicy: "block" });
	assert.deepEqual(second, first);
	assert.equal(getCalls(), 1);
});

test("a lookup after the TTL expires re-reads D1", async () => {
	const { db, getCalls } = mockD1({ guardrail_enabled: 1, unknown_stock_policy: "allow" });
	const cache = createShopConfigCache();
	const shop = "cache-expiry-test.myshopify.com";

	await getCachedShopConfig(db, shop, cache, 1000);
	await getCachedShopConfig(db, shop, cache, 1000 + CONFIG_CACHE_TTL_MS);

	assert.equal(getCalls(), 2);
});

test("different shops are cached independently", async () => {
	const { db, getCalls } = mockD1({ guardrail_enabled: 1, unknown_stock_policy: "allow" });
	const cache = createShopConfigCache();

	await getCachedShopConfig(db, "shop-a.myshopify.com", cache, 0);
	await getCachedShopConfig(db, "shop-b.myshopify.com", cache, 0);

	assert.equal(getCalls(), 2);
});
