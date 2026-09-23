import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSetupStatus } from "../src/setup-status.ts";
import type { AdminClient } from "../src/store-setup.ts";

function recordingAdmin(responses: Record<string, unknown>): AdminClient {
	return async (query) => {
		for (const [marker, response] of Object.entries(responses)) {
			if (query.includes(marker)) return response;
		}
		throw new Error(`no mock response for query containing none of: ${Object.keys(responses).join(", ")}`);
	};
}

test("reports both published and active when everything is set up", async () => {
	const admin = recordingAdmin({
		BoxcraftBundleProductForStatus: { products: { nodes: [{ id: "gid://shopify/Product/1" }] } },
		BoxcraftOnlineStorePublicationForStatus: {
			publications: { nodes: [{ id: "gid://shopify/Publication/1", channels: { nodes: [{ handle: "online_store" }] } }] },
		},
		BoxcraftBundlePublishedStatus: { product: { publishedOnPublication: true } },
		BoxcraftCartTransformStatus: { cartTransforms: { nodes: [{ id: "gid://shopify/CartTransform/1" }] } },
	});

	assert.deepEqual(await checkSetupStatus(admin), { bundleProductPublished: true, cartTransformActive: true });
});

test("reports bundleProductPublished false when the bundle product doesn't exist yet", async () => {
	const admin = recordingAdmin({
		BoxcraftBundleProductForStatus: { products: { nodes: [] } },
		BoxcraftCartTransformStatus: { cartTransforms: { nodes: [] } },
	});

	const status = await checkSetupStatus(admin);
	assert.equal(status.bundleProductPublished, false);
});

test("reports bundleProductPublished false when the product exists but isn't published there", async () => {
	const admin = recordingAdmin({
		BoxcraftBundleProductForStatus: { products: { nodes: [{ id: "gid://shopify/Product/1" }] } },
		BoxcraftOnlineStorePublicationForStatus: {
			publications: { nodes: [{ id: "gid://shopify/Publication/1", channels: { nodes: [{ handle: "online_store" }] } }] },
		},
		BoxcraftBundlePublishedStatus: { product: { publishedOnPublication: false } },
		BoxcraftCartTransformStatus: { cartTransforms: { nodes: [] } },
	});

	const status = await checkSetupStatus(admin);
	assert.equal(status.bundleProductPublished, false);
});

test("reports bundleProductPublished false when no Online Store publication is found", async () => {
	const admin = recordingAdmin({
		BoxcraftBundleProductForStatus: { products: { nodes: [{ id: "gid://shopify/Product/1" }] } },
		BoxcraftOnlineStorePublicationForStatus: { publications: { nodes: [] } },
		BoxcraftCartTransformStatus: { cartTransforms: { nodes: [] } },
	});

	const status = await checkSetupStatus(admin);
	assert.equal(status.bundleProductPublished, false);
});

test("reports cartTransformActive false when no cart transform exists", async () => {
	const admin = recordingAdmin({
		BoxcraftBundleProductForStatus: { products: { nodes: [] } },
		BoxcraftCartTransformStatus: { cartTransforms: { nodes: [] } },
	});

	const status = await checkSetupStatus(admin);
	assert.equal(status.cartTransformActive, false);
});
