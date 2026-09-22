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
		shop: { metafield: metafieldValue ? { value: metafieldValue } : null },
		cart: { lines },
	};
}

function line(overrides: Partial<CartLine> & { id: string }): CartLine {
	return {
		quantity: 1,
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

test("N lines sharing one _bundle_id merge into one operation with summed price", () => {
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
	assert.equal(op.price.fixedPricePerUnit.amount, "40.00");
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
