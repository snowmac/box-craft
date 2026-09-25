// One-time per-store setup, run from the embedded app once a shop has an
// access token: make sure the Cart Transform function is active on the
// store and knows which variant to merge bundles into. Idempotent — safe to
// re-run on every reinstall or scope change.
//
// The merged bundle line needs a parent variant. The app creates a
// "BoxCraft Bundle" product for this (tagged so a reinstall finds it again
// instead of creating a duplicate). It must be published to the Online
// Store channel — Shopify silently skips linesMerge otherwise (verified on
// box-craft-demo 2026-09-23) — so it's created UNLISTED: published and
// reachable by the merge, but kept out of search, collections and
// recommendations.

export type AdminClient = (
	query: string,
	variables?: Record<string, unknown>,
) => Promise<any>;

// Must match the handle in shopify-app/extensions/cart-transform.
const FUNCTION_HANDLE = "boxcraft-cart-transform";
// Exported for setup-status.ts's read-only checks (T12's Setup card).
export const BUNDLE_PRODUCT_TAG = "boxcraft-bundle-parent";
// "$app" = the app-reserved namespace; the function's input query reads
// cartTransform.metafield(key:) with no namespace, which resolves to it.
const METAFIELD = { namespace: "$app", key: "bundle_parent_variant_id", type: "single_line_text_field" };

export async function ensureStoreSetup(admin: AdminClient): Promise<void> {
	const bundle = await ensureBundleProduct(admin);
	await ensurePublishedToOnlineStore(admin, bundle.productId);
	await ensureInventoryGuarded(admin, bundle.productId, bundle.variantId);
	await ensureCartTransform(admin, bundle.variantId);
}

// The bundle product's direct URL (/products/boxcraft-bundle) is otherwise
// reachable and "Add to cart" would sell it standalone — a $0 order for a
// product that exists only to be a linesMerge target. Cart Transform's own
// linesMerge deducts inventory from the original merged component cart
// lines, not from parentVariantId's own inventory (confirmed via the
// Function API schema — LinesMergeOperation.cartLines is CartLineInput,
// which carries only cartLineId/quantity and no separate merchandiseId,
// unlike LineExpandOperation's ExpandedItem, which does; corroborated by
// this repo's own prior live checkout verification showing the merged
// line's real components listed underneath it — see work-log.md's "First
// end-to-end bundle merge"), so tracking and zero-stocking the parent
// variant only blocks the standalone purchase and has no effect on a real
// bundle checkout. Idempotent: a no-op once already guarded, so this is
// safe to run on every install/reinstall, including a store whose bundle
// product predates this fix.
async function ensureInventoryGuarded(admin: AdminClient, productId: string, variantId: string): Promise<void> {
	const { productVariant } = await admin(
		`query BoxcraftBundleVariantInventory($id: ID!) {
			productVariant(id: $id) { inventoryPolicy inventoryItem { tracked } }
		}`,
		{ id: variantId },
	);
	if (productVariant.inventoryPolicy === "DENY" && productVariant.inventoryItem.tracked) return;

	const { productVariantsBulkUpdate } = await admin(
		`mutation BoxcraftGuardBundleVariantInventory($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
			productVariantsBulkUpdate(productId: $productId, variants: $variants) {
				userErrors { field message }
			}
		}`,
		{
			productId,
			variants: [{ id: variantId, inventoryPolicy: "DENY", inventoryItem: { tracked: true } }],
		},
	);
	throwOnUserErrors("productVariantsBulkUpdate", productVariantsBulkUpdate.userErrors);
}

