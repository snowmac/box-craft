import { test } from "node:test";
import assert from "node:assert/strict";
import {
	getShopConfig,
	upsertShopConfig,
	listBoxes,
	upsertBox,
	deleteBox,
	seedDefaultBoxIfNone,
} from "../src/db.ts";
import type { D1Like } from "../../../shared/events.ts";
import type { Box } from "../../../shared/boxes.ts";

// A small in-memory fake implementing exactly the query shapes db.ts
// issues — real enough to test upsert/list/delete semantics without a
// real SQLite instance.
function fakeD1(): D1Like {
	const shopConfig = new Map<string, { guardrail_enabled: number; unknown_stock_policy: string }>();
	const boxes = new Map<string, Record<string, unknown>>();

	return {
		prepare(query: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async run() {
							if (query.includes("INSERT INTO shop_config")) {
								const [shop, guardrail_enabled, unknown_stock_policy] = args as [string, number, string];
								shopConfig.set(shop, { guardrail_enabled, unknown_stock_policy });
							} else if (query.includes("INSERT INTO boxes")) {
								const [shop, handle, title, collection_handle, pick_count, discount, pools, active] = args;
								boxes.set(`${shop}\u0000${handle}`, {
									shop,
									handle,
									title,
									collection_handle,
									pick_count,
									discount,
									pools,
									active,
								});
							} else if (query.includes("DELETE FROM boxes")) {
								const [shop, handle] = args as [string, string];
								boxes.delete(`${shop}\u0000${handle}`);
							}
						},
						async first<T>() {
							if (query.includes("FROM shop_config")) {
								const [shop] = args as [string];
								return (shopConfig.get(shop) as T) ?? null;
							}
							return null;
						},
						async all<T>() {
							if (query.includes("FROM boxes")) {
								const [shop] = args as [string];
								const results = [...boxes.values()]
									.filter((r) => r.shop === shop)
									.sort((a, b) => String(a.handle).localeCompare(String(b.handle)));
								return { results: results as T[] };
							}
							return { results: [] as T[] };
						},
					};
				},
			};
		},
	};
}

const SHOP = "box-craft-demo.myshopify.com";

test("getShopConfig returns defaults (enabled, allow) when nothing is stored", async () => {
	const db = fakeD1();
	const config = await getShopConfig(db, SHOP);
	assert.deepEqual(config, { guardrailEnabled: true, unknownStockPolicy: "allow" });
});

test("upsertShopConfig merges a partial patch onto current (or default) config, and persists it", async () => {
	const db = fakeD1();
	const updated = await upsertShopConfig(db, SHOP, { unknownStockPolicy: "block" });
	assert.deepEqual(updated, { guardrailEnabled: true, unknownStockPolicy: "block" });

	const reread = await getShopConfig(db, SHOP);
	assert.deepEqual(reread, updated);

	const updatedAgain = await upsertShopConfig(db, SHOP, { guardrailEnabled: false });
	assert.deepEqual(updatedAgain, { guardrailEnabled: false, unknownStockPolicy: "block" });
});

function makeBox(overrides: Partial<Box> = {}): Box {
	return {
		handle: "default",
		title: "Build your box",
		collection_handle: null,
		pick_count: 4,
		discount: { type: "none" },
		active: true,
		pools: [{ collection_handle: null, count: 4 }],
		...overrides,
	};
}

test("listBoxes is empty for a shop with none", async () => {
	const db = fakeD1();
	assert.deepEqual(await listBoxes(db, SHOP), []);
});

test("upsertBox creates then updates in place (same handle), listBoxes reflects it", async () => {
	const db = fakeD1();
	await upsertBox(db, SHOP, makeBox({ title: "V1" }));
	await upsertBox(db, SHOP, makeBox({ title: "V2", pick_count: 6 }));

	const boxes = await listBoxes(db, SHOP);
	assert.equal(boxes.length, 1);
	assert.equal(boxes[0].title, "V2");
	assert.equal(boxes[0].pick_count, 6);
});

test("listBoxes only returns boxes for the requested shop, sorted by handle", async () => {
	const db = fakeD1();
	await upsertBox(db, SHOP, makeBox({ handle: "zebra" }));
	await upsertBox(db, SHOP, makeBox({ handle: "apple" }));
	await upsertBox(db, "other-shop.myshopify.com", makeBox({ handle: "should-not-appear" }));

	const boxes = await listBoxes(db, SHOP);
	assert.deepEqual(boxes.map((b) => b.handle), ["apple", "zebra"]);
});

test("upsertBox round-trips a tiered discount through JSON storage", async () => {
	const db = fakeD1();
	const tiered: Box = makeBox({
		discount: { type: "tiered", tiers: [{ min_items: 4, percent: 10 }, { min_items: 8, percent: 20 }] },
	});
	await upsertBox(db, SHOP, tiered);

	const [box] = await listBoxes(db, SHOP);
	assert.deepEqual(box.discount, tiered.discount);
});

test("deleteBox removes only the targeted box", async () => {
	const db = fakeD1();
	await upsertBox(db, SHOP, makeBox({ handle: "keep" }));
	await upsertBox(db, SHOP, makeBox({ handle: "remove" }));

	await deleteBox(db, SHOP, "remove");

	const boxes = await listBoxes(db, SHOP);
	assert.deepEqual(boxes.map((b) => b.handle), ["keep"]);
});

test("seedDefaultBoxIfNone creates a default box only when the shop has none", async () => {
	const db = fakeD1();
	await seedDefaultBoxIfNone(db, SHOP);

	let boxes = await listBoxes(db, SHOP);
	assert.equal(boxes.length, 1);
	assert.equal(boxes[0].handle, "default");
	assert.equal(boxes[0].pick_count, 4);

	// A second call must not add a duplicate or overwrite a merchant's edits.
	await upsertBox(db, SHOP, makeBox({ title: "Merchant-edited title" }));
	await seedDefaultBoxIfNone(db, SHOP);

	boxes = await listBoxes(db, SHOP);
	assert.equal(boxes.length, 1);
	assert.equal(boxes[0].title, "Merchant-edited title");
});
