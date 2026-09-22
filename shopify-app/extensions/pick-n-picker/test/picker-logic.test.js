import { test } from "node:test";
import assert from "node:assert/strict";
import {
	computeBundleTotal,
	buildAddToCartPayload,
	shouldRunGuardrailCheck,
} from "../assets/pick-n-picker.js";

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

test("buildAddToCartPayload writes _bundle_id and _bundle_price on every line", () => {
	const selections = new Map([
		["v1", { price: 10 }],
		["v2", { price: 15 }],
	]);
	const payload = buildAddToCartPayload(selections, "bundle-123", 25);

	assert.equal(payload.items.length, 2);
	for (const item of payload.items) {
		assert.equal(item.quantity, 1);
		assert.equal(item.properties._bundle_id, "bundle-123");
		assert.equal(item.properties._bundle_price, "25.00");
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
