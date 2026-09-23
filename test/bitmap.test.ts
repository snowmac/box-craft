import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLocationUpdates, bitmapKey, toVariantGid } from "../shared/bitmap.ts";

test("bitmapKey namespaces the raw identifier", () => {
	assert.equal(bitmapKey("gid://shopify/ProductVariant/1"), "sku:gid://shopify/ProductVariant/1");
});

test("applyLocationUpdates adds a location that came into stock", () => {
	const result = applyLocationUpdates([], { L1: true });
	assert.deepEqual(result, ["L1"]);
});

test("applyLocationUpdates removes a location that went out of stock", () => {
	const result = applyLocationUpdates(["L1", "L2"], { L1: false });
	assert.deepEqual(result, ["L2"]);
});

test("applyLocationUpdates dedupes and sorts output", () => {
	const result = applyLocationUpdates(["L2"], { L2: true, L1: true });
	assert.deepEqual(result, ["L1", "L2"]);
});

test("applyLocationUpdates collapses a burst of updates for one location to its final state", () => {
	// Simulates what the debounce alarm sees after coalescing many events:
	// only the last known state per location survives.
	let pending: Record<string, boolean> = {};
	for (let i = 0; i < 50; i++) {
		pending = { ...pending, L1: i % 2 === 0 };
	}
	const result = applyLocationUpdates([], pending);
	assert.deepEqual(result, []);
});

test("toVariantGid turns the storefront's numeric variant id into a GID", () => {
	assert.equal(toVariantGid("55081529966958"), "gid://shopify/ProductVariant/55081529966958");
});

test("toVariantGid leaves a GID unchanged", () => {
	assert.equal(toVariantGid("gid://shopify/ProductVariant/1"), "gid://shopify/ProductVariant/1");
});

test("toVariantGid leaves anything else unchanged rather than guessing", () => {
	assert.equal(toVariantGid("abc"), "abc");
});
