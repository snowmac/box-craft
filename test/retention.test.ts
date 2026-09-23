import { test } from "node:test";
import assert from "node:assert/strict";
import { eventRetentionCutoff, pruneOldEvents, EVENT_RETENTION_DAYS } from "../shared/retention.ts";

test("eventRetentionCutoff subtracts the retention window from now", () => {
	const now = Date.UTC(2026, 5, 1); // 2026-06-01
	const cutoff = eventRetentionCutoff(now, 90);
	assert.equal(cutoff, now - 90 * 24 * 60 * 60 * 1000);
	assert.equal(new Date(cutoff).toISOString().slice(0, 10), "2026-03-03");
});

test("eventRetentionCutoff defaults to the 90-day constant", () => {
	const now = 1_800_000_000_000;
	assert.equal(eventRetentionCutoff(now), eventRetentionCutoff(now, EVENT_RETENTION_DAYS));
});

test("pruneOldEvents deletes rows older than the cutoff", async () => {
	let boundValue: unknown;
	const db = {
		prepare: (query: string) => {
			assert.match(query, /DELETE FROM events WHERE ts < \?/);
			return {
				bind: (...args: unknown[]) => {
					boundValue = args[0];
					return { run: async () => {}, first: async () => null, all: async () => ({ results: [] }) };
				},
			};
		},
	};

	const now = Date.UTC(2026, 5, 1);
	await pruneOldEvents(db, now);
	assert.equal(boundValue, eventRetentionCutoff(now));
});
