import type { D1Like } from "./d1.ts";
import { getShopConfig, DEFAULT_SHOP_CONFIG, type ShopConfig } from "./shop-config.ts";

// T6: the Guardrail Worker reads shop_config on every /check call, so it
// caches per isolate for 60s rather than hitting D1 on every request.
export const CONFIG_CACHE_TTL_MS = 60_000;

export interface ShopConfigCache {
	get(shop: string, now: number): ShopConfig | null;
	set(shop: string, config: ShopConfig, now: number): void;
}

// A plain Map wrapped behind this interface (rather than exporting the Map
// itself) so tests can construct an isolated cache per test without any
// module-level state leaking between them.
export function createShopConfigCache(): ShopConfigCache {
	const store = new Map<string, { config: ShopConfig; expiresAt: number }>();
	return {
		get(shop, now) {
			const entry = store.get(shop);
			if (!entry || entry.expiresAt <= now) return null;
			return entry.config;
		},
		set(shop, config, now) {
			store.set(shop, { config, expiresAt: now + CONFIG_CACHE_TTL_MS });
		},
	};
}

// Never throws: a config read failure is treated the same as a bitmap read
// failure elsewhere in the Guardrail Worker — fail open rather than block a
// shopper over an outage in a feature (per-shop settings) that has a safe
// default.
export async function getCachedShopConfig(
	db: D1Like,
	shop: string | null,
	cache: ShopConfigCache,
	now: number = Date.now(),
): Promise<ShopConfig> {
	if (shop === null) return DEFAULT_SHOP_CONFIG;

	const cached = cache.get(shop, now);
	if (cached) return cached;

	const config = await getShopConfig(db, shop);
	cache.set(shop, config, now);
	return config;
}
