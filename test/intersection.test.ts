import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompatibility } from "../shared/intersection.ts";

test("full overlap: all variants share every location", () => {
	const result = checkCompatibility([
		{ variantId: "v1", locations: ["L1", "L2"] },
		{ variantId: "v2", locations: ["L1", "L2"] },
	]);
	assert.equal(result.compatible, true);
	if (result.compatible) {
		assert.deepEqual(result.locations, ["L1", "L2"]);
	}
});

test("partial overlap: compatible via the shared location", () => {
	const result = checkCompatibility([
		{ variantId: "v1", locations: ["L1", "L2"] },
		{ variantId: "v2", locations: ["L2", "L3"] },
	]);
	assert.equal(result.compatible, true);
	if (result.compatible) {
		assert.deepEqual(result.locations, ["L2"]);
	}
});

test("zero overlap: blocks and reports both variants as conflicting", () => {
	const result = checkCompatibility([
		{ variantId: "v1", locations: ["L1"] },
		{ variantId: "v2", locations: ["L2"] },
	]);
	assert.equal(result.compatible, false);
	if (!result.compatible) {
		assert.deepEqual(result.conflictingVariants.sort(), ["v1", "v2"]);
	}
});

test("one odd variant out of three is identified as the conflict", () => {
	const result = checkCompatibility([
		{ variantId: "v1", locations: ["L1", "L2"] },
		{ variantId: "v2", locations: ["L1", "L2"] },
		{ variantId: "v3", locations: ["L3"] },
	]);
	assert.equal(result.compatible, false);
	if (!result.compatible) {
		assert.deepEqual(result.conflictingVariants, ["v3"]);
	}
});

test("empty selection is trivially compatible", () => {
	const result = checkCompatibility([]);
	assert.equal(result.compatible, true);
	if (result.compatible) {
		assert.deepEqual(result.locations, []);
	}
});

test("variant with no stock anywhere blocks the whole selection", () => {
	const result = checkCompatibility([
		{ variantId: "v1", locations: ["L1"] },
		{ variantId: "v2", locations: [] },
	]);
	assert.equal(result.compatible, false);
});
