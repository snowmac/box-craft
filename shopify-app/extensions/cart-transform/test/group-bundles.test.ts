import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildCartTransformOperations,
	discountPercent,
	type BundleBox,
	type CartLine,
	type CartTransformInput,
} from "../src/lib/group-bundles.ts";

const PARENT_VARIANT_ID = "gid://shopify/ProductVariant/999";

const NONE_BOX: BundleBox = { handle: "none-box", discount: { type: "none" } };
const PERCENT_BOX: BundleBox = { handle: "percent-box", discount: { type: "percent", percent: 25 } };
const TIERED_BOX: BundleBox = {
	handle: "tiered-box",
	discount: {
		type: "tiered",
		tiers: [
			{ min_items: 2, percent: 10 },
			{ min_items: 4, percent: 20 },
		],
	},
};

function input(
	lines: CartLine[],
	options: { metafieldValue?: string | null; boxes?: BundleBox[] } = {},
): CartTransformInput {
	const { metafieldValue = PARENT_VARIANT_ID, boxes } = options;
	return {
		cartTransform: {
			metafield: metafieldValue ? { value: metafieldValue } : null,
			boxes: boxes ? { value: JSON.stringify(boxes) } : null,
		},
		cart: { lines },
	};
}

function line(overrides: Partial<CartLine> & { id: string }): CartLine {
	return {
		quantity: 1,
		bundleId: null,
		bundleBox: null,
		sellingPlanAllocation: null,
		...overrides,
	};
}

// --- discountPercent (pure) ---

test("discountPercent: an unknown box (undefined) has no discount", () => {
	assert.equal(discountPercent(undefined, 4), 0);
});

test("discountPercent: a 'none' box has no discount regardless of item count", () => {
	assert.equal(discountPercent(NONE_BOX, 100), 0);
});

test("discountPercent: a 'percent' box applies its flat percent regardless of item count", () => {
	assert.equal(discountPercent(PERCENT_BOX, 1), 25);
	assert.equal(discountPercent(PERCENT_BOX, 50), 25);
});

test("discountPercent: a 'tiered' box below the smallest tier has no discount", () => {
	assert.equal(discountPercent(TIERED_BOX, 1), 0);
});

test("discountPercent: a 'tiered' box at a tier boundary gets that tier's percent", () => {
	assert.equal(discountPercent(TIERED_BOX, 2), 10);
	assert.equal(discountPercent(TIERED_BOX, 4), 20);
});

test("discountPercent: a 'tiered' box between boundaries gets the highest tier already met", () => {
	assert.equal(discountPercent(TIERED_BOX, 3), 10);
	assert.equal(discountPercent(TIERED_BOX, 10), 20);
});

// --- buildCartTransformOperations ---

test("empty cart produces no operations", () => {
	const result = buildCartTransformOperations(input([]));
	assert.deepEqual(result.operations, []);
});

test("lines with no _bundle_id pass through untouched", () => {
	const result = buildCartTransformOperations(input([line({ id: "gid://shopify/CartLine/1" })]));
	assert.deepEqual(result.operations, []);
});

test("N lines sharing one _bundle_id merge into one operation", () => {
	const result = buildCartTransformOperations(
		input(
			[
				line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundleBox: { value: "percent-box" } }),
				line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" }, bundleBox: { value: "percent-box" } }),
				line({ id: "gid://shopify/CartLine/3", bundleId: { value: "bundle-a" }, bundleBox: { value: "percent-box" } }),
			],
			{ boxes: [PERCENT_BOX] },
		),
	);

	assert.equal(result.operations.length, 1);
	const op = result.operations[0].linesMerge;
	assert.equal(op.parentVariantId, PARENT_VARIANT_ID);
	assert.equal(op.price?.percentageDecrease.value, "25");
	assert.deepEqual(
		op.cartLines.map((l) => l.cartLineId).sort(),
		["gid://shopify/CartLine/1", "gid://shopify/CartLine/2", "gid://shopify/CartLine/3"],
	);
});

