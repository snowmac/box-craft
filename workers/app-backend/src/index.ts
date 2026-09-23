import { verifyShopifyHmac } from "../../../shared/hmac.ts";
import { verifyShopifyOAuthHmac } from "../../../shared/oauth-hmac.ts";
import {
	buildAuthorizeUrl,
	buildEmbeddedAppUrl,
	buildOfflineTokenExchangeRequest,
	buildTokenExchangeRequest,
	generateState,
	isValidShopDomain,
} from "./oauth.ts";
import { scopesCover } from "./scopes.ts";
import { verifySessionToken } from "./session-token.ts";
import { ensureStoreSetup, type AdminClient } from "./store-setup.ts";

export interface Env {
	SHOP_TOKENS: KVNamespace;
	SHOPIFY_CLIENT_ID: string;
	SHOPIFY_CLIENT_SECRET: string;
	SHOPIFY_WEBHOOK_SECRET: string;
	// Scopes must match shopify.app.toml's [access_scopes] exactly, or the
	// OAuth grant won't match what the app actually requests at install.
	SHOPIFY_SCOPES: string;
	// This Worker's own public URL, used to build the OAuth redirect_uri.
	// Same value as shopify.app.toml's application_url once that's set.
	APP_URL: string;
}

const STATE_COOKIE = "boxcraft_oauth_state";
const ADMIN_API_VERSION = "2026-07";

interface ShopRecord {
	accessToken: string;
	scope: string;
	installedAt: string;
	// Set once ensureStoreSetup has succeeded for this token.
	setupAt?: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname === "/auth" && request.method === "GET") {
			return handleAuthStart(url, env);
		}

		if (url.pathname === "/auth/callback" && request.method === "GET") {
			return handleAuthCallback(request, url, env);
		}

		if (
			url.pathname === "/webhooks/app/uninstalled" &&
			request.method === "POST"
		) {
			return handleUninstalled(request, env);
		}

		if (url.pathname === "/" && request.method === "GET") {
			return handleEmbeddedShell(url, env);
		}

		return new Response("Not found", { status: 404 });
	},
};

function handleAuthStart(url: URL, env: Env): Response {
	const shop = url.searchParams.get("shop");
	if (!shop || !isValidShopDomain(shop)) {
		return new Response("Missing or invalid shop parameter", { status: 400 });
	}

	const state = generateState();
	const authorizeUrl = buildAuthorizeUrl({
		shop,
		clientId: env.SHOPIFY_CLIENT_ID,
		scopes: env.SHOPIFY_SCOPES,
		redirectUri: `${env.APP_URL}/auth/callback`,
		state,
	});

	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizeUrl,
			// HttpOnly + short-lived: only used to verify the callback
			// belongs to a flow this Worker actually started (CSRF
			// protection), never read by client-side JS.
			"Set-Cookie": `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/auth/callback`,
		},
	});
}

async function handleAuthCallback(
	request: Request,
	url: URL,
	env: Env,
): Promise<Response> {
	const shop = url.searchParams.get("shop");
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	if (!shop || !isValidShopDomain(shop) || !code || !state) {
		return new Response("Missing or invalid callback parameters", { status: 400 });
	}

	const cookieState = readCookie(request, STATE_COOKIE);
	if (!cookieState || cookieState !== state) {
		return new Response("Invalid or expired state", { status: 401 });
	}

	const validHmac = await verifyShopifyOAuthHmac(
		url.searchParams,
		env.SHOPIFY_CLIENT_SECRET,
	);
	if (!validHmac) {
		return new Response("Invalid HMAC", { status: 401 });
	}

	const tokenRequest = buildTokenExchangeRequest(
		shop,
		env.SHOPIFY_CLIENT_ID,
		env.SHOPIFY_CLIENT_SECRET,
		code,
	);
	const tokenRes = await fetch(tokenRequest.url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: tokenRequest.body,
	});

	if (!tokenRes.ok) {
		return new Response("Token exchange failed", { status: 502 });
	}

	const { access_token: accessToken, scope } = (await tokenRes.json()) as {
		access_token: string;
		scope: string;
	};

	await env.SHOP_TOKENS.put(
		shopTokenKey(shop),
		JSON.stringify({ accessToken, scope, installedAt: new Date().toISOString() }),
	);

	return new Response(null, {
		status: 302,
		headers: {
			Location: buildEmbeddedAppUrl(shop, env.SHOPIFY_CLIENT_ID),
			// Clear the state cookie now that it's served its purpose.
			"Set-Cookie": `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/auth/callback`,
		},
	});
}

