import { bitmapKey, toVariantGid, type BitmapEntry } from "../shared/bitmap.ts";
import { checkCompatibility, type VariantLocations } from "../shared/intersection.ts";
import { recordEvent, type D1Like, type EventContext } from "../shared/events.ts";
import { preflightResponse, withCors } from "./cors.ts";

export interface Env {
	LOCATION_BITMAP: KVNamespace;
	DB: D1Like;
}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// D5: record the shop if it's a genuine *.myshopify.com value, but never
// reject the request over it — the compatibility check itself never
// depends on which shop is calling.
function normalizeShop(shop: unknown): string | null {
	return typeof shop === "string" && SHOP_DOMAIN_PATTERN.test(shop) ? shop : null;
}

export default {
	async fetch(request: Request, env: Env, ctx: EventContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname === "/check" && request.method === "OPTIONS") {
			return preflightResponse();
		}

		if (url.pathname === "/check" && request.method === "POST") {
			return withCors(await handleCheck(request, env, ctx));
		}

		return new Response("Not found", { status: 404 });
	},
};

async function handleCheck(request: Request, env: Env, ctx: EventContext): Promise<Response> {
	let variantIds: string[];
	let shop: string | null;
	try {
		const body = (await request.json()) as { variantIds?: unknown; shop?: unknown };
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
		shop = normalizeShop(body.shop);
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}

	if (variantIds.length === 0) {
		return Response.json({ compatible: true, locations: [] });
	}

	const startedAt = Date.now();
	let selections: VariantLocations[];
	let unknownCount = 0;
	try {
		selections = await Promise.all(
			variantIds.map(async (variantId) => {
				const raw = await env.LOCATION_BITMAP.get(bitmapKey(toVariantGid(variantId)));
				if (raw === null) unknownCount++;
				const entry = raw ? (JSON.parse(raw) as BitmapEntry) : null;
				return { variantId, locations: entry?.locations ?? [] };
			}),
		);
	} catch {
		// Fail open: a bitmap read failure must never block a shopper from
		// adding to cart. A background reconciliation job (not yet built)
		// is the intended way to catch anything missed this way.
		recordEvent(env.DB, ctx, {
			shop,
			source: "guardrail",
			type: "error",
			level: "error",
			data: { where: "check", message: "bitmap read failed" },
		});
		return Response.json({ compatible: true, locations: [], failOpen: true });
	}

	const result = checkCompatibility(selections);
	recordEvent(env.DB, ctx, {
		shop,
		source: "guardrail",
		type: "check",
		data: {
			n: variantIds.length,
			compatible: result.compatible,
			failOpen: false,
			unknown: unknownCount,
			ms: Date.now() - startedAt,
		},
	});
	return Response.json(result);
}
