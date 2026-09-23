// One-time (or re-run-on-demand) script that populates the location
// bitmap from a Shopify store's current Admin API inventory data, via
// Cloudflare's REST bulk-KV endpoint. T9 moved the real logic (GraphQL
// paging + entry building) into shared/backfill.ts, shared with
// workers/app-backend's runSync (which writes through a real KV binding
// instead — no Cloudflare API token needed there); this script stays as a
// thin CLI wrapper for running outside a Worker, e.g. before app-backend
// has ever run for a store.
//
// Usage:
//   SHOPIFY_SHOP=my-store.myshopify.com \
//   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_... \
//   CLOUDFLARE_ACCOUNT_ID=... \
//   CLOUDFLARE_API_TOKEN=... \
//   CLOUDFLARE_KV_NAMESPACE_ID=... \
//   node --experimental-strip-types scripts/backfill.ts
//
// First run against box-craft-demo on 2026-09-23 (26 variants, 52 KV
// entries). See specs/product/work-log.md.

import { runBackfill, type BackfillKvEntry } from "../shared/backfill.ts";

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01";
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

async function writeKvBulk(config: Config, entries: BackfillKvEntry[]): Promise<void> {
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
	const { entries, variantCount } = await runBackfill({
		shop: config.shop,
		accessToken: config.adminAccessToken,
		apiVersion: SHOPIFY_API_VERSION,
		fetchImpl: fetch,
	});
	console.log(`Fetched ${variantCount} variants total.`);

	console.log(`Writing ${entries.length} KV entries (bitmap + inventory-item map)...`);
	await writeKvBulk(config, entries);
	console.log("Backfill complete.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
