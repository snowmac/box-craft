import { test } from "node:test";
import assert from "node:assert/strict";
import {
	isValidHandle,
	isValidPickCount,
	isValidDiscount,
	validatePools,
	validateBoxInput,
	validateConfigInput,
	toBox,
} from "../src/validate.ts";

test("isValidHandle accepts lowercase alphanumeric and hyphens", () => {
	assert.equal(isValidHandle("default"), true);
	assert.equal(isValidHandle("coffee-box-1"), true);
});

test("isValidHandle rejects uppercase, spaces, empty, and over-length", () => {
	assert.equal(isValidHandle("Default"), false);
	assert.equal(isValidHandle("my box"), false);
	assert.equal(isValidHandle(""), false);
	assert.equal(isValidHandle("a".repeat(41)), false);
	assert.equal(isValidHandle(123), false);
});

test("isValidPickCount accepts integers 1-20", () => {
	assert.equal(isValidPickCount(1), true);
	assert.equal(isValidPickCount(20), true);
	assert.equal(isValidPickCount(4), true);
});

test("isValidPickCount rejects 0, 21, non-integers, and non-numbers", () => {
	assert.equal(isValidPickCount(0), false);
	assert.equal(isValidPickCount(21), false);
	assert.equal(isValidPickCount(4.5), false);
	assert.equal(isValidPickCount("4"), false);
});

test("isValidDiscount accepts none", () => {
	assert.equal(isValidDiscount({ type: "none" }), true);
});

test("isValidDiscount accepts percent within 0-90", () => {
	assert.equal(isValidDiscount({ type: "percent", percent: 0 }), true);
	assert.equal(isValidDiscount({ type: "percent", percent: 90 }), true);
	assert.equal(isValidDiscount({ type: "percent", percent: 10.5 }), true);
});

test("isValidDiscount rejects percent outside 0-90", () => {
	assert.equal(isValidDiscount({ type: "percent", percent: -1 }), false);
	assert.equal(isValidDiscount({ type: "percent", percent: 91 }), false);
});

test("isValidDiscount accepts tiers sorted ascending by min_items", () => {
	assert.equal(
		isValidDiscount({
			type: "tiered",
			tiers: [
				{ min_items: 2, percent: 5 },
				{ min_items: 4, percent: 10 },
				{ min_items: 6, percent: 15 },
			],
		}),
		true,
	);
});

test("isValidDiscount rejects tiers out of order or with duplicate thresholds", () => {
	assert.equal(
		isValidDiscount({
			type: "tiered",
			tiers: [
				{ min_items: 4, percent: 10 },
				{ min_items: 2, percent: 5 },
			],
		}),
		false,
	);
	assert.equal(
		isValidDiscount({
			type: "tiered",
			tiers: [
				{ min_items: 4, percent: 10 },
				{ min_items: 4, percent: 15 },
			],
		}),
		false,
	);
});

test("isValidDiscount rejects an empty tiers array and a min_items below 1", () => {
	assert.equal(isValidDiscount({ type: "tiered", tiers: [] }), false);
	assert.equal(isValidDiscount({ type: "tiered", tiers: [{ min_items: 0, percent: 5 }] }), false);
});

test("isValidDiscount rejects an unknown type or non-object", () => {
	assert.equal(isValidDiscount({ type: "fixed" }), false);
	assert.equal(isValidDiscount(null), false);
	assert.equal(isValidDiscount("none"), false);
});

test("validatePools accepts a well-formed single pool", () => {
	assert.deepEqual(validatePools([{ collection_handle: "flavors", count: 4 }]), { valid: true, errors: [] });
});

test("validatePools accepts a well-formed multi-pool box", () => {
	assert.deepEqual(
		validatePools([
			{ collection_handle: "light-roast", count: 2 },
			{ collection_handle: "medium-roast", count: 1 },
		]),
		{ valid: true, errors: [] },
	);
});

test("validatePools rejects an empty array", () => {
	assert.equal(validatePools([]).valid, false);
});

