import { verifyShopifyHmac } from "../../../shared/hmac.ts";
import { verifyShopifyOAuthHmac } from "../../../shared/oauth-hmac.ts";
import {
	buildAuthorizeUrl,
	buildEmbeddedAppUrl,
	buildTokenExchangeRequest,
	generateState,
	isValidShopDomain,
} from "./oauth.ts";

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

function handleEmbeddedShell(_url: URL, env: Env): Response {
	// Minimal shell: no merchant config here for v1 — the Pick-N picker's
	// settings live in the theme editor, and guardrail rules are
	// feature-gated by tier rather than configured per-store (see the
	// Pricing plan). This just confirms the install succeeded.
	const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BoxCraft</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <meta name="shopify-api-key" content="${env.SHOPIFY_CLIENT_ID}">
</head>
<body>
  <h1>BoxCraft is installed</h1>
  <p>Add the Pick-N Picker block to a product page from the theme editor to get started.</p>
</body>
</html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
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
