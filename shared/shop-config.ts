import type { D1Like } from "./d1.ts";

export interface ShopConfig {
	guardrailEnabled: boolean;
	unknownStockPolicy: "allow" | "block";
}

interface ShopConfigRow {
	guardrail_enabled: number;
	unknown_stock_policy: string;
}

// D6/D7 defaults: guardrail on, unknown-stock variants ignored (fail open).
export const DEFAULT_SHOP_CONFIG: ShopConfig = { guardrailEnabled: true, unknownStockPolicy: "allow" };

export async function getShopConfig(db: D1Like, shop: string): Promise<ShopConfig> {
	const row = await db
		.prepare("SELECT guardrail_enabled, unknown_stock_policy FROM shop_config WHERE shop = ?")
		.bind(shop)
		.first<ShopConfigRow>();
	if (!row) return DEFAULT_SHOP_CONFIG;
	return {
		guardrailEnabled: row.guardrail_enabled !== 0,
		unknownStockPolicy: row.unknown_stock_policy === "block" ? "block" : "allow",
	};
}

export async function upsertShopConfig(
	db: D1Like,
	shop: string,
	patch: Partial<ShopConfig>,
): Promise<ShopConfig> {
	const current = await getShopConfig(db, shop);
	const next: ShopConfig = { ...current, ...patch };
	await db
		.prepare(
			`INSERT INTO shop_config (shop, guardrail_enabled, unknown_stock_policy, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(shop) DO UPDATE SET
			   guardrail_enabled = excluded.guardrail_enabled,
			   unknown_stock_policy = excluded.unknown_stock_policy,
			   updated_at = excluded.updated_at`,
		)
		.bind(shop, next.guardrailEnabled ? 1 : 0, next.unknownStockPolicy, Date.now())
		.run();
	return next;
}