test("validatePools rejects a non-array", () => {
	assert.equal(validatePools(undefined).valid, false);
	assert.equal(validatePools("nope").valid, false);
});

test("validatePools rejects more than 5 pools", () => {
	const pools = Array.from({ length: 6 }, (_, i) => ({ collection_handle: `c${i}`, count: 1 }));
	assert.equal(validatePools(pools).valid, false);
});

test("validatePools rejects a count out of range (0 or 21)", () => {
	assert.equal(validatePools([{ collection_handle: "a", count: 0 }]).valid, false);
	assert.equal(validatePools([{ collection_handle: "a", count: 21 }]).valid, false);
});

test("validatePools rejects a total count over 20 even with each pool individually valid", () => {
	const result = validatePools([
		{ collection_handle: "a", count: 15 },
		{ collection_handle: "b", count: 10 },
	]);
	assert.equal(result.valid, false);
	assert.ok(result.errors.some((e) => e.includes("total count")));
});

test("validatePools rejects a non-string or empty collection_handle", () => {
	assert.equal(validatePools([{ collection_handle: 5, count: 4 }]).valid, false);
	assert.equal(validatePools([{ collection_handle: "", count: 4 }]).valid, false);
	assert.equal(validatePools([{ collection_handle: "  ", count: 4 }]).valid, false);
});

test("validateBoxInput accepts a well-formed box", () => {
	const result = validateBoxInput({
		handle: "default",
		title: "Build your box",
		pools: [{ collection_handle: "flavors", count: 4 }],
		discount: { type: "none" },
	});
	assert.deepEqual(result, { valid: true, errors: [] });
});

test("validateBoxInput accepts a multi-pool box", () => {
	const result = validateBoxInput({
		handle: "default",
		title: "Build your box",
		pools: [
			{ collection_handle: "light-roast", count: 2 },
			{ collection_handle: "medium-roast", count: 1 },
		],
		discount: { type: "none" },
	});
	assert.equal(result.valid, true);
});

test("validateBoxInput collects every field error, not just the first", () => {
	const result = validateBoxInput({
		handle: "NOT VALID",
		title: "",
		pools: [],
		discount: { type: "bogus" },
	});
	assert.equal(result.valid, false);
	assert.equal(result.errors.length, 4);
});

test("toBox derives collection_handle from pools[0] and pick_count from the sum of pool counts", () => {
	const box = toBox({
		handle: "default",
		title: "Build your box",
		pools: [
			{ collection_handle: "light-roast", count: 2 },
			{ collection_handle: "medium-roast", count: 1 },
		],
		discount: { type: "none" },
	});
	assert.equal(box.collection_handle, "light-roast");
	assert.equal(box.pick_count, 3);
	assert.deepEqual(box.pools, [
		{ collection_handle: "light-roast", count: 2 },
		{ collection_handle: "medium-roast", count: 1 },
	]);
});

test("toBox defaults active to true unless explicitly false", () => {
	const box = toBox({
		handle: "default",
		title: "Build your box",
		pools: [{ collection_handle: "flavors", count: 4 }],
		discount: { type: "none" },
	});
	assert.equal(box.active, true);

	const inactive = toBox({ ...box, active: false });
	assert.equal(inactive.active, false);
});

test("validateConfigInput accepts a partial update", () => {
	assert.deepEqual(validateConfigInput({ guardrail_enabled: false }), { valid: true, errors: [] });
	assert.deepEqual(validateConfigInput({ unknown_stock_policy: "block" }), { valid: true, errors: [] });
	assert.deepEqual(validateConfigInput({}), { valid: true, errors: [] });
});

test("validateConfigInput rejects a bad unknown_stock_policy or wrong types", () => {
	assert.equal(validateConfigInput({ unknown_stock_policy: "maybe" }).valid, false);
	assert.equal(validateConfigInput({ guardrail_enabled: "yes" }).valid, false);
});
