// Pure inventory-backfill logic: pages through a store's variants via the
// Admin API and builds the location-bitmap KV entries from their inventory
// levels. Used by both workers/app-backend's runSync (T9, a real KV
// binding — no REST token needed) and scripts/backfill.ts (a thin CLI that
// still writes via the Cloudflare REST bulk-KV endpoint, for running
// outside a Worker). fetch is injected so this stays testable without a
// real network call.
import { bitmapKey, inventoryItemMapKey, type BitmapEntry } from "./bitmap.ts";

export type FetchLike = typeof fetch;

const VARIANTS_PAGE_SIZE = 50;
const LOCATIONS_PAGE_SIZE = 50; // per-variant inventory level page size

interface VariantNode {
	id: string;
	inventoryItem: {
		id: string;
		inventoryLevels: {
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
			edges: Array<{
				node: {
					location: { id: string };
					quantities: Array<{ name: string; quantity: number }>;
				};
			}>;
		};
	};
}

const VARIANTS_QUERY = `
  query BackfillVariants($cursor: String) {
    productVariants(first: ${VARIANTS_PAGE_SIZE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          inventoryItem {
            id
            inventoryLevels(first: ${LOCATIONS_PAGE_SIZE}) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  location { id }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export interface BackfillOptions {
	shop: string;
	accessToken: string;
	apiVersion: string;
	fetchImpl: FetchLike;
	// Injectable for deterministic tests; defaults to the real clock.
	now?: () => string;
}

export interface BackfillKvEntry {
	key: string;
	value: string;
}

export interface BackfillResult {
	entries: BackfillKvEntry[];
	variantCount: number;
}

async function shopifyGraphQL<T>(
	options: BackfillOptions,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const res = await options.fetchImpl(
		`https://${options.shop}/admin/api/${options.apiVersion}/graphql.json`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": options.accessToken,
			},
			body: JSON.stringify({ query, variables }),
		},
	);

	if (!res.ok) {
		throw new Error(`Shopify Admin API request failed: ${res.status} ${await res.text()}`);
	}

	const body = (await res.json()) as { data?: T; errors?: unknown };
	if (body.errors) {
		throw new Error(`Shopify Admin API returned errors: ${JSON.stringify(body.errors)}`);
	}
	if (!body.data) {
		throw new Error("Shopify Admin API returned no data");
	}
	return body.data;
}

function extractLocations(variant: VariantNode): string[] {
	// A single SKU stocked across more than LOCATIONS_PAGE_SIZE locations
	// would need its own pagination loop here. Not expected for this app's
	// target segment (a handful of warehouses/3PLs), so left unhandled
	// rather than adding untested complexity — revisit if a merchant
	// actually hits this.
	return variant.inventoryItem.inventoryLevels.edges
		.filter((edge) => {
			const available = edge.node.quantities.find((q) => q.name === "available");
			return (available?.quantity ?? 0) > 0;
		})
		.map((edge) => edge.node.location.id)
		.sort();
}

async function fetchAllVariants(options: BackfillOptions): Promise<VariantNode[]> {
	const variants: VariantNode[] = [];
	let cursor: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: {
			productVariants: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				edges: Array<{ node: VariantNode }>;
			};
		} = await shopifyGraphQL(options, VARIANTS_QUERY, { cursor });

		variants.push(...data.productVariants.edges.map((e) => e.node));
		hasNextPage = data.productVariants.pageInfo.hasNextPage;
		cursor = data.productVariants.pageInfo.endCursor;
	}

	return variants;
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
	const variants = await fetchAllVariants(options);
	const now = (options.now ?? (() => new Date().toISOString()))();

	const entries: BackfillKvEntry[] = [];
	for (const variant of variants) {
		const locations = extractLocations(variant);
		const entry: BitmapEntry = { locations, updatedAt: now };
		entries.push({ key: bitmapKey(variant.id), value: JSON.stringify(entry) });

		// inventoryItem.id is a GID like "gid://shopify/InventoryItem/123";
		// the webhook payload's inventory_item_id is the bare numeric ID, so
		// strip the GID down to match what the webhook consumer looks up.
		const inventoryItemNumericId = variant.inventoryItem.id.split("/").pop();
		if (inventoryItemNumericId) {
			entries.push({ key: inventoryItemMapKey(inventoryItemNumericId), value: variant.id });
		}
	}

	return { entries, variantCount: variants.length };
}
