import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureStoreSetup, type AdminClient } from "../src/store-setup.ts";

const VARIANT = "gid://shopify/ProductVariant/42";

interface FakeState {
	cartTransforms: Array<{ id: string; metafield: { value: string } | null }>;
	bundleProductVariant: string | null;
	calls: string[];
	userErrors?: Array<{ field: string[]; message: string }>;
}

function fakeClient(state: FakeState): AdminClient {
	return async (query, variables = {}) => {
		const op = /(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? "unknown";
		state.calls.push(op);
		switch (op) {
			case "BoxcraftCartTransforms":
				return { cartTransforms: { nodes: state.cartTransforms } };
			case "BoxcraftBundleProduct":
				return {
					products: {
						nodes: state.bundleProductVariant ? [{ variants: { nodes: [{ id: state.bundleProductVariant }] } }] : [],
					},
				};
			case "BoxcraftCreateBundleProduct":
				state.bundleProductVariant = VARIANT;
				return {
					productCreate: {
						product: { variants: { nodes: [{ id: VARIANT }] } },
						userErrors: state.userErrors ?? [],
					},
				};
			case "BoxcraftCreateCartTransform": {
				const mf = (variables.metafields as Array<{ value: string }>)[0];
				state.cartTransforms.push({ id: "gid://shopify/CartTransform/1", metafield: { value: mf.value } });
				return { cartTransformCreate: { cartTransform: { id: "gid://shopify/CartTransform/1" }, userErrors: [] } };
			}
			case "BoxcraftSetCartTransformMetafield": {
				const mf = (variables.metafields as Array<{ value: string }>)[0];
				state.cartTransforms[0].metafield = { value: mf.value };
				return { metafieldsSet: { userErrors: [] } };
			}
			default:
				throw new Error(`unexpected operation ${op}`);
		}
	};
}

test("fresh store: creates the bundle product, then activates the function pointing at it", async () => {
	const state: FakeState = { cartTransforms: [], bundleProductVariant: null, calls: [] };
	await ensureStoreSetup(fakeClient(state));
	assert.deepEqual(state.calls, [
		"BoxcraftCartTransforms",
		"BoxcraftBundleProduct",
		"BoxcraftCreateBundleProduct",
		"BoxcraftCreateCartTransform",
	]);
	assert.equal(state.cartTransforms[0].metafield?.value, VARIANT);
});

test("reinstall: reuses the existing tagged bundle product instead of creating another", async () => {
	const state: FakeState = { cartTransforms: [], bundleProductVariant: VARIANT, calls: [] };
	await ensureStoreSetup(fakeClient(state));
	assert.ok(!state.calls.includes("BoxcraftCreateBundleProduct"));
	assert.equal(state.cartTransforms[0].metafield?.value, VARIANT);
});

test("already set up: makes no changes", async () => {
	const state: FakeState = {
		cartTransforms: [{ id: "gid://shopify/CartTransform/1", metafield: { value: VARIANT } }],
		bundleProductVariant: VARIANT,
		calls: [],
	};
	await ensureStoreSetup(fakeClient(state));
	assert.deepEqual(state.calls, ["BoxcraftCartTransforms"]);
});

test("function active but metafield missing: sets the metafield rather than creating a second transform", async () => {
	const state: FakeState = {
		cartTransforms: [{ id: "gid://shopify/CartTransform/1", metafield: null }],
		bundleProductVariant: VARIANT,
		calls: [],
	};
	await ensureStoreSetup(fakeClient(state));
	assert.ok(!state.calls.includes("BoxcraftCreateCartTransform"));
	assert.equal(state.cartTransforms.length, 1);
	assert.equal(state.cartTransforms[0].metafield?.value, VARIANT);
});

test("surfaces Shopify userErrors instead of silently continuing", async () => {
	const state: FakeState = {
		cartTransforms: [],
		bundleProductVariant: null,
		calls: [],
		userErrors: [{ field: ["title"], message: "Title can't be blank" }],
	};
	await assert.rejects(ensureStoreSetup(fakeClient(state)), /Title can't be blank/);
});
