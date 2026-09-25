import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupVariantBitmap, lookupInventoryItemVariant } from "../src/kv-inspector.ts";
import { bitmapKey, inventoryItemMapKey } from "../../../shared/bitmap.ts";
import type { KVLike } from "../../../shared/kv.ts";

function mockKv(entries: Record<string, string>): KVLike {
	return { async get(key: string) { return key in entries ? entries[key] : null; } } as unknown as KVLike;
}

test("lookupVariantBitmap accepts a numeric variant id and normalizes to a GID key", async () => {
	const entry = { locations: ["gid://shopify/Location/1"], updatedAt: "2026-01-01T00:00:00.000Z" };
	const kv = mockKv({ [bitmapKey("gid://shopify/ProductVariant/123")]: JSON.stringify(entry) });
	assert.deepEqual(await lookupVariantBitmap(kv, "123"), entry);
});

test("lookupVariantBitmap accepts a GID directly", async () => {
	const entry = { locations: [], updatedAt: "x" };
	const kv = mockKv({ [bitmapKey("gid://shopify/ProductVariant/999")]: JSON.stringify(entry) });
	assert.deepEqual(await lookupVariantBitmap(kv, "gid://shopify/ProductVariant/999"), entry);
});

test("lookupVariantBitmap returns null for an unknown variant", async () => {
	const kv = mockKv({});
	assert.equal(await lookupVariantBitmap(kv, "1"), null);
});

test("lookupInventoryItemVariant returns the mapped variant GID", async () => {
	const kv = mockKv({ [inventoryItemMapKey("456")]: "gid://shopify/ProductVariant/1" });
	assert.equal(await lookupInventoryItemVariant(kv, "456"), "gid://shopify/ProductVariant/1");
});

test("lookupInventoryItemVariant returns null for an unmapped inventory item", async () => {
	const kv = mockKv({});
	assert.equal(await lookupInventoryItemVariant(kv, "456"), null);
});