async function handleUninstalled(request: Request, env: Env): Promise<Response> {
	const rawBody = await request.text();
	const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
	const shopHeader = request.headers.get("X-Shopify-Shop-Domain");

	const valid = await verifyShopifyHmac(rawBody, hmacHeader, env.SHOPIFY_WEBHOOK_SECRET);
	if (!valid) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (shopHeader && isValidShopDomain(shopHeader)) {
		await env.SHOP_TOKENS.delete(shopTokenKey(shopHeader));
	}

	return new Response("ok", { status: 200 });
}

async function handleEmbeddedShell(url: URL, env: Env): Promise<Response> {
	// Managed installation (scopes in shopify.app.toml) never calls /auth:
	// Shopify loads this page with a signed id_token instead, and the app is
	// expected to trade it for an access token. Do that the first time we
	// see a shop.
	const installed = await ensureShopReady(url.searchParams.get("id_token"), env);

	// Minimal shell: no merchant config here for v1 — the Pick-N picker's
	// settings live in the theme editor, and guardrail rules are
	// feature-gated by tier rather than configured per-store (see the
	// Pricing plan). This just confirms the install succeeded.
	const message = installed
		? "<h1>BoxCraft is installed</h1>\n  <p>Add the Pick-N Picker block to a product page from the theme editor to get started.</p>"
		: "<h1>BoxCraft setup didn't finish</h1>\n  <p>Reload this page to try again. If it keeps happening, reinstall the app.</p>";
	const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BoxCraft</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <meta name="shopify-api-key" content="${env.SHOPIFY_CLIENT_ID}">
</head>
<body>
  ${message}
</body>
</html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
}

// Makes sure the shop has an access token covering the current scopes and
// that per-store setup has run. Returns whether both are true afterwards.
async function ensureShopReady(idToken: string | null, env: Env): Promise<boolean> {
	if (!idToken) return false;
	const session = await verifySessionToken(idToken, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET);
	if (!session) return false;
	const key = shopTokenKey(session.shop);

	let record = await env.SHOP_TOKENS.get<ShopRecord>(key, "json");
	// Re-exchange when scopes grew since the stored token was issued (the
	// merchant approves new scopes, but the old token doesn't gain them).
	if (!record || !scopesCover(record.scope, env.SHOPIFY_SCOPES)) {
		record = await exchangeForOfflineToken(session.shop, idToken, env);
		if (!record) return false;
		await env.SHOP_TOKENS.put(key, JSON.stringify(record));
	}

	if (!record.setupAt) {
		try {
			await ensureStoreSetup(adminClient(session.shop, record.accessToken));
		} catch (err) {
			console.error(`store setup failed for ${session.shop}: ${err}`);
			return false;
		}
		record.setupAt = new Date().toISOString();
		await env.SHOP_TOKENS.put(key, JSON.stringify(record));
	}
	return true;
}

async function exchangeForOfflineToken(shop: string, idToken: string, env: Env): Promise<ShopRecord | null> {
	const tokenRequest = buildOfflineTokenExchangeRequest(
		shop,
		env.SHOPIFY_CLIENT_ID,
		env.SHOPIFY_CLIENT_SECRET,
		idToken,
	);
	const tokenRes = await fetch(tokenRequest.url, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: tokenRequest.body,
	});
	if (!tokenRes.ok) {
		console.error(`token exchange failed for ${shop}: ${tokenRes.status}`);
		return null;
	}
	const { access_token: accessToken, scope } = (await tokenRes.json()) as {
		access_token: string;
		scope: string;
	};
	return { accessToken, scope, installedAt: new Date().toISOString() };
}

function adminClient(shop: string, accessToken: string): AdminClient {
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

function shopTokenKey(shop: string): string {
	return `shop:${shop}`;
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return null;
}
