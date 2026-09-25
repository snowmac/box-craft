// Portability plan D1/T1: the narrow slice of Cloudflare's KVNamespace this
// codebase actually calls, so a future non-Cloudflare KV backend (Redis, a
// Postgres table) needs one adapter class instead of a rewrite of every
// caller. Mirrors shared/events.ts's D1Like pattern. Cloudflare's real
// KVNamespace already structurally satisfies this — no runtime wrapper
// needed, same as D1Like needs none for D1 today.
export interface KVListResult {
	keys: { name: string }[];
	list_complete: boolean;
	cursor?: string;
}

export interface KVLike {
	get(key: string): Promise<string | null>;
	get<T>(key: string, type: "json"): Promise<T | null>;
	put(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	list(options?: { prefix?: string; cursor?: string }): Promise<KVListResult>;
}
