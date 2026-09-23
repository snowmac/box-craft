// T12: read-only checks for the admin page's Setup card. Deliberately
// separate from store-setup.ts's ensureStoreSetup — this never creates or
// modifies anything, only reports current state.
import type { AdminClient } from "./store-setup.ts";
import { BUNDLE_PRODUCT_TAG } from "./store-setup.ts";

export interface SetupStatus {
	bundleProductPublished: boolean;
	cartTransformActive: boolean;
}

export async function checkSetupStatus(admin: AdminClient): Promise<SetupStatus> {
	const [bundleProductPublished, cartTransformActive] = await Promise.all([
		checkBundleProductPublished(admin),
		checkCartTransformActive(admin),
	]);
	return { bundleProductPublished, cartTransformActive };
}

async function checkBundleProductPublished(admin: AdminClient): Promise<boolean> {
	const { products } = await admin(`query BoxcraftBundleProductForStatus {
		products(first: 1, query: "tag:'${BUNDLE_PRODUCT_TAG}'") { nodes { id } }
	}`);
	const product: { id: string } | undefined = products.nodes[0];
	if (!product) return false;

	// Same "find the Online Store publication by channel handle" dance as
	// store-setup.ts's ensurePublishedToOnlineStore — publications have no
	// name of their own.
	const { publications } = await admin(`query BoxcraftOnlineStorePublicationForStatus {
		publications(first: 25) { nodes { id channels(first: 1) { nodes { handle } } } }
	}`);
	const onlineStore: { id: string } | undefined = publications.nodes.find(
		(p: { channels: { nodes: Array<{ handle: string }> } }) => p.channels.nodes[0]?.handle === "online_store",
	);
	if (!onlineStore) return false;

	const { product: productStatus } = await admin(
		`query BoxcraftBundlePublishedStatus($productId: ID!, $publicationId: ID!) {
			product(id: $productId) { publishedOnPublication(publicationId: $publicationId) }
		}`,
		{ productId: product.id, publicationId: onlineStore.id },
	);
	return !!productStatus?.publishedOnPublication;
}

async function checkCartTransformActive(admin: AdminClient): Promise<boolean> {
	const { cartTransforms } = await admin(`query BoxcraftCartTransformStatus {
		cartTransforms(first: 1) { nodes { id } }
	}`);
	return cartTransforms.nodes.length > 0;
}