async function ensureCartTransform(admin: AdminClient, parentVariantId: string): Promise<void> {
	const { cartTransforms } = await admin(`query BoxcraftCartTransforms {
		cartTransforms(first: 10) {
			nodes { id metafield(namespace: "${METAFIELD.namespace}", key: "${METAFIELD.key}") { value } }
		}
	}`);
	const existing: { id: string; metafield: { value: string } | null } | undefined = cartTransforms.nodes[0];
	if (existing?.metafield?.value === parentVariantId) return;

	if (existing) {
		const { metafieldsSet } = await admin(
			`mutation BoxcraftSetCartTransformMetafield($metafields: [MetafieldsSetInput!]!) {
				metafieldsSet(metafields: $metafields) { userErrors { field message } }
			}`,
			{ metafields: [{ ...METAFIELD, ownerId: existing.id, value: parentVariantId }] },
		);
		throwOnUserErrors("metafieldsSet", metafieldsSet.userErrors);
		return;
	}

	const { cartTransformCreate } = await admin(
		`mutation BoxcraftCreateCartTransform($functionHandle: String!, $metafields: [MetafieldInput!]) {
			cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: false, metafields: $metafields) {
				cartTransform { id }
				userErrors { field message }
			}
		}`,
		{ functionHandle: FUNCTION_HANDLE, metafields: [{ ...METAFIELD, value: parentVariantId }] },
	);
	throwOnUserErrors("cartTransformCreate", cartTransformCreate.userErrors);
}

async function ensurePublishedToOnlineStore(admin: AdminClient, productId: string): Promise<void> {
	// Publications have no name of their own (catalog titles look like
	// "Channel Catalog 123 for Online Store"); the channel handle is stable.
	const data = await admin(`query BoxcraftOnlineStorePublication {
		publications(first: 25) { nodes { id channels(first: 1) { nodes { handle } } } }
	}`);
	const onlineStore: { id: string } | undefined = data.publications.nodes.find(
		(p: { channels: { nodes: Array<{ handle: string }> } }) => p.channels.nodes[0]?.handle === "online_store",
	);
	if (!onlineStore) throw new Error("Online Store publication not found");

	const { product } = await admin(
		`query BoxcraftBundlePublished($productId: ID!, $publicationId: ID!) {
			product(id: $productId) { publishedOnPublication(publicationId: $publicationId) }
		}`,
		{ productId, publicationId: onlineStore.id },
	);
	if (product.publishedOnPublication) return;

	const { publishablePublish } = await admin(
		`mutation BoxcraftPublishBundleProduct($id: ID!, $input: [PublicationInput!]!) {
			publishablePublish(id: $id, input: $input) { userErrors { field message } }
		}`,
		{ id: productId, input: [{ publicationId: onlineStore.id }] },
	);
	throwOnUserErrors("publishablePublish", publishablePublish.userErrors);
}

async function ensureBundleProduct(admin: AdminClient): Promise<{ productId: string; variantId: string }> {
	const { products } = await admin(`query BoxcraftBundleProduct {
		products(first: 1, query: "tag:'${BUNDLE_PRODUCT_TAG}'") {
			nodes { id variants(first: 1) { nodes { id } } }
		}
	}`);
	const found = products.nodes[0];
	if (found?.variants.nodes[0]) return { productId: found.id, variantId: found.variants.nodes[0].id };

	const { productCreate } = await admin(
		`mutation BoxcraftCreateBundleProduct($product: ProductCreateInput!) {
			productCreate(product: $product) {
				product { id variants(first: 1) { nodes { id } } }
				userErrors { field message }
			}
		}`,
		{
			product: {
				title: "BoxCraft Bundle",
				descriptionHtml: "Used by the BoxCraft app to group bundle items in the cart. Don't delete.",
				tags: [BUNDLE_PRODUCT_TAG],
				status: "UNLISTED",
			},
		},
	);
	throwOnUserErrors("productCreate", productCreate.userErrors);
	return { productId: productCreate.product.id, variantId: productCreate.product.variants.nodes[0].id };
}

function throwOnUserErrors(op: string, errors: Array<{ field?: string[]; message: string }>): void {
	if (errors?.length) {
		throw new Error(`${op} failed: ${errors.map((e) => e.message).join("; ")}`);
	}
}
