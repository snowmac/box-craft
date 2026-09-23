// D15: OPS_TOKEN auth. The login cookie is an HMAC of a fixed message,
// keyed by OPS_TOKEN — never the token itself, so nothing that ever
// leaves the server (the cookie) could be used to recover OPS_TOKEN, and
// verifying a request never needs the raw token to be sent again.
export const OPS_SESSION_COOKIE = "box_craft_ops_session";
const SESSION_MESSAGE = "box-craft-ops-session-v1";
// 7 days — long enough that a single operator isn't re-logging-in
// constantly; Cloudflare Access (human checkpoint) is the intended
// defense-in-depth layer on top, not a short cookie lifetime.
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function signOpsSession(opsToken: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(opsToken),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(SESSION_MESSAGE));
	return hex(signature);
}

export async function verifyOpsSession(cookieValue: string | null, opsToken: string): Promise<boolean> {
	if (!cookieValue || !opsToken) return false;
	const expected = await signOpsSession(opsToken);
	return timingSafeEqual(cookieValue, expected);
}

export function verifyOpsToken(submitted: string, opsToken: string): boolean {
	if (!submitted || !opsToken) return false;
	return timingSafeEqual(submitted, opsToken);
}

export function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
}

export function sessionCookieHeader(sessionValue: string): string {
	return `${OPS_SESSION_COOKIE}=${sessionValue}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/`;
}

export function clearedSessionCookieHeader(): string {
	return `${OPS_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

function hex(buffer: ArrayBuffer): string {
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
