// T14: the KV inspector view's two lookups, kept separate from the view's
// HTML so the KV-key logic (shared with the Guardrail Worker/webhook
// consumer) is directly testable.
import { bitmapKey, toVariantGid, inventoryItemMapKey, type BitmapEntry } from "../../../shared/bitmap.ts";

export async function lookupVariantBitmap(kv: KVNamespace, variantId: string): Promise<BitmapEntry | null> {
	const raw = await kv.get(bitmapKey(toVariantGid(variantId)));
	return raw ? (JSON.parse(raw) as BitmapEntry) : null;
}

export async function lookupInventoryItemVariant(kv: KVNamespace, inventoryItemId: string): Promise<string | null> {
	return kv.get(inventoryItemMapKey(inventoryItemId));
}
