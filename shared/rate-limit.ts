// A simple in-isolate sliding-window rate limiter. Not distributed — each
// Cloudflare isolate has its own state — but good enough to blunt a single
// abusive client hammering a public, unauthenticated endpoint (T7's
// /events beacon). A real abuse case spread across many isolates needs a
// KV/D1-backed limiter, not built here since nothing currently needs it.
export interface RateLimiter {
	allow(key: string, now: number): boolean;
}

export function createRateLimiter(maxPerWindow: number, windowMs: number): RateLimiter {
	const hits = new Map<string, number[]>();

	return {
		allow(key, now) {
			const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
			if (recent.length >= maxPerWindow) {
				hits.set(key, recent);
				return false;
			}
			recent.push(now);
			hits.set(key, recent);
			return true;
		},
	};
}
