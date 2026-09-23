export interface BitmapEntry {
	locations: string[];
	updatedAt: string;
}

export function bitmapKey(variantGid: string): string {
	return `sku:${variantGid}`;
}

// The storefront (Liquid's variant.id, /cart/add.js) uses numeric variant
// ids, but the bitmap is keyed by Admin API GID. Normalize at the lookup.
export function toVariantGid(variantId: string): string {
	return /^\d+$/.test(variantId) ? `gid://shopify/ProductVariant/${variantId}` : variantId;
}

// Shopify's inventory_levels/update webhook carries inventory_item_id, not
// a variant GID, so the webhook consumer needs a lookup to translate one to
// the other before it can write to the (variant-GID-keyed) bitmap. Stored
// in the same KV namespace as the bitmap itself, under this prefix, to
// avoid provisioning a second namespace. Populated by the backfill script;
// see workers/webhook-consumer/src/index.ts for how it's consumed.
export function inventoryItemMapKey(inventoryItemId: string): string {
	return `invitem:${inventoryItemId}`;
}

export function applyLocationUpdates(
	current: string[],
	updates: Record<string, boolean>,
): string[] {
	const set = new Set(current);
	for (const [locationId, available] of Object.entries(updates)) {
		if (available) {
			set.add(locationId);
		} else {
			set.delete(locationId);
		}
	}
	return [...set].sort();
}
