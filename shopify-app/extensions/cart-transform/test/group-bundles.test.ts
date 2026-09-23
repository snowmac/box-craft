import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildCartTransformOperations,
	type CartLine,
	type CartTransformInput,
} from "../src/lib/group-bundles.ts";

const PARENT_VARIANT_ID = "gid://shopify/ProductVariant/999";

function input(lines: CartLine[], metafieldValue: string | null = PARENT_VARIANT_ID): CartTransformInput {
	return {
		cartTransform: { metafield: metafieldValue ? { value: metafieldValue } : null },
		cart: { lines },
	};
}

function line(overrides: Partial<CartLine> & { id: string }): CartLine {
	return {
		quantity: 1,
		cost: { totalAmount: { amount: "20.00" } },
		bundleId: null,
		bundlePrice: null,
		sellingPlanAllocation: null,
		...overrides,
	};
}

test("empty cart produces no operations", () => {
	const result = buildCartTransformOperations(input([]));
	assert.deepEqual(result.operations, []);
});

test("lines with no _bundle_id pass through untouched", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1" })]),
	);
	assert.deepEqual(result.operations, []);
});

test("N lines sharing one _bundle_id merge into one operation", () => {
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "40.00" } }),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" }, bundlePrice: { value: "40.00" } }),
			line({ id: "gid://shopify/CartLine/3", bundleId: { value: "bundle-a" }, bundlePrice: { value: "40.00" } }),
		]),
	);

	assert.equal(result.operations.length, 1);
	const op = result.operations[0].linesMerge;
	assert.equal(op.parentVariantId, PARENT_VARIANT_ID);
	// 3 lines x $20 = $60 at list, bundle price $40 -> 33.3333% off
	assert.equal(op.price?.percentageDecrease.value, "33.3333");
	assert.deepEqual(
		op.cartLines.map((l) => l.cartLineId).sort(),
		["gid://shopify/CartLine/1", "gid://shopify/CartLine/2", "gid://shopify/CartLine/3"],
	);
});

test("single-item bundle still merges (one component, one pick)", () => {
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "12.00" } }),
		]),
	);
	assert.equal(result.operations.length, 1);
	assert.equal(result.operations[0].linesMerge.cartLines.length, 1);
});

test("two distinct bundle IDs produce two separate operations", () => {
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "20.00" } }),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" }, bundlePrice: { value: "20.00" } }),
			line({ id: "gid://shopify/CartLine/3", bundleId: { value: "bundle-b" }, bundlePrice: { value: "30.00" } }),
			line({ id: "gid://shopify/CartLine/4", bundleId: { value: "bundle-b" }, bundlePrice: { value: "30.00" } }),
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
				bundlePrice: { value: "20.00" },
				sellingPlanAllocation: { sellingPlan: { id: "gid://shopify/SellingPlan/1" } },
			}),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" }, bundlePrice: { value: "20.00" } }),
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
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "20.00" } }),
			line({ id: "gid://shopify/CartLine/2", bundleId: { value: "bundle-a" }, bundlePrice: { value: "20.00" } }),
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
		input(
			[line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "20.00" } })],
			null,
		),
	);
	assert.deepEqual(result.operations, []);
});

test("a bundle line missing its price is skipped rather than guessing a price", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" } })]),
	);
	assert.deepEqual(result.operations, []);
});

test("bundle price is expressed as a percentage decrease off the merged lines' total", () => {
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", cost: { totalAmount: { amount: "30.00" } }, bundleId: { value: "bundle-a" }, bundlePrice: { value: "45.00" } }),
			line({ id: "gid://shopify/CartLine/2", quantity: 2, cost: { totalAmount: { amount: "30.00" } }, bundleId: { value: "bundle-a" }, bundlePrice: { value: "45.00" } }),
		]),
	);
	// $60 at list, $45 bundle price -> 25% off
	assert.equal(result.operations[0].linesMerge.price?.percentageDecrease.value, "25");
});

test("bundle price at or above the lines' total merges with no price adjustment", () => {
	// percentageDecrease can't go negative, so a bundle priced above list
	// can't be charged as such; merge at list price rather than drop the bundle.
	const result = buildCartTransformOperations(
		input([
			line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "25.00" } }),
		]),
	);
	assert.equal(result.operations.length, 1);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});

test("an unparseable bundle price is skipped rather than guessing a price", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1", bundleId: { value: "bundle-a" }, bundlePrice: { value: "abc" } })]),
	);
	assert.deepEqual(result.operations, []);
});

test("a bundle priced exactly at list gets no price adjustment despite float rounding", () => {
	// 699.95 + 729.95 + 749.95 + 600 = 2779.8500000000004 in floating point;
	// a naive comparison emits a 0% decrease, which Shopify rejects.
	const lines = ["699.95", "729.95", "749.95", "600.00"].map((amount, i) =>
		line({ id: `gid://shopify/CartLine/${i}`, cost: { totalAmount: { amount } }, bundleId: { value: "b" }, bundlePrice: { value: "2779.85" } }),
	);
	const result = buildCartTransformOperations(input(lines));
	assert.equal(result.operations.length, 1);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});

test("a discount too small to show at 4 decimal places is omitted rather than sent as 0", () => {
	const result = buildCartTransformOperations(
		input([line({ id: "gid://shopify/CartLine/1", cost: { totalAmount: { amount: "1000000.00" } }, bundleId: { value: "b" }, bundlePrice: { value: "999999.99" } })]),
	);
	assert.equal(result.operations[0].linesMerge.price, undefined);
});
