import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBox, totalPickCount, defaultBox, type BoxRow } from "../shared/boxes.ts";

function row(overrides: Partial<BoxRow> = {}): BoxRow {
	return {
		handle: "default",
		title: "Build your box",
		collection_handle: "flavors",
		pick_count: 4,
		discount: JSON.stringify({ type: "none" }),
		pools: null,
		active: 1,
		...overrides,
	};
}

test("normalizeBox synthesizes a single pool from legacy columns when pools is null", () => {
	const box = normalizeBox(row({ collection_handle: "flavors", pick_count: 4, pools: null }));
	assert.deepEqual(box.pools, [{ collection_handle: "flavors", count: 4 }]);
});

test("normalizeBox synthesizes a pool with a null collection_handle for the seeded default box shape", () => {
	const box = normalizeBox(row({ collection_handle: null, pick_count: 4, pools: null }));
	assert.deepEqual(box.pools, [{ collection_handle: null, count: 4 }]);
});

test("normalizeBox round-trips a real pools value untouched", () => {
	const pools = [
		{ collection_handle: "light-roast", count: 2 },
		{ collection_handle: "medium-roast", count: 1 },
	];
	const box = normalizeBox(row({ pools: JSON.stringify(pools) }));
	assert.deepEqual(box.pools, pools);
});

test("normalizeBox parses discount and active alongside pools", () => {
	const box = normalizeBox(
		row({ discount: JSON.stringify({ type: "percent", percent: 10 }), active: 0 }),
	);
	assert.deepEqual(box.discount, { type: "percent", percent: 10 });
	assert.equal(box.active, false);
});

test("totalPickCount sums pool counts", () => {
	assert.equal(
		totalPickCount([
			{ collection_handle: "a", count: 2 },
			{ collection_handle: "b", count: 3 },
		]),
		5,
	);
});

test("totalPickCount is 0 for an empty pool list", () => {
	assert.equal(totalPickCount([]), 0);
});

test("defaultBox is a valid single-pool box matching its own pick_count", () => {
	const box = defaultBox();
	assert.deepEqual(box.pools, [{ collection_handle: null, count: box.pick_count }]);
	assert.equal(totalPickCount(box.pools), box.pick_count);
});
