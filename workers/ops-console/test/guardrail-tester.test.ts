import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVariantIdsInput, findMissingBitmapEntries, runGuardrailTest } from "../src/guardrail-tester.ts";
import { bitmapKey } from "../../../shared/bitmap.ts";
import type { KVLike } from "../../../shared/kv.ts";

function mockKv(entries: Record<string, string>): KVLike {
	return { async get(key: string) { return key in entries ? entries[key] : null; } } as unknown as KVLike;
}

test("parseVariantIdsInput splits on commas and newlines, trimming and dropping blanks", () => {
	assert.deepEqual(parseVariantIdsInput("1, 2\n3\n\n 4 ,5"), ["1", "2", "3", "4", "5"]);
});

test("parseVariantIdsInput returns an empty array for blank input", () => {
	assert.deepEqual(parseVariantIdsInput("   \n  "), []);
});

test("findMissingBitmapEntries reports only the variant ids with no bitmap entry", async () => {
	const kv = mockKv({ [bitmapKey("gid://shopify/ProductVariant/1")]: JSON.stringify({ locations: [], updatedAt: "x" }) });
	const missing = await findMissingBitmapEntries(kv, ["1", "2"]);
	assert.deepEqual(missing, ["2"]);
});

test("runGuardrailTest calls the live /check endpoint and reports missing bitmap entries together", async () => {
	const kv = mockKv({ [bitmapKey("gid://shopify/ProductVariant/1")]: JSON.stringify({ locations: [], updatedAt: "x" }) });
	let calledUrl = "";
	let calledBody: unknown;
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calledUrl = String(url);
		calledBody = JSON.parse(init!.body as string);
		return Response.json({ compatible: false, conflictingVariants: ["2"] });
	}) as typeof fetch;

	const result = await runGuardrailTest(kv, "https://box-craft.example.workers.dev/", "box-craft-demo.myshopify.com", ["1", "2"], fetchImpl);

	assert.equal(calledUrl, "https://box-craft.example.workers.dev/check");
	assert.deepEqual(calledBody, { variantIds: ["1", "2"], shop: "box-craft-demo.myshopify.com" });
	assert.deepEqual(result.checkResponse, { compatible: false, conflictingVariants: ["2"] });
	assert.deepEqual(result.missingBitmapVariantIds, ["2"]);
});
