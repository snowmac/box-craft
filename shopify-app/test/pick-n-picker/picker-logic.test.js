import { test } from "node:test";
import assert from "node:assert/strict";
import {
	computeBundleTotal,
	buildAddToCartPayload,
	shouldRunGuardrailCheck,
	buildBundleAddedBeacon,
	allPoolsFull,
	flattenSelections,
} from "../../extensions/pick-n-picker/assets/pick-n-picker.js";

test("computeBundleTotal sums selected item prices", () => {
	const selections = new Map([
		["v1", { price: 9.99 }],
		["v2", { price: 12.5 }],
	]);
	assert.equal(computeBundleTotal(selections), 22.49);
});

test("computeBundleTotal rounds to the nearest cent", () => {
	const selections = new Map([
		["v1", { price: 0.1 }],
		["v2", { price: 0.2 }],
	]);
	// 0.1 + 0.2 === 0.30000000000000004 in floating point
	assert.equal(computeBundleTotal(selections), 0.3);
});

test("computeBundleTotal of an empty selection is zero", () => {
	assert.equal(computeBundleTotal(new Map()), 0);
});

test("buildAddToCartPayload writes _bundle_id, _bundle_price, and _bundle_box on every line", () => {
	const selections = new Map([
		["v1", { price: 10 }],
		["v2", { price: 15 }],
	]);
	const payload = buildAddToCartPayload(selections, "bundle-123", 25, "coffee");

	assert.equal(payload.items.length, 2);
	for (const item of payload.items) {
		assert.equal(item.quantity, 1);
		assert.equal(item.properties._bundle_id, "bundle-123");
		assert.equal(item.properties._bundle_price, "25.00");
		assert.equal(item.properties._bundle_box, "coffee");
	}
	assert.deepEqual(
		payload.items.map((i) => i.id).sort(),
		["v1", "v2"],
	);
});

test("shouldRunGuardrailCheck is false below 2 selections", () => {
	assert.equal(shouldRunGuardrailCheck(0), false);
	assert.equal(shouldRunGuardrailCheck(1), false);
});

test("shouldRunGuardrailCheck is true at 2 or more selections", () => {
	assert.equal(shouldRunGuardrailCheck(2), true);
	assert.equal(shouldRunGuardrailCheck(4), true);
});

test("allPoolsFull is false when any pool is only partially selected", () => {
	const selections = new Map([
		[0, new Map([["v1", { price: 1 }], ["v2", { price: 1 }]])], // full, needs 2
		[1, new Map()], // empty, needs 1
	]);
	const requiredCounts = new Map([
		[0, 2],
		[1, 1],
	]);
	assert.equal(allPoolsFull(selections, requiredCounts), false);
});

test("allPoolsFull is true only once every pool is selected to its exact required count", () => {
	const selections = new Map([
		[0, new Map([["v1", { price: 1 }], ["v2", { price: 1 }]])],
		[1, new Map([["v3", { price: 1 }]])],
	]);
	const requiredCounts = new Map([
		[0, 2],
		[1, 1],
	]);
	assert.equal(allPoolsFull(selections, requiredCounts), true);
});

test("allPoolsFull is false when a pool is over-selected relative to its required count", () => {
	const selections = new Map([[0, new Map([["v1", { price: 1 }], ["v2", { price: 1 }], ["v3", { price: 1 }]])]]);
	const requiredCounts = new Map([[0, 2]]);
	assert.equal(allPoolsFull(selections, requiredCounts), false);
});

test("allPoolsFull is true for a single-pool box (the legacy shape) once it's full", () => {
	const selections = new Map([[0, new Map([["v1", { price: 1 }], ["v2", { price: 1 }]])]]);
	const requiredCounts = new Map([[0, 2]]);
	assert.equal(allPoolsFull(selections, requiredCounts), true);
});

test("flattenSelections has one entry per selected variant across all pools", () => {
	const selections = new Map([
		[0, new Map([["v1", { price: 10 }], ["v2", { price: 12 }]])],
		[1, new Map([["v3", { price: 8 }]])],
	]);
	const flat = flattenSelections(selections);
	assert.equal(flat.size, 3);
	assert.deepEqual([...flat.keys()].sort(), ["v1", "v2", "v3"]);
	assert.deepEqual(flat.get("v3"), { price: 8 });
});

test("flattenSelections feeding buildAddToCartPayload produces one line per variant across pools", () => {
	const selections = new Map([
		[0, new Map([["v1", { price: 10 }], ["v2", { price: 12 }]])],
		[1, new Map([["v3", { price: 8 }]])],
	]);
	const flat = flattenSelections(selections);
	const payload = buildAddToCartPayload(flat, "bundle-abc", computeBundleTotal(flat), "coffee");
	assert.equal(payload.items.length, 3);
	assert.deepEqual(
		payload.items.map((i) => i.id).sort(),
		["v1", "v2", "v3"],
	);
	for (const item of payload.items) {
		assert.equal(item.properties._bundle_box, "coffee");
	}
});

test("buildBundleAddedBeacon serializes a strict bundle_added payload", () => {
	const json = buildBundleAddedBeacon("box-craft-demo.myshopify.com", "coffee", 4, 99.96);
	assert.deepEqual(JSON.parse(json), {
		type: "bundle_added",
		shop: "box-craft-demo.myshopify.com",
		boxHandle: "coffee",
		itemCount: 4,
		totalPrice: 99.96,
	});
});
