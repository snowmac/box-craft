import { test } from "node:test";
import assert from "node:assert/strict";
import {
	isValidHandle,
	isValidPickCount,
	isValidDiscount,
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

test("validateBoxInput accepts a well-formed box", () => {
	const result = validateBoxInput({
		handle: "default",
		title: "Build your box",
		collection_handle: "flavors",
		pick_count: 4,
		discount: { type: "none" },
	});
	assert.deepEqual(result, { valid: true, errors: [] });
});

test("validateBoxInput accepts a null collection_handle", () => {
	const result = validateBoxInput({
		handle: "default",
		title: "Build your box",
		collection_handle: null,
		pick_count: 4,
		discount: { type: "none" },
	});
	assert.equal(result.valid, true);
});

test("validateBoxInput collects every field error, not just the first", () => {
	const result = validateBoxInput({
		handle: "NOT VALID",
		title: "",
		collection_handle: 5,
		pick_count: 0,
		discount: { type: "bogus" },
	});
	assert.equal(result.valid, false);
	assert.equal(result.errors.length, 5);
});

test("toBox defaults active to true unless explicitly false", () => {
	const box = toBox({
		handle: "default",
		title: "Build your box",
		collection_handle: null,
		pick_count: 4,
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
