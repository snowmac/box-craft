// The Pick-N picker calls /check from each merchant's storefront domain, so
// the browser sends a CORS preflight for its JSON POST. /check is public and
// unauthenticated (see Technical Spec) and uses no cookies, so any origin is
// allowed.
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

export function preflightResponse(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	return new Response(response.body, { status: response.status, headers });
}
