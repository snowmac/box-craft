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

// T6/D6: unknown-stock policy. "known: false" means no bitmap entry at all
// (as opposed to a real entry with zero locations).

test("block policy (default): an unknown variant blocks, same as today", () => {
	const result = checkCompatibility(
		[
			{ variantId: "v1", locations: ["L1"] },
			{ variantId: "v2", locations: [], known: false },
		],
		"block",
	);
	assert.equal(result.compatible, false);
});

test("allow policy: an unknown variant is left out of the intersection, not treated as unavailable", () => {
	const result = checkCompatibility(
		[
			{ variantId: "v1", locations: ["L1"] },
			{ variantId: "v2", locations: [], known: false },
		],
		"allow",
	);
	assert.equal(result.compatible, true);
	if (result.compatible) {
		assert.deepEqual(result.locations, ["L1"]);
	}
});

test("allow policy: all-unknown selection is trivially compatible", () => {
	const result = checkCompatibility(
		[
			{ variantId: "v1", locations: [], known: false },
			{ variantId: "v2", locations: [], known: false },
		],
		"allow",
	);
	assert.equal(result.compatible, true);
});

test("allow policy: a known variant with genuinely zero locations still blocks", () => {
	const result = checkCompatibility(
		[
			{ variantId: "v1", locations: ["L1"] },
			{ variantId: "v2", locations: [], known: true },
		],
		"allow",
	);
	assert.equal(result.compatible, false);
});

test("default policy with no known flags behaves exactly as before (backward compatible)", () => {
	const result = checkCompatibility([
		{ variantId: "v1", locations: ["L1", "L2"] },
		{ variantId: "v2", locations: ["L2"] },
	]);
	assert.equal(result.compatible, true);
	if (result.compatible) {
		assert.deepEqual(result.locations, ["L2"]);
	}
});

// Multi-pool boxes (D9/T6): by the time a selection reaches the guardrail,
// the picker's flattenSelections() has already collapsed every pool into
// one flat variant-id list — checkCompatibility has no concept of pools
// and needs none. These variants are drawn from two different pools (2
// from "light-roast", 1 from "medium-roast") but arrive here exactly as
// any other flat list would.
test("multi-pool selection: a compatible combination drawn from two different pools checks the same as any flat list", () => {
	const result = checkCompatibility([
		{ variantId: "light-roast-1", locations: ["L1", "L2"] }, // pool 0
		{ variantId: "light-roast-2", locations: ["L1", "L3"] }, // pool 0
		{ variantId: "medium-roast-1", locations: ["L1"] }, // pool 1
	]);
	assert.equal(result.compatible, true);
	if (result.compatible) {
		assert.deepEqual(result.locations, ["L1"]);
	}
});

test("multi-pool selection: a conflict between variants from different pools blocks exactly like a same-pool conflict", () => {
	const result = checkCompatibility([
		{ variantId: "light-roast-1", locations: ["L1"] }, // pool 0
		{ variantId: "medium-roast-1", locations: ["L2"] }, // pool 1
	]);
	assert.equal(result.compatible, false);
	if (!result.compatible) {
		assert.deepEqual(result.conflictingVariants.sort(), ["light-roast-1", "medium-roast-1"]);
	}
});
