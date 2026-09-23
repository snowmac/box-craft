import type { AdminClient } from "./store-setup.ts";

export const ADMIN_API_VERSION = "2026-07";

export function adminClient(shop: string, accessToken: string): AdminClient {
	return async (query, variables = {}) => {
		const res = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
			body: JSON.stringify({ query, variables }),
		});
		if (!res.ok) throw new Error(`Admin API ${res.status}: ${await res.text()}`);
		const body = (await res.json()) as { data?: unknown; errors?: unknown };
		if (body.errors) throw new Error(`Admin API errors: ${JSON.stringify(body.errors)}`);
		return body.data;
	};
}
