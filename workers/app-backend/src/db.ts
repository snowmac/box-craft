import type { D1Like } from "../../../shared/events.ts";
import type { Box, Discount } from "../../../shared/boxes.ts";
import { defaultBox } from "../../../shared/boxes.ts";

export interface ShopConfig {
	guardrailEnabled: boolean;
	unknownStockPolicy: "allow" | "block";
}

interface ShopConfigRow {
	guardrail_enabled: number;
	unknown_stock_policy: string;
}

const DEFAULT_SHOP_CONFIG: ShopConfig = { guardrailEnabled: true, unknownStockPolicy: "allow" };

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

interface BoxRow {
	handle: string;
	title: string;
	collection_handle: string | null;
	pick_count: number;
	discount: string;
	active: number;
}

function rowToBox(row: BoxRow): Box {
	return {
		handle: row.handle,
		title: row.title,
		collection_handle: row.collection_handle,
		pick_count: row.pick_count,
		discount: JSON.parse(row.discount) as Discount,
		active: row.active !== 0,
	};
}

export async function listBoxes(db: D1Like, shop: string): Promise<Box[]> {
	const { results } = await db
		.prepare("SELECT handle, title, collection_handle, pick_count, discount, active FROM boxes WHERE shop = ? ORDER BY handle")
		.bind(shop)
		.all<BoxRow>();
	return results.map(rowToBox);
}

export async function upsertBox(db: D1Like, shop: string, box: Box): Promise<void> {
	await db
		.prepare(
			`INSERT INTO boxes (shop, handle, title, collection_handle, pick_count, discount, active, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(shop, handle) DO UPDATE SET
			   title = excluded.title,
			   collection_handle = excluded.collection_handle,
			   pick_count = excluded.pick_count,
			   discount = excluded.discount,
			   active = excluded.active,
			   updated_at = excluded.updated_at`,
		)
		.bind(
			shop,
			box.handle,
			box.title,
			box.collection_handle,
			box.pick_count,
			JSON.stringify(box.discount),
			box.active ? 1 : 0,
			Date.now(),
		)
		.run();
}

export async function deleteBox(db: D1Like, shop: string, handle: string): Promise<void> {
	await db.prepare("DELETE FROM boxes WHERE shop = ? AND handle = ?").bind(shop, handle).run();
}

// Store setup (T3/store-setup.ts) calls this once, right after a fresh
// install, so there's always at least one usable box.
export async function seedDefaultBoxIfNone(db: D1Like, shop: string): Promise<void> {
	const existing = await listBoxes(db, shop);
	if (existing.length > 0) return;
	await upsertBox(db, shop, defaultBox());
}
