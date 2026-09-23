// Minimal structural type for Cloudflare's D1Database, so shared code
// doesn't depend on @cloudflare/workers-types directly — callers pass
// their real D1Database (or a test mock) wherever this is expected.
export interface D1ResultLike {
	run(): Promise<unknown>;
	first<T = unknown>(): Promise<T | null>;
	all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface D1PreparedStatementLike {
	bind(...values: unknown[]): D1ResultLike;
}

export interface D1Like {
	prepare(query: string): D1PreparedStatementLike;
}
