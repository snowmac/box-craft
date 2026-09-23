import type { D1Like, EventContext } from "../../../shared/events.ts";
import {
	readCookie,
	signOpsSession,
	verifyOpsSession,
	verifyOpsToken,
	sessionCookieHeader,
	clearedSessionCookieHeader,
	OPS_SESSION_COOKIE,
} from "./auth.ts";
import { renderLoginPage } from "./login-page.ts";
import { renderLayout, type FlashMessage } from "./layout.ts";
import { CONSOLE_CSS } from "./console.css.ts";
import { CONSOLE_JS } from "./console.js.ts";
import {
	loadOverviewShops,
	checkWorkerHealth,
	getRecentEventsForShop,
	getSyncHistory,
	queryEvents,
	getErrorGroups,
	type EventFilters,
} from "./queries.ts";
import {
	renderOverviewBody,
	renderStoreDetailBody,
	renderEventsBody,
	renderErrorsBody,
	renderKvInspectorBody,
	renderGuardrailTesterBody,
} from "./views.ts";
import { rerunStoreSetup, triggerSync, forceSetupReRun, pruneEventsNow } from "./actions.ts";
import { lookupVariantBitmap, lookupInventoryItemVariant } from "./kv-inspector.ts";
import { parseVariantIdsInput, runGuardrailTest } from "./guardrail-tester.ts";
import { getShopConfig } from "../../../shared/shop-config.ts";
import { listBoxes } from "../../app-backend/src/db.ts";
import { checkSetupStatus } from "../../app-backend/src/setup-status.ts";
import { adminClient } from "../../app-backend/src/admin-client.ts";

