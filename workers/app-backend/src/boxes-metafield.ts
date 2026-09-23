import type { AdminClient } from "./store-setup.ts";
import type { Box } from "../../../shared/boxes.ts";

// D9: app-installation metafield the Liquid block reads via
// app.metafields.boxcraft.boxes. D11: the Cart Transform function reads
// its own copy from the cart transform's $app metafield, so the function
// never has to trust anything from the storefront/cart about pricing.
const APP_INSTALLATION_METAFIELD = { namespace: "boxcraft", key: "boxes", type: "json" };
const CART_TRANSFORM_METAFIELD = { namespace: "$app", key: "boxes", type: "json" };

// Any change to a shop's boxes (create/update/delete) writes the full,
// current list to both places — never a partial/incremental update, so
// there's one source of truth per metafield.
export async function writeBoxesMetafields(admin: AdminClient, boxes: Box[]): Promise<void> {
	const value = JSON.stringify(boxes);

	const { currentAppInstallation } = await admin(
		`query BoxcraftAppInstallation { currentAppInstallation { id } }`,
	);

	const { cartTransforms } = await admin(
		`query BoxcraftCartTransformsForBoxes { cartTransforms(first: 10) { nodes { id } } }`,
	);
	const cartTransformId: string | undefined = cartTransforms.nodes[0]?.id;

	const metafields: Array<Record<string, unknown>> = [
		{ ...APP_INSTALLATION_METAFIELD, ownerId: currentAppInstallation.id, value },
	];
	// The cart transform might not be active yet (store setup hasn't run,
	// or failed) — write what we can rather than blocking the boxes API on it.
	if (cartTransformId) {
		metafields.push({ ...CART_TRANSFORM_METAFIELD, ownerId: cartTransformId, value });
	}

	const { metafieldsSet } = await admin(
		`mutation BoxcraftSetBoxesMetafields($metafields: [MetafieldsSetInput!]!) {
			metafieldsSet(metafields: $metafields) { userErrors { field message } }
		}`,
		{ metafields },
	);
	const userErrors: Array<{ field?: string[]; message: string }> = metafieldsSet.userErrors;
	if (userErrors?.length) {
		throw new Error(`metafieldsSet failed: ${userErrors.map((e) => e.message).join("; ")}`);
	}
}
