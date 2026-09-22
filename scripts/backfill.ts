// One-time (or re-run-on-demand) script that populates the location
// bitmap from a Shopify store's current Admin API inventory data. Run this
// once per merchant on install, before the webhook consumer has any events
// to work from — otherwise the bitmap (and therefore the guardrail) starts
// out empty and fail-open on everything.
//
// Usage:
//   SHOPIFY_SHOP=my-store.myshopify.com \
//   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_... \
//   CLOUDFLARE_ACCOUNT_ID=... \
//   CLOUDFLARE_API_TOKEN=... \
//   CLOUDFLARE_KV_NAMESPACE_ID=... \
//   node --experimental-strip-types scripts/backfill.ts
//
// Not yet run or tested against a real store or a real KV namespace in
// this environment — no Shopify Partner credentials or Cloudflare account
// access are available here. See specs/product/assumptions.md.

import { bitmapKey, inventoryItemMapKey, type BitmapEntry } from "../shared/bitmap.ts";

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01";
const VARIANTS_PAGE_SIZE = 50;
const LOCATIONS_PAGE_SIZE = 50; // per-variant inventory level page size
const KV_BULK_CHUNK_SIZE = 1000;

interface Config {
	shop: string;
	adminAccessToken: string;
	cloudflareAccountId: string;
	cloudflareApiToken: string;
	kvNamespaceId: string;
}

function loadConfig(): Config {
	const required = [
		"SHOPIFY_SHOP",
		"SHOPIFY_ADMIN_ACCESS_TOKEN",
		"CLOUDFLARE_ACCOUNT_ID",
		"CLOUDFLARE_API_TOKEN",
		"CLOUDFLARE_KV_NAMESPACE_ID",
	] as const;

	const missing = required.filter((name) => !process.env[name]);
	if (missing.length > 0) {
		throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
	}

	return {
		shop: process.env.SHOPIFY_SHOP!,
		adminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
		cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
		cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN!,
		kvNamespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID!,
	};
}

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

async function shopifyGraphQL<T>(
	config: Config,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const res = await fetch(
		`https://${config.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": config.adminAccessToken,
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
	if (variant.inventoryItem.inventoryLevels.pageInfo.hasNextPage) {
		// A single SKU stocked across more than LOCATIONS_PAGE_SIZE
		// locations would need its own pagination loop here. Not expected
		// for this app's target segment (a handful of warehouses/3PLs), so
		// left unhandled rather than adding untested complexity — revisit
		// if a merchant actually hits this.
		console.warn(
			`Variant ${variant.id} has more than ${LOCATIONS_PAGE_SIZE} inventory levels; some locations may be missed.`,
		);
	}

	return variant.inventoryItem.inventoryLevels.edges
		.filter((edge) => {
			const available = edge.node.quantities.find((q) => q.name === "available");
			return (available?.quantity ?? 0) > 0;
		})
		.map((edge) => edge.node.location.id)
		.sort();
}

async function fetchAllVariants(config: Config): Promise<VariantNode[]> {
	const variants: VariantNode[] = [];
	let cursor: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: VariantNode }> } } =
			await shopifyGraphQL(config, VARIANTS_QUERY, { cursor });

		variants.push(...data.productVariants.edges.map((e) => e.node));
		hasNextPage = data.productVariants.pageInfo.hasNextPage;
		cursor = data.productVariants.pageInfo.endCursor;
		console.log(`Fetched ${variants.length} variants so far...`);
	}

	return variants;
}

async function writeKvBulk(
	config: Config,
	entries: Array<{ key: string; value: string }>,
): Promise<void> {
	for (let i = 0; i < entries.length; i += KV_BULK_CHUNK_SIZE) {
		const chunk = entries.slice(i, i + KV_BULK_CHUNK_SIZE);
		const res = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/storage/kv/namespaces/${config.kvNamespaceId}/bulk`,
			{
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.cloudflareApiToken}`,
				},
				body: JSON.stringify(chunk),
			},
		);

		if (!res.ok) {
			throw new Error(
				`Cloudflare KV bulk write failed: ${res.status} ${await res.text()}`,
			);
		}
		console.log(`Wrote KV entries ${i + 1}-${i + chunk.length} of ${entries.length}`);
	}
}

async function main(): Promise<void> {
	const config = loadConfig();

	console.log(`Fetching inventory for ${config.shop}...`);
	const variants = await fetchAllVariants(config);
	console.log(`Fetched ${variants.length} variants total.`);

	const now = new Date().toISOString();
	const kvEntries: Array<{ key: string; value: string }> = [];

	for (const variant of variants) {
		const locations = extractLocations(variant);
		const entry: BitmapEntry = { locations, updatedAt: now };

		kvEntries.push({ key: bitmapKey(variant.id), value: JSON.stringify(entry) });

		// inventoryItem.id is a GID like "gid://shopify/InventoryItem/123";
		// the webhook payload's inventory_item_id is the bare numeric ID, so
		// strip the GID down to match what the webhook consumer looks up.
		const inventoryItemNumericId = variant.inventoryItem.id.split("/").pop();
		if (inventoryItemNumericId) {
			kvEntries.push({
				key: inventoryItemMapKey(inventoryItemNumericId),
				value: variant.id,
			});
		}
	}

	console.log(`Writing ${kvEntries.length} KV entries (bitmap + inventory-item map)...`);
	await writeKvBulk(config, kvEntries);
	console.log("Backfill complete.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