export interface Env {
	DB: D1Like;
	SHOP_TOKENS: KVNamespace;
	LOCATION_BITMAP: KVNamespace;
	OPS_TOKEN: string;
	SHOPIFY_CLIENT_ID: string;
	SHOPIFY_CLIENT_SECRET: string;
	GUARDRAIL_WORKER_URL: string;
	WEBHOOK_CONSUMER_URL: string;
	APP_BACKEND_URL: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default {
	async fetch(request: Request, env: Env, ctx: EventContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname === "/console.css") {
			return new Response(CONSOLE_CSS, {
				headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
			});
		}

		if (url.pathname === "/console.js") {
			return new Response(CONSOLE_JS, {
				headers: {
					"Content-Type": "application/javascript; charset=utf-8",
					"Cache-Control": "public, max-age=31536000, immutable",
				},
			});
		}

		if (url.pathname === "/login" && request.method === "GET") {
			return htmlResponse(renderLoginPage());
		}

		if (url.pathname === "/login" && request.method === "POST") {
			return handleLogin(request, env);
		}

		if (url.pathname === "/logout" && request.method === "POST") {
			return new Response(null, {
				status: 302,
				headers: { Location: "/login", "Set-Cookie": clearedSessionCookieHeader() },
			});
		}

		// D15: every other route requires the signed session cookie.
		const authed = await verifyOpsSession(readCookie(request, OPS_SESSION_COOKIE), env.OPS_TOKEN);
		if (!authed) {
			return new Response(null, { status: 302, headers: { Location: "/login" } });
		}

		const flash = readFlash(request);

		if (url.pathname === "/" && request.method === "GET") {
			return maybeClearFlash(await handleOverview(env, flash), flash);
		}

		const storeMatch = url.pathname.match(/^\/stores\/([^/]+)$/);
		if (storeMatch && request.method === "GET") {
			return maybeClearFlash(await handleStoreDetail(decodeURIComponent(storeMatch[1]), env, flash), flash);
		}

		if (url.pathname === "/events" && request.method === "GET") {
			return handleEvents(url, env);
		}

		if (url.pathname === "/errors" && request.method === "GET") {
			return maybeClearFlash(await handleErrors(url, env, flash), flash);
		}

		if (url.pathname === "/kv" && request.method === "GET") {
			return handleKvInspector(url, env);
		}

		if (url.pathname === "/guardrail-tester" && request.method === "GET") {
			return handleGuardrailTester(url, env);
		}

		const actionMatch = url.pathname.match(/^\/actions\/([a-z-]+)$/);
		if (actionMatch && request.method === "POST") {
			return handleAction(actionMatch[1], request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};

async function handleLogin(request: Request, env: Env): Promise<Response> {
	let submitted: string;
	try {
		const form = await request.formData();
		submitted = String(form.get("token") ?? "");
	} catch {
		return new Response(null, { status: 400 });
	}

	if (!verifyOpsToken(submitted, env.OPS_TOKEN)) {
		return htmlResponse(renderLoginPage({ error: true }), 401);
	}

	const sessionValue = await signOpsSession(env.OPS_TOKEN);
	return new Response(null, {
		status: 302,
		headers: { Location: "/", "Set-Cookie": sessionCookieHeader(sessionValue) },
	});
}

async function handleOverview(env: Env, flash: FlashMessage | null): Promise<Response> {
	const [shops, guardrail, webhookConsumer, appBackend] = await Promise.all([
		loadOverviewShops(env),
		checkWorkerHealth(env.GUARDRAIL_WORKER_URL),
		checkWorkerHealth(env.WEBHOOK_CONSUMER_URL),
		checkWorkerHealth(env.APP_BACKEND_URL),
	]);
	const body = renderOverviewBody(shops, { guardrail, webhookConsumer, appBackend });
	return htmlResponse(renderLayout({ title: "Overview", activePath: "/", body, flash }));
}

async function handleStoreDetail(shop: string, env: Env, flash: FlashMessage | null): Promise<Response> {
	const record = await env.SHOP_TOKENS.get<{ accessToken: string; scope: string }>(`shop:${shop}`, "json");
	if (!record) {
		return htmlResponse(
			renderLayout({ title: shop, activePath: "/", body: `<p>No stored record for ${shop}.</p>`, flash }),
			404,
		);
	}

	const [config, boxes, events, syncHistory, setupStatus] = await Promise.all([
		getShopConfig(env.DB, shop),
		listBoxes(env.DB, shop),
		getRecentEventsForShop(env.DB, shop, 50),
		getSyncHistory(env.DB, shop, 20),
		checkSetupStatus(adminClient(shop, record.accessToken)).catch(() => ({
			bundleProductPublished: false,
			cartTransformActive: false,
		})),
	]);

	const body = renderStoreDetailBody({
		shop,
		scope: record.scope,
		config,
		boxes,
		events,
		syncHistory,
		bundleProductPublished: setupStatus.bundleProductPublished,
		cartTransformActive: setupStatus.cartTransformActive,
	});
	return htmlResponse(renderLayout({ title: shop, activePath: "/", body, flash }));
}

function parseEventFilters(url: URL): EventFilters {
	const filters: EventFilters = {};
	const shop = url.searchParams.get("shop");
	const source = url.searchParams.get("source");
	const type = url.searchParams.get("type");
	const level = url.searchParams.get("level");
	const since = url.searchParams.get("since");
	const until = url.searchParams.get("until");
	if (shop) filters.shop = shop;
	if (source) filters.source = source;
	if (type) filters.type = type;
	if (level) filters.level = level;
	if (since) {
		const ms = Date.parse(since);
		if (!Number.isNaN(ms)) filters.sinceMs = ms;
	}
	if (until) {
		const ms = Date.parse(until);
		if (!Number.isNaN(ms)) filters.untilMs = ms;
	}
	return filters;
}

async function handleEvents(url: URL, env: Env): Promise<Response> {
	const filters = parseEventFilters(url);
	const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);
	const { rows, hasMore } = await queryEvents(env.DB, filters, page);
	const body = renderEventsBody(filters, rows, hasMore, page, url.search.replace(/^\?/, ""));
	return htmlResponse(renderLayout({ title: "Events", activePath: "/events", body }));
}

async function handleErrors(url: URL, env: Env, flash: FlashMessage | null): Promise<Response> {
	const days = [1, 7, 30].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 7;
	const groups = await getErrorGroups(env.DB, Date.now() - days * DAY_MS);
	const body = renderErrorsBody(groups, days);
	return htmlResponse(renderLayout({ title: "Errors", activePath: "/errors", body, flash }));
}

async function handleKvInspector(url: URL, env: Env): Promise<Response> {
	const variantId = url.searchParams.get("variant") ?? undefined;
	const inventoryItemId = url.searchParams.get("inventory_item") ?? undefined;

	const [variantResult, inventoryItemResult] = await Promise.all([
		variantId ? lookupVariantBitmap(env.LOCATION_BITMAP, variantId) : Promise.resolve(undefined),
		inventoryItemId ? lookupInventoryItemVariant(env.LOCATION_BITMAP, inventoryItemId) : Promise.resolve(undefined),
	]);

	const body = renderKvInspectorBody({ variantId, variantResult, inventoryItemId, inventoryItemResult });
	return htmlResponse(renderLayout({ title: "KV inspector", activePath: "/kv", body }));
}

async function handleGuardrailTester(url: URL, env: Env): Promise<Response> {
	const shop = url.searchParams.get("shop") ?? undefined;
	const variantIdsRaw = url.searchParams.get("variant_ids") ?? undefined;

	if (!shop || !variantIdsRaw) {
		return htmlResponse(
			renderLayout({
				title: "Guardrail tester",
				activePath: "/guardrail-tester",
				body: renderGuardrailTesterBody({ shop, variantIdsRaw }),
			}),
		);
	}

	const variantIds = parseVariantIdsInput(variantIdsRaw);
	if (variantIds.length === 0) {
		return htmlResponse(
			renderLayout({
				title: "Guardrail tester",
				activePath: "/guardrail-tester",
				body: renderGuardrailTesterBody({ shop, variantIdsRaw, error: "Paste at least one variant id." }),
			}),
		);
	}

	const result = await runGuardrailTest(env.LOCATION_BITMAP, env.GUARDRAIL_WORKER_URL, shop, variantIds);
	const body = renderGuardrailTesterBody({ shop, variantIdsRaw, result });
	return htmlResponse(renderLayout({ title: "Guardrail tester", activePath: "/guardrail-tester", body }));
}

async function handleAction(name: string, request: Request, env: Env, ctx: EventContext): Promise<Response> {
	let shop: string;
	try {
		const form = await request.formData();
		shop = String(form.get("shop") ?? "");
	} catch {
		return new Response(null, { status: 400 });
	}

	let result: { ok: boolean; message: string };
	let redirectTo = shop ? `/stores/${encodeURIComponent(shop)}` : "/";

	switch (name) {
		case "rerun-setup":
			result = await rerunStoreSetup(env.SHOP_TOKENS, shop);
			break;
		case "run-sync":
			result = await triggerSync(env, ctx, shop);
			break;
		case "force-reexchange":
			result = await forceSetupReRun(env.SHOP_TOKENS, shop);
			break;
		case "prune-events":
			result = await pruneEventsNow(env.DB);
			redirectTo = "/errors";
			break;
		default:
			return new Response("Not found", { status: 404 });
	}

	return redirectWithFlash(redirectTo, result);
}

// Flash messages ride a short-lived, unsigned cookie set right before the
// redirect and cleared as soon as the next response reads it — good enough
// for a same-browser redirect-after-POST, no session storage needed.
const FLASH_COOKIE = "box_craft_ops_flash";

function redirectWithFlash(location: string, flash: FlashMessage): Response {
	return new Response(null, {
		status: 302,
		headers: {
			Location: location,
			"Set-Cookie": `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify(flash))}; HttpOnly; Secure; SameSite=Strict; Max-Age=10; Path=/`,
		},
	});
}

function readFlash(request: Request): FlashMessage | null {
	const raw = readCookie(request, FLASH_COOKIE);
	if (!raw) return null;
	try {
		return JSON.parse(decodeURIComponent(raw)) as FlashMessage;
	} catch {
		return null;
	}
}

// Shown once: if a flash was read for this response, clear the cookie so a
// later unrelated navigation in the same tab doesn't repeat it.
function maybeClearFlash(response: Response, flash: FlashMessage | null): Response {
	if (!flash) return response;
	const cleared = new Response(response.body, response);
	cleared.headers.append("Set-Cookie", `${FLASH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`);
	return cleared;
}

function htmlResponse(html: string, status = 200): Response {
	return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
