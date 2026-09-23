import type { D1Like } from "../../../shared/events.ts";
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

export interface Env {
	DB: D1Like;
	SHOP_TOKENS: KVNamespace;
	LOCATION_BITMAP: KVNamespace;
	OPS_TOKEN: string;
	SHOPIFY_CLIENT_ID: string;
	SHOPIFY_CLIENT_SECRET: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
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

		if (url.pathname === "/" && request.method === "GET") {
			// T14 replaces this with the real Overview view.
			return htmlResponse("<!DOCTYPE html><html><body><h1>BoxCraft Ops</h1></body></html>");
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

function htmlResponse(html: string, status = 200): Response {
	return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
