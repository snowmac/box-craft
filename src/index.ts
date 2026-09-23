import { bitmapKey, type BitmapEntry } from "../shared/bitmap";
import { checkCompatibility, type VariantLocations } from "../shared/intersection";
import { preflightResponse, withCors } from "./cors";

export interface Env {
	LOCATION_BITMAP: KVNamespace;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname === "/check" && request.method === "OPTIONS") {
			return preflightResponse();
		}

		if (url.pathname === "/check" && request.method === "POST") {
			return withCors(await handleCheck(request, env));
		}

		return new Response("Not found", { status: 404 });
	},
};

async function handleCheck(request: Request, env: Env): Promise<Response> {
	let variantIds: string[];
	try {
		const body = (await request.json()) as { variantIds?: unknown };
		if (
			!Array.isArray(body.variantIds) ||
			body.variantIds.some((id) => typeof id !== "string")
		) {
			return Response.json(
				{ error: "variantIds must be an array of strings" },
				{ status: 400 },
			);
		}
		variantIds = body.variantIds;
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}

	if (variantIds.length === 0) {
		return Response.json({ compatible: true, locations: [] });
	}

	let selections: VariantLocations[];
	try {
		selections = await Promise.all(
			variantIds.map(async (variantId) => {
				const raw = await env.LOCATION_BITMAP.get(bitmapKey(variantId));
				const entry = raw ? (JSON.parse(raw) as BitmapEntry) : null;
				return { variantId, locations: entry?.locations ?? [] };
			}),
		);
	} catch {
		// Fail open: a bitmap read failure must never block a shopper from
		// adding to cart. A background reconciliation job (not yet built)
		// is the intended way to catch anything missed this way.
		return Response.json({ compatible: true, locations: [], failOpen: true });
	}

	const result = checkCompatibility(selections);
	return Response.json(result);
}
