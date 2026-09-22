// Shopify's OAuth callback HMAC is a different algorithm than the webhook
// HMAC in shared/hmac.ts: it's a hex digest (not base64) over the sorted,
// URL-decoded query string with `hmac` and `signature` excluded — not over
// a raw JSON body. Kept separate rather than generalizing the two into one
// function, since conflating them is an easy way to introduce a signature
// verification bug.
export async function verifyShopifyOAuthHmac(
	params: URLSearchParams,
	secret: string,
): Promise<boolean> {
	const hmac = params.get("hmac");
	if (!hmac || !secret) return false;

	const pairs: string[] = [];
	for (const [key, value] of params.entries()) {
		if (key === "hmac" || key === "signature") continue;
		pairs.push(`${key}=${value}`);
	}
	pairs.sort();
	const message = pairs.join("&");

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	const computed = toHex(signature);
	return timingSafeEqual(computed, hmac);
}

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}
