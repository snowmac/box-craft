import { verifySessionToken } from "./session-token.ts";
import { getShopConfig, upsertShopConfig, listBoxes, upsertBox, deleteBox, type ShopConfig } from "./db.ts";
import { validateBoxInput, validateConfigInput, toBox, isValidHandle, type ConfigInput } from "./validate.ts";
import { writeBoxesMetafields } from "./boxes-metafield.ts";
import { adminClient } from "./admin-client.ts";
import type { D1Like } from "../../../shared/events.ts";

export interface ApiEnv {
	SHOP_TOKENS: KVNamespace;
	SHOPIFY_CLIENT_ID: string;
	SHOPIFY_CLIENT_SECRET: string;
	DB: D1Like;
}

interface AuthedShop {
	shop: string;
	accessToken: string;
}

// D14: every /api/* route requires a valid App Bridge session token. The
// shop always comes from the verified token, never from the request body
// or query string — a merchant's browser can't spoof another shop's data
// this way.
async function authenticate(request: Request, env: ApiEnv): Promise<AuthedShop | null> {
	const authHeader = request.headers.get("Authorization");
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
	if (!token) return null;

	const session = await verifySessionToken(token, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET);
	if (!session) return null;

	const record = await env.SHOP_TOKENS.get<{ accessToken: string }>(`shop:${session.shop}`, "json");
	if (!record) return null;

	return { shop: session.shop, accessToken: record.accessToken };
}

export async function handleApi(request: Request, url: URL, env: ApiEnv): Promise<Response> {
	const authed = await authenticate(request, env);
	if (!authed) return Response.json({ error: "unauthorized" }, { status: 401 });

	if (url.pathname === "/api/overview" && request.method === "GET") {
		return handleOverview(authed, env);
	}
	if (url.pathname === "/api/config" && request.method === "GET") {
		const config = await getShopConfig(env.DB, authed.shop);
		return Response.json(config);
	}
	if (url.pathname === "/api/config" && request.method === "PUT") {
		return handlePutConfig(request, authed, env);
	}
	if (url.pathname === "/api/boxes" && request.method === "GET") {
		const boxes = await listBoxes(env.DB, authed.shop);
		return Response.json({ boxes });
	}
	if (url.pathname === "/api/boxes" && request.method === "POST") {
		return handleSaveBox(request, authed, env, null);
	}

	const boxMatch = url.pathname.match(/^\/api\/boxes\/([^/]+)$/);
	if (boxMatch) {
		const handle = decodeURIComponent(boxMatch[1]);
		if (request.method === "PUT") return handleSaveBox(request, authed, env, handle);
		if (request.method === "DELETE") return handleDeleteBox(authed, env, handle);
	}

	if (url.pathname === "/api/sync" && request.method === "POST") {
		// T9 wires in the real inventory-sync implementation. This route
		// exists now, correctly authenticated, so the admin UI (T12) can be
		// built against a stable API shape ahead of that.
		return Response.json({ error: "not implemented yet" }, { status: 501 });
	}

	return new Response("Not found", { status: 404 });
}

async function handleOverview(authed: AuthedShop, env: ApiEnv): Promise<Response> {
	const record = await env.SHOP_TOKENS.get<{ installedAt: string; setupAt?: string }>(
		`shop:${authed.shop}`,
		"json",
	);
	return Response.json({
		shop: authed.shop,
		installed: !!record,
		setupAt: record?.setupAt ?? null,
	});
}

async function handlePutConfig(request: Request, authed: AuthedShop, env: ApiEnv): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}

	const result = validateConfigInput(body);
	if (!result.valid) return Response.json({ errors: result.errors }, { status: 400 });

	const input = body as ConfigInput;
	const patch: Partial<ShopConfig> = {};
	if (input.guardrail_enabled !== undefined) patch.guardrailEnabled = input.guardrail_enabled;
	if (input.unknown_stock_policy !== undefined) patch.unknownStockPolicy = input.unknown_stock_policy;

	const updated = await upsertShopConfig(env.DB, authed.shop, patch);
	return Response.json(updated);
}

// handle === null means POST /api/boxes (create, handle comes from the
// body); otherwise it's PUT /api/boxes/:handle (update, URL's handle wins
// over anything conflicting in the body).
async function handleSaveBox(
	request: Request,
	authed: AuthedShop,
	env: ApiEnv,
	handle: string | null,
): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}

	if (handle !== null) {
		if (!isValidHandle(handle)) return Response.json({ error: "invalid handle" }, { status: 400 });
		body = { ...(body as Record<string, unknown>), handle };
	}

	const result = validateBoxInput(body);
	if (!result.valid) return Response.json({ errors: result.errors }, { status: 400 });

	const box = toBox(body as Record<string, unknown>);
	await upsertBox(env.DB, authed.shop, box);

	try {
		await syncBoxesMetafields(authed, env);
	} catch (err) {
		// The box is saved in D1 either way; only the Shopify-side sync
		// (what the storefront/function actually read) failed. Surface it
		// distinctly so the admin UI can show "saved, but not synced yet."
		const message = err instanceof Error ? err.message : String(err);
		return Response.json({ box, syncError: message }, { status: 207 });
	}

	return Response.json(box, { status: handle === null ? 201 : 200 });
}

async function handleDeleteBox(authed: AuthedShop, env: ApiEnv, handle: string): Promise<Response> {
	if (!isValidHandle(handle)) return Response.json({ error: "invalid handle" }, { status: 400 });

	await deleteBox(env.DB, authed.shop, handle);

	try {
		await syncBoxesMetafields(authed, env);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return Response.json({ syncError: message }, { status: 207 });
	}

	return new Response(null, { status: 204 });
}

async function syncBoxesMetafields(authed: AuthedShop, env: ApiEnv): Promise<void> {
	const boxes = await listBoxes(env.DB, authed.shop);
	await writeBoxesMetafields(adminClient(authed.shop, authed.accessToken), boxes);
}
