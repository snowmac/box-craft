import { test } from "node:test";
import assert from "node:assert/strict";
import { writeBoxesMetafields } from "../src/boxes-metafield.ts";
import type { Box } from "../../../shared/boxes.ts";
import type { AdminClient } from "../src/store-setup.ts";

const BOX: Box = {
	handle: "default",
	title: "Build your box",
	collection_handle: null,
	pick_count: 4,
	discount: { type: "none" },
	active: true,
	pools: [{ collection_handle: null, count: 4 }],
};

function recordingAdmin(responses: Record<string, unknown>): { admin: AdminClient; calls: Array<{ query: string; variables?: Record<string, unknown> }> } {
	const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
	const admin: AdminClient = async (query, variables) => {
		calls.push({ query, variables });
		for (const [marker, response] of Object.entries(responses)) {
			if (query.includes(marker)) return response;
		}
		throw new Error(`no mock response for query containing none of: ${Object.keys(responses).join(", ")}`);
	};
	return { admin, calls };
}

test("writes to both the app-installation and cart-transform metafields when a cart transform exists", async () => {
	const { admin, calls } = recordingAdmin({
		BoxcraftAppInstallation: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } },
		BoxcraftCartTransformsForBoxes: { cartTransforms: { nodes: [{ id: "gid://shopify/CartTransform/1" }] } },
		BoxcraftSetBoxesMetafields: { metafieldsSet: { userErrors: [] } },
	});

	await writeBoxesMetafields(admin, [BOX]);

	const setCall = calls.find((c) => c.query.includes("BoxcraftSetBoxesMetafields"));
	assert.ok(setCall);
	const metafields = setCall!.variables!.metafields as Array<Record<string, unknown>>;
	assert.equal(metafields.length, 2);

	const appInstallationMetafield = metafields.find((m) => m.namespace === "boxcraft");
	assert.equal(appInstallationMetafield?.ownerId, "gid://shopify/AppInstallation/1");
	assert.deepEqual(JSON.parse(appInstallationMetafield?.value as string), [BOX]);

	const cartTransformMetafield = metafields.find((m) => m.namespace === "$app");
	assert.equal(cartTransformMetafield?.ownerId, "gid://shopify/CartTransform/1");
});

test("writes only the app-installation metafield when no cart transform is active yet", async () => {
	const { admin, calls } = recordingAdmin({
		BoxcraftAppInstallation: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } },
		BoxcraftCartTransformsForBoxes: { cartTransforms: { nodes: [] } },
		BoxcraftSetBoxesMetafields: { metafieldsSet: { userErrors: [] } },
	});

	await writeBoxesMetafields(admin, [BOX]);

	const setCall = calls.find((c) => c.query.includes("BoxcraftSetBoxesMetafields"));
	const metafields = setCall!.variables!.metafields as Array<Record<string, unknown>>;
	assert.equal(metafields.length, 1);
	assert.equal(metafields[0].namespace, "boxcraft");
});

test("throws when Shopify reports userErrors", async () => {
	const { admin } = recordingAdmin({
		BoxcraftAppInstallation: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } },
		BoxcraftCartTransformsForBoxes: { cartTransforms: { nodes: [] } },
		BoxcraftSetBoxesMetafields: { metafieldsSet: { userErrors: [{ field: ["value"], message: "too large" }] } },
	});

	await assert.rejects(() => writeBoxesMetafields(admin, [BOX]), /too large/);
});

test("a multi-pool box's metafield payload carries pools alongside unchanged title/pick_count/discount", async () => {
	const multiPoolBox: Box = {
		handle: "coffee",
		title: "Coffee Box",
		collection_handle: "light-roast",
		pick_count: 3,
		discount: { type: "none" },
		active: true,
		pools: [
			{ collection_handle: "light-roast", count: 2 },
			{ collection_handle: "medium-roast", count: 1 },
		],
	};
	const { admin, calls } = recordingAdmin({
		BoxcraftAppInstallation: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } },
		BoxcraftCartTransformsForBoxes: { cartTransforms: { nodes: [] } },
		BoxcraftSetBoxesMetafields: { metafieldsSet: { userErrors: [] } },
	});

	await writeBoxesMetafields(admin, [multiPoolBox]);

	const setCall = calls.find((c) => c.query.includes("BoxcraftSetBoxesMetafields"));
	const metafields = setCall!.variables!.metafields as Array<Record<string, unknown>>;
	const [written] = JSON.parse(metafields[0].value as string);
	assert.deepEqual(written.pools, multiPoolBox.pools);
	assert.equal(written.title, "Coffee Box");
	assert.equal(written.pick_count, 3);
	assert.deepEqual(written.discount, { type: "none" });
});

test("serializes an empty boxes array (all deleted) as valid JSON", async () => {
	const { admin, calls } = recordingAdmin({
		BoxcraftAppInstallation: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } },
		BoxcraftCartTransformsForBoxes: { cartTransforms: { nodes: [] } },
		BoxcraftSetBoxesMetafields: { metafieldsSet: { userErrors: [] } },
	});

	await writeBoxesMetafields(admin, []);

	const setCall = calls.find((c) => c.query.includes("BoxcraftSetBoxesMetafields"));
	const metafields = setCall!.variables!.metafields as Array<Record<string, unknown>>;
	assert.deepEqual(JSON.parse(metafields[0].value as string), []);
});