test("single-item bundle still merges (one component, one pick)", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" } })]),
	);
	assert.equal(result.operations.length, 1);
	assert.equal(result.operations[0].linesMerge.cartLines.length, 1);
});

test("two distinct bundle IDs produce two separate operations", () => {
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" } }),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" } }),
			line({ id: "gid://shopify/CartLine/3", bundleId: { value: "bundle-b" } }),
			line({ id: "gid://shopify/CartLine/4", bundleId: { value: "bundle-b" } }),
		]),
	);
	assert.equal(result.operations.length, 2);
});

test("a selling-plan line is excluded from grouping and doesn't error", () => {
	const result = buildCartTransformOperations(
		input([
			line({
				id: "gid://shopify/CartLine/1",
				bundleId: { value: "bundle-a" },
				sellingPlanAllocation: { sellingPlan: { id: "gid://shopify/SellingPlan/1" } },
			}),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" } }),
		]),
	);
	assert.equal(result.operations.length, 1);
	assert.deepEqual(
		result.operations[0].linesMerge.cartLines.map((l) => l.cartLineId),
		["gid://shopify/CartLine/2"],
	);
});

test("a cart mixing a one-time bundle and an untouched subscription line only merges the bundle", () => {
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" } }),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" } }),
			line({
				id: "gid://shopify/CartLine/3",
				sellingPlanAllocation: { sellingPlan: { id: "gid://shopify/SellingPlan/1" } },
			}),
		]),
	);
	assert.equal(result.operations.length, 1);
	assert.deepEqual(
		result.operations[0].linesMerge.cartLines.map((l) => l.cartLineId).sort(),
		["gid://shopify/CartLine/1", "gid://shopify/CartLine/2"],
	);
});

test("no placeholder bundle product configured yields no operations rather than an error", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" } })], { metafieldValue: null }),
	);
	assert.deepEqual(result.operations, []);
});

test("an unknown box handle (deleted, or never existed) merges at list price rather than erroring", () => {
	const result = buildCartTransformOperations(
		input(
			[line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundleBox: { value: "does-not-exist" } })],
			{ boxes: [PERCENT_BOX] },
		),
	);
	assert.equal(result.operations.length, 1);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});

test("no boxes metafield at all (store setup hasn't synced boxes yet) merges at list price", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundleBox: { value: "percent-box" } })]),
	);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});

test("a 'none' discount box merges at list price", () => {
	const result = buildCartTransformOperations(
		input(
			[line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundleBox: { value: "none-box" } })],
			{ boxes: [NONE_BOX] },
		),
	);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});

test("a tiered box applies the tier matching the number of lines in the bundle", () => {
	const lines = [1, 2, 3, 4].map((i) =>
		line({ id: `gid://shopify/CartLine/${i}`, bundleId: { value: "bundle-a" }, bundleBox: { value: "tiered-box" } }),
	);
	const result = buildCartTransformOperations(input(lines, { boxes: [TIERED_BOX] }));
	// 4 items meets the 4-item tier (20%), not just the 2-item tier (10%).
	assert.equal(result.operations[0].linesMerge.price?.percentageDecrease.value, "20");
});

test("a tiered box below its smallest tier merges at list price", () => {
	const result = buildCartTransformOperations(
		input(
			[line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundleBox: { value: "tiered-box" } })],
			{ boxes: [TIERED_BOX] },
		),
	);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});

test("D11: a tampered _bundle_price-shaped field on the line has no effect on the computed price", () => {
	// The function's own input type no longer has a bundlePrice field at
	// all (dropped from the GraphQL query), but prove the point directly:
	// even if a client-shaped object smuggled one in, buildCartTransformOperations
	// never reads it.
	const tamperedLine = {
		...line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundleBox: { value: "percent-box" } }),
		bundlePrice: { value: "0.01" },
	};
	const result = buildCartTransformOperations(input([tamperedLine], { boxes: [PERCENT_BOX] }));
	assert.equal(result.operations[0].linesMerge.price?.percentageDecrease.value, "25");
});
