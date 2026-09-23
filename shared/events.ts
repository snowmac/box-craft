// Shared event-logging helper for all Workers. buildEventRow is pure and
// unit-tested directly; recordEvent is the thin Worker-facing wrapper that
// never lets logging fail the caller's request (D4 in
// specs/product/admin-and-ops-plan.md).

export type EventSource = "guardrail" | "picker" | "webhook" | "app" | "cron";
export type EventLevel = "info" | "warn" | "error";

export interface EventInput {
	shop?: string | null;
	source: EventSource;
	type: string;
	level?: EventLevel;
	data?: Record<string, unknown>;
}

export interface EventRow {
	ts: number;
	shop: string | null;
	source: string;
	type: string;
	level: string;
	data: string | null;
}

const MAX_DATA_JSON_LENGTH = 2048;

// Defensive check, not a guarantee: catches the obvious cases (a caller
// accidentally passing a customer object through) without trying to be a
// general PII scanner. Real prevention is each call site only ever
// building small, deliberate data objects (ids, counts, money totals).
const PII_KEY_PATTERN = /email|name|phone|address|customer/i;

export function buildEventRow(input: EventInput, now: () => number = Date.now): EventRow {
	if (input.data) {
		for (const key of Object.keys(input.data)) {
			if (PII_KEY_PATTERN.test(key)) {
				throw new Error(`buildEventRow: refusing to record PII-looking key "${key}"`);
			}
		}
	}

	return {
		ts: now(),
		shop: input.shop ?? null,
		source: input.source,
		type: input.type,
		level: input.level ?? "info",
		data: input.data ? truncateJson(input.data) : null,
	};
}

function truncateJson(data: Record<string, unknown>): string {
	const full = JSON.stringify(data);
	if (full.length <= MAX_DATA_JSON_LENGTH) return full;
	// Re-serialize as a wrapper so the stored value is always valid JSON,
	// even though the original data didn't fit.
	return JSON.stringify({
		truncated: true,
		originalLength: full.length,
		preview: full.slice(0, 500),
	});
}

export type { D1Like } from "./d1.ts";
import type { D1Like } from "./d1.ts";

export interface EventContext {
	waitUntil(promise: Promise<unknown>): void;
}

export function recordEvent(db: D1Like, ctx: EventContext, input: EventInput): void {
	try {
		const row = buildEventRow(input);
		ctx.waitUntil(
			db
				.prepare(
					"INSERT INTO events (ts, shop, source, type, level, data) VALUES (?, ?, ?, ?, ?, ?)",
				)
				.bind(row.ts, row.shop, row.source, row.type, row.level, row.data)
				.run()
				.catch(() => {}),
		);
	} catch {
		// Never let event recording break the caller.
	}
}
