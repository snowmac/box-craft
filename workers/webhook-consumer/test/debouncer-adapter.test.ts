import { test } from "node:test";
import assert from "node:assert/strict";
import { createDurableObjectDebouncer } from "../src/debouncer-adapter.ts";

function mockNamespace() {
	const calls: Array<{ id: string; body: unknown }> = [];
	return {
		namespace: {
			idFromName: (name: string) => name,
			get: (id: string) => ({
				fetch: async (_url: string, opts: { body: string }) => {
					calls.push({ id, body: JSON.parse(opts.body) });
					return new Response("queued", { status: 202 });
				},
			}),
		},
		calls,
	};
}

test("createDurableObjectDebouncer.schedule dispatches to the DO stub named by skuKey", async () => {
	const { namespace, calls } = mockNamespace();
	const debouncer = createDurableObjectDebouncer({ SKU_DEBOUNCER: namespace as never });

	await debouncer.schedule("gid://shopify/ProductVariant/1", {
		locationId: "gid://shopify/Location/1",
		available: true,
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].id, "gid://shopify/ProductVariant/1");
	assert.deepEqual(calls[0].body, {
		skuKey: "gid://shopify/ProductVariant/1",
		locationId: "gid://shopify/Location/1",
		available: true,
	});
});
