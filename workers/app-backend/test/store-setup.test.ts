import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureStoreSetup, type AdminClient } from "../src/store-setup.ts";

const VARIANT = "gid://shopify/ProductVariant/42";
const PRODUCT = "gid://shopify/Product/7";
const ONLINE_STORE = "gid://shopify/Publication/1";

interface FakeState {
	cartTransforms: Array<{ id: string; metafield: { value: string } | null }>;
	bundleProductVariant: string | null;
	calls: string[];
	userErrors?: Array<{ field: string[]; message: string }>;
	published?: boolean;
	createdStatus?: string;
	inventoryPolicy?: string;
	inventoryTracked?: boolean;
	inventoryGuardVariables?: { productId: string; variants: unknown[] };
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
						nodes: state.bundleProductVariant
							? [{ id: PRODUCT, variants: { nodes: [{ id: state.bundleProductVariant }] } }]
							: [],
					},
				};
			case "BoxcraftOnlineStorePublication":
				return {
					publications: {
						// Shape and titles as returned by box-craft-demo's Admin API.
						nodes: [
							{ id: "gid://shopify/Publication/2", channels: { nodes: [{ handle: "pos" }] } },
							{ id: ONLINE_STORE, channels: { nodes: [{ handle: "online_store" }] } },
						],
					},
				};
			case "BoxcraftBundlePublished":
				return { product: { publishedOnPublication: !!state.published } };
			case "BoxcraftPublishBundleProduct":
				assert.equal((variables.input as Array<{ publicationId: string }>)[0].publicationId, ONLINE_STORE);
				state.published = true;
				return { publishablePublish: { userErrors: [] } };
			case "BoxcraftCreateBundleProduct":
				state.bundleProductVariant = VARIANT;
				state.createdStatus = (variables.product as { status: string }).status;
				return {
					productCreate: {
						product: { id: PRODUCT, variants: { nodes: [{ id: VARIANT }] } },
						userErrors: state.userErrors ?? [],
					},
				};
			case "BoxcraftBundleVariantInventory":
				return {
					productVariant: {
						inventoryPolicy: state.inventoryPolicy ?? "CONTINUE",
						inventoryItem: { tracked: state.inventoryTracked ?? false },
					},
				};
			case "BoxcraftGuardBundleVariantInventory":
				state.inventoryPolicy = "DENY";
				state.inventoryTracked = true;
				state.inventoryGuardVariables = variables as { productId: string; variants: unknown[] };
				return { productVariantsBulkUpdate: { userErrors: state.userErrors ?? [] } };
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
		"BoxcraftBundleProduct",
		"BoxcraftCreateBundleProduct",
		"BoxcraftOnlineStorePublication",
		"BoxcraftBundlePublished",
		"BoxcraftPublishBundleProduct",
		"BoxcraftBundleVariantInventory",
		"BoxcraftGuardBundleVariantInventory",
		"BoxcraftCartTransforms",
		"BoxcraftCreateCartTransform",
	]);
	assert.equal(state.cartTransforms[0].metafield?.value, VARIANT);
	// Unlisted: reachable by the merge but not in search/collections.
	assert.equal(state.createdStatus, "UNLISTED");
	assert.equal(state.published, true);
	// A freshly created bundle product's placeholder variant isn't bought
	// standalone: tracked + deny-oversell (D9 fix — linesMerge deducts
	// inventory from the real component variants, not this one).
	assert.equal(state.inventoryPolicy, "DENY");
	assert.equal(state.inventoryTracked, true);
	assert.deepEqual(state.inventoryGuardVariables, {
		productId: PRODUCT,
		variants: [{ id: VARIANT, inventoryPolicy: "DENY", inventoryItem: { tracked: true } }],
	});
});

test("reinstall: reuses the existing tagged bundle product instead of creating another", async () => {
	const state: FakeState = { cartTransforms: [], bundleProductVariant: VARIANT, calls: [] };
	await ensureStoreSetup(fakeClient(state));
	assert.ok(!state.calls.includes("BoxcraftCreateBundleProduct"));
	assert.equal(state.cartTransforms[0].metafield?.value, VARIANT);
});

test("already set up: only reads, makes no changes", async () => {
	const state: FakeState = {
		cartTransforms: [{ id: "gid://shopify/CartTransform/1", metafield: { value: VARIANT } }],
		bundleProductVariant: VARIANT,
		published: true,
		inventoryPolicy: "DENY",
		inventoryTracked: true,
		calls: [],
	};
	await ensureStoreSetup(fakeClient(state));
	assert.deepEqual(state.calls, [
		"BoxcraftBundleProduct",
		"BoxcraftOnlineStorePublication",
		"BoxcraftBundlePublished",
		"BoxcraftBundleVariantInventory",
		"BoxcraftCartTransforms",
	]);
});

test("existing bundle variant not yet guarded (installed before this fix) gets tracked + deny-oversell set", async () => {
	const state: FakeState = {
		cartTransforms: [{ id: "gid://shopify/CartTransform/1", metafield: { value: VARIANT } }],
		bundleProductVariant: VARIANT,
		published: true,
		// Defaults: inventoryPolicy CONTINUE, untracked — as any variant
		// created before this fix would still be.
		calls: [],
	};
	await ensureStoreSetup(fakeClient(state));
	assert.ok(state.calls.includes("BoxcraftGuardBundleVariantInventory"));
	assert.equal(state.inventoryPolicy, "DENY");
	assert.equal(state.inventoryTracked, true);
});

test("already guarded (tracked + deny): no mutation call, idempotent", async () => {
	const state: FakeState = {
		cartTransforms: [{ id: "gid://shopify/CartTransform/1", metafield: { value: VARIANT } }],
		bundleProductVariant: VARIANT,
		published: true,
		inventoryPolicy: "DENY",
		inventoryTracked: true,
		calls: [],
	};
	await ensureStoreSetup(fakeClient(state));
	assert.ok(!state.calls.includes("BoxcraftGuardBundleVariantInventory"));
});

test("existing store whose bundle product was never published gets it published", async () => {
	// Shopify silently skips linesMerge when the parent product isn't on the
	// Online Store channel — the case for installs from before this fix.
	const state: FakeState = {
		cartTransforms: [{ id: "gid://shopify/CartTransform/1", metafield: { value: VARIANT } }],
		bundleProductVariant: VARIANT,
		published: false,
		calls: [],
	};
	await ensureStoreSetup(fakeClient(state));
	assert.equal(state.published, true);
	assert.ok(!state.calls.includes("BoxcraftCreateCartTransform"));
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
