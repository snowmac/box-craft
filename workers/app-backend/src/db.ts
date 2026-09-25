import type { D1Like } from "../../../shared/events.ts";
import type { Box, BoxRow } from "../../../shared/boxes.ts";
import { defaultBox, normalizeBox } from "../../../shared/boxes.ts";

// Shared with the Guardrail Worker (T6), which reads the same shop_config
// table to decide whether it's on and which unknown-stock policy applies.
export { getShopConfig, upsertShopConfig, type ShopConfig } from "../../../shared/shop-config.ts";

export async function listBoxes(db: D1Like, shop: string): Promise<Box[]> {
	const { results } = await db
		.prepare(
			"SELECT handle, title, collection_handle, pick_count, discount, pools, active FROM boxes WHERE shop = ? ORDER BY handle",
		)
		.bind(shop)
		.all<BoxRow>();
	return results.map(normalizeBox);
}

export async function upsertBox(db: D1Like, shop: string, box: Box): Promise<void> {
	await db
		.prepare(
			`INSERT INTO boxes (shop, handle, title, collection_handle, pick_count, discount, pools, active, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(shop, handle) DO UPDATE SET
			   title = excluded.title,
			   collection_handle = excluded.collection_handle,
			   pick_count = excluded.pick_count,
			   discount = excluded.discount,
			   pools = excluded.pools,
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
			JSON.stringify(box.pools),
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
