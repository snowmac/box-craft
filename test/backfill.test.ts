import { test } from "node:test";
import assert from "node:assert/strict";
import { runBackfill, type BackfillOptions } from "../shared/backfill.ts";
import { bitmapKey, inventoryItemMapKey } from "../shared/bitmap.ts";

function variantNode(
	id: string,
	inventoryItemId: string,
	levels: Array<{ locationId: string; available: number }>,
) {
	return {
		id,
		inventoryItem: {
			id: inventoryItemId,
			inventoryLevels: {
				pageInfo: { hasNextPage: false, endCursor: null },
				edges: levels.map((l) => ({
					node: {
						location: { id: l.locationId },
						quantities: [{ name: "available", quantity: l.available }],
					},
				})),
			},
		},
	};
}

function mockFetch(pages: Array<{ nodes: ReturnType<typeof variantNode>[]; hasNextPage: boolean }>) {
	let call = 0;
	const requests: Array<{ variables: Record<string, unknown> }> = [];
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		const body = JSON.parse(init!.body as string) as { variables: Record<string, unknown> };
		requests.push({ variables: body.variables });
		const page = pages[call++];
		return new Response(
			JSON.stringify({
				data: {
					productVariants: {
						pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.hasNextPage ? `cursor-${call}` : null },
						edges: page.nodes.map((n) => ({ node: n })),
					},
				},
			}),
			{ status: 200 },
		);
	}) as typeof fetch;
	return { fetchImpl, requests };
}

function options(fetchImpl: typeof fetch): BackfillOptions {
	return { shop: "box-craft-demo.myshopify.com", accessToken: "tok", apiVersion: "2026-01", fetchImpl, now: () => "2026-09-23T00:00:00.000Z" };
}

test("builds a bitmap entry and an inventory-item map entry per variant", async () => {
	const { fetchImpl } = mockFetch([
		{
			nodes: [
				variantNode("gid://shopify/ProductVariant/1", "gid://shopify/InventoryItem/10", [
					{ locationId: "gid://shopify/Location/1", available: 5 },
				]),
			],
			hasNextPage: false,
		},
	]);

	const result = await runBackfill(options(fetchImpl));

	assert.equal(result.variantCount, 1);
	assert.deepEqual(result.entries, [
		{
			key: bitmapKey("gid://shopify/ProductVariant/1"),
			value: JSON.stringify({ locations: ["gid://shopify/Location/1"], updatedAt: "2026-09-23T00:00:00.000Z" }),
		},
		{ key: inventoryItemMapKey("10"), value: "gid://shopify/ProductVariant/1" },
	]);
});

test("filters out locations with zero (or missing) available quantity", async () => {
	const { fetchImpl } = mockFetch([
		{
			nodes: [
				variantNode("gid://shopify/ProductVariant/1", "gid://shopify/InventoryItem/10", [
					{ locationId: "gid://shopify/Location/1", available: 0 },
					{ locationId: "gid://shopify/Location/2", available: 3 },
				]),
			],
			hasNextPage: false,
		},
	]);

	const result = await runBackfill(options(fetchImpl));
	const bitmapEntry = JSON.parse(result.entries[0].value);
	assert.deepEqual(bitmapEntry.locations, ["gid://shopify/Location/2"]);
});

test("sorts locations for a stable, comparable value", async () => {
	const { fetchImpl } = mockFetch([
		{
			nodes: [
				variantNode("gid://shopify/ProductVariant/1", "gid://shopify/InventoryItem/10", [
					{ locationId: "gid://shopify/Location/2", available: 1 },
					{ locationId: "gid://shopify/Location/1", available: 1 },
				]),
			],
			hasNextPage: false,
		},
	]);

	const result = await runBackfill(options(fetchImpl));
	const bitmapEntry = JSON.parse(result.entries[0].value);
	assert.deepEqual(bitmapEntry.locations, ["gid://shopify/Location/1", "gid://shopify/Location/2"]);
});

test("pages through multiple pages of variants, following the cursor", async () => {
	const { fetchImpl, requests } = mockFetch([
		{ nodes: [variantNode("v1", "gid://shopify/InventoryItem/1", [])], hasNextPage: true },
		{ nodes: [variantNode("v2", "gid://shopify/InventoryItem/2", [])], hasNextPage: false },
	]);

	const result = await runBackfill(options(fetchImpl));

	assert.equal(result.variantCount, 2);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].variables.cursor, null);
	assert.equal(requests[1].variables.cursor, "cursor-1");
});

test("a variant with no inventory item id numeric suffix still gets a bitmap entry", async () => {
	const { fetchImpl } = mockFetch([
		{ nodes: [variantNode("gid://shopify/ProductVariant/1", "", [])], hasNextPage: false },
	]);

	const result = await runBackfill(options(fetchImpl));
	// No inventory-item-map entry (nothing to key it by), but the bitmap
	// entry is still produced.
	assert.equal(result.entries.length, 1);
	assert.equal(result.entries[0].key, bitmapKey("gid://shopify/ProductVariant/1"));
});

test("throws on a non-ok Admin API response", async () => {
	const fetchImpl = (async () => new Response("nope", { status: 401 })) as typeof fetch;
	await assert.rejects(() => runBackfill(options(fetchImpl)), /401/);
});

test("throws when the Admin API returns GraphQL errors", async () => {
	const fetchImpl = (async () =>
		new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), { status: 200 })) as typeof fetch;
	await assert.rejects(() => runBackfill(options(fetchImpl)), /bad query/);
});
