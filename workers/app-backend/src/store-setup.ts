// One-time per-store setup, run from the embedded app once a shop has an
// access token: make sure the Cart Transform function is active on the
// store and knows which variant to merge bundles into. Idempotent — safe to
// re-run on every reinstall or scope change.
//
// The merged bundle line needs a parent variant. The app creates a
// "BoxCraft Bundle" product for this (tagged so a reinstall finds it again
// instead of creating a duplicate). Created via API, it isn't published to
// any sales channel, so shoppers can't find or buy it directly.

export type AdminClient = (
	query: string,
	variables?: Record<string, unknown>,
) => Promise<any>;

// Must match the handle in shopify-app/extensions/cart-transform.
const FUNCTION_HANDLE = "boxcraft-cart-transform";
const BUNDLE_PRODUCT_TAG = "boxcraft-bundle-parent";
// "$app" = the app-reserved namespace; the function's input query reads
// cartTransform.metafield(key:) with no namespace, which resolves to it.
const METAFIELD = { namespace: "$app", key: "bundle_parent_variant_id", type: "single_line_text_field" };

export async function ensureStoreSetup(admin: AdminClient): Promise<void> {
	const { cartTransforms } = await admin(`query BoxcraftCartTransforms {
		cartTransforms(first: 10) {
			nodes { id metafield(namespace: "${METAFIELD.namespace}", key: "${METAFIELD.key}") { value } }
		}
	}`);
	const existing: { id: string; metafield: { value: string } | null } | undefined = cartTransforms.nodes[0];
	if (existing?.metafield?.value) return;

	const parentVariantId = await ensureBundleProduct(admin);

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

async function ensureBundleProduct(admin: AdminClient): Promise<string> {
	const { products } = await admin(`query BoxcraftBundleProduct {
		products(first: 1, query: "tag:'${BUNDLE_PRODUCT_TAG}'") {
			nodes { variants(first: 1) { nodes { id } } }
		}
	}`);
	const found: string | undefined = products.nodes[0]?.variants.nodes[0]?.id;
	if (found) return found;

	const { productCreate } = await admin(
		`mutation BoxcraftCreateBundleProduct($product: ProductCreateInput!) {
			productCreate(product: $product) {
				product { variants(first: 1) { nodes { id } } }
				userErrors { field message }
			}
		}`,
		{
			product: {
				title: "BoxCraft Bundle",
				descriptionHtml: "Used by the BoxCraft app to group bundle items in the cart. Don't delete.",
				tags: [BUNDLE_PRODUCT_TAG],
				status: "ACTIVE",
			},
		},
	);
	throwOnUserErrors("productCreate", productCreate.userErrors);
	return productCreate.product.variants.nodes[0].id;
}

function throwOnUserErrors(op: string, errors: Array<{ field?: string[]; message: string }>): void {
	if (errors?.length) {
		throw new Error(`${op} failed: ${errors.map((e) => e.message).join("; ")}`);
	}
}
