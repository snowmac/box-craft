import { isValidShopDomain } from "./oauth.ts";

// Verifies a Shopify session token (the `id_token` Shopify passes when it
// loads the embedded app). It's an HS256 JWT signed with the app's client
// secret. With managed installation (scopes declared in shopify.app.toml),
// Shopify never calls /auth — this token is the only proof of which shop is
// loading the app, and the input to token exchange.
// https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens

// Tolerates small clock skew between Shopify and Cloudflare.
const CLOCK_LEEWAY_SECONDS = 5;

export async function verifySessionToken(
	token: string,
	clientId: string,
	clientSecret: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ shop: string } | null> {
	const parts = token.split(".");
	if (parts.length !== 3 || !clientSecret) return null;
	const [head, body, sig] = parts;

	let header: { alg?: string };
	let payload: { aud?: string; dest?: string; exp?: number; nbf?: number };
	try {
		header = JSON.parse(decodeBase64Url(head));
		payload = JSON.parse(decodeBase64Url(body));
	} catch {
		return null;
	}
	if (header.alg !== "HS256") return null;

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(clientSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	let signature: Uint8Array;
	try {
		signature = base64UrlToBytes(sig);
	} catch {
		return null;
	}
	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signature,
		new TextEncoder().encode(`${head}.${body}`),
	);
	if (!valid) return null;

	if (payload.aud !== clientId) return null;
	if (typeof payload.exp !== "number" || payload.exp < nowSeconds - CLOCK_LEEWAY_SECONDS) return null;
	if (typeof payload.nbf === "number" && payload.nbf > nowSeconds + CLOCK_LEEWAY_SECONDS) return null;

	let shop: string;
	try {
		const dest = new URL(payload.dest ?? "");
		if (dest.protocol !== "https:") return null;
		shop = dest.hostname;
	} catch {
		return null;
	}
	if (!isValidShopDomain(shop)) return null;

	return { shop };
}

function base64UrlToBytes(input: string): Uint8Array {
	const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function decodeBase64Url(input: string): string {
	return new TextDecoder().decode(base64UrlToBytes(input));
}
