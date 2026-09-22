export interface Env {}

export default {
	async fetch(request: Request, _env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname === "/check" && request.method === "POST") {
			return Response.json(
				{ error: "not_implemented" },
				{ status: 501 },
			);
		}

		return new Response("Not found", { status: 404 });
	},
};
