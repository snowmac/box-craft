import { inventoryItemMapKey } from "../../../shared/bitmap.ts";
import { verifyShopifyHmac } from "../../../shared/hmac.ts";
import { recordEvent, type D1Like, type EventContext } from "../../../shared/events.ts";
import { SkuDebouncer, type DebouncerEnv } from "./debouncer.ts";
import { createDurableObjectDebouncer } from "./debouncer-adapter.ts";
import { computeBundleSaleSummary, type OrdersPaidPayload } from "./orders-paid.ts";

export interface Env extends DebouncerEnv {
	SKU_DEBOUNCER: DurableObjectNamespace;
	SHOPIFY_WEBHOOK_SECRET: string;
	DB: D1Like;
}

interface InventoryLevelsUpdatePayload {
	inventory_item_id: number;
	location_id: number;
	available: number;
}

export default {
	async fetch(request: Request, env: Env, ctx: EventContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (
			url.pathname === "/webhooks/inventory-levels-update" &&
			request.method === "POST"
		) {
			return handleWebhook(request, env, ctx);
		}

		if (url.pathname === "/webhooks/orders-paid" && request.method === "POST") {
			return handleOrdersPaidWebhook(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};

export async function handleWebhook(
	request: Request,
	env: Env,
	ctx: EventContext,
): Promise<Response> {
	const rawBody = await request.text();
	const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
	const shop = request.headers.get("X-Shopify-Shop-Domain");

	const valid = await verifyShopifyHmac(
		rawBody,
		hmacHeader,
		env.SHOPIFY_WEBHOOK_SECRET,
	);
	if (!valid) {
		return new Response("Unauthorized", { status: 401 });
	}

	let payload: InventoryLevelsUpdatePayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response("Invalid payload", { status: 400 });
	}

	// Shopify's inventory_levels/update payload carries inventory_item_id,
	// not a variant GID, but the bitmap (per the Technical Spec) is keyed by
	// variant GID. Translate via a lookup populated by the backfill script.
	let variantGid: string | null;
	try {
		variantGid = await env.LOCATION_BITMAP.get(
			inventoryItemMapKey(String(payload.inventory_item_id)),
		);
	} catch {
		// Fail open on the lookup too: if we can't read the mapping, drop
		// this event rather than guess. The next backfill run corrects any
		// staleness this causes.
		recordEvent(env.DB, ctx, {
			shop,
			source: "webhook",
			type: "error",
			level: "error",
			data: { where: "inventory_item_lookup", message: "KV read failed" },
		});
		return new Response("accepted", { status: 202 });
	}

	if (!variantGid) {
		// No mapping yet — likely a variant created after the last backfill.
		// Drop the event; a subsequent backfill run will pick up its current
		// state. We deliberately don't write under an unverified key.
		recordEvent(env.DB, ctx, {
			shop,
			source: "webhook",
			type: "webhook_inventory",
			data: { status: "dropped_unknown_item" },
		});
		return new Response("accepted, no mapping yet", { status: 202 });
	}

	const locationId = `gid://shopify/Location/${payload.location_id}`;

	const debouncer = createDurableObjectDebouncer(env);
	await debouncer.schedule(variantGid, {
		locationId,
		available: payload.available > 0,
	});

	recordEvent(env.DB, ctx, {
		shop,
		source: "webhook",
		type: "webhook_inventory",
		data: { status: "written" },
	});

	return new Response("ok", { status: 202 });
}

export async function handleOrdersPaidWebhook(
	request: Request,
	env: Env,
	ctx: EventContext,
): Promise<Response> {
	const rawBody = await request.text();
	const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
	const shop = request.headers.get("X-Shopify-Shop-Domain");

	const valid = await verifyShopifyHmac(rawBody, hmacHeader, env.SHOPIFY_WEBHOOK_SECRET);
	if (!valid) {
		return new Response("Unauthorized", { status: 401 });
	}

	let payload: OrdersPaidPayload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return new Response("Invalid payload", { status: 400 });
	}

	const summary = computeBundleSaleSummary(payload);
	if (summary) {
		recordEvent(env.DB, ctx, {
			shop,
			source: "webhook",
			type: "bundle_sold",
			data: {
				orderId: summary.orderId,
				bundleCount: summary.bundleCount,
				revenueCents: summary.revenueCents,
			},
		});
	}

	return new Response("ok", { status: 202 });
}

export { SkuDebouncer };
