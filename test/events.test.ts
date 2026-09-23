import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEventRow, recordEvent } from "../shared/events.ts";

const FIXED_NOW = () => 1_700_000_000_000;

test("buildEventRow fills defaults for level and shop", () => {
	const row = buildEventRow({ source: "guardrail", type: "check" }, FIXED_NOW);
	assert.equal(row.level, "info");
	assert.equal(row.shop, null);
	assert.equal(row.ts, FIXED_NOW());
	assert.equal(row.data, null);
});

test("buildEventRow carries shop, source, type, level, and data through", () => {
	const row = buildEventRow(
		{
			shop: "box-craft-demo.myshopify.com",
			source: "picker",
			type: "bundle_added",
			level: "warn",
			data: { items: 4, box: "default" },
		},
		FIXED_NOW,
	);
	assert.equal(row.shop, "box-craft-demo.myshopify.com");
	assert.equal(row.source, "picker");
	assert.equal(row.type, "bundle_added");
	assert.equal(row.level, "warn");
	assert.deepEqual(JSON.parse(row.data!), { items: 4, box: "default" });
});

test("buildEventRow rejects PII-looking keys", () => {
	assert.throws(
		() => buildEventRow({ source: "webhook", type: "order", data: { customerEmail: "a@b.com" } }, FIXED_NOW),
		/PII/,
	);
	assert.throws(() => buildEventRow({ source: "app", type: "x", data: { name: "Adam" } }, FIXED_NOW), /PII/);
});

test("buildEventRow allows non-PII keys that merely contain safe substrings", () => {
	// Sanity check the pattern isn't so broad it blocks legitimate fields.
	const row = buildEventRow({ source: "guardrail", type: "check", data: { n: 4, ms: 12 } }, FIXED_NOW);
	assert.deepEqual(JSON.parse(row.data!), { n: 4, ms: 12 });
});

test("buildEventRow truncates data over ~2KB into a valid-JSON wrapper", () => {
	const bigString = "x".repeat(3000);
	const row = buildEventRow({ source: "app", type: "big", data: { blob: bigString } }, FIXED_NOW);
	const parsed = JSON.parse(row.data!);
	assert.equal(parsed.truncated, true);
	assert.ok(parsed.originalLength > 2048);
	assert.ok(parsed.preview.length <= 500);
});

test("recordEvent never throws synchronously, even on a PII-rejected payload", () => {
	const calls: unknown[] = [];
	const db = {
		prepare: () => ({
			bind: (...args: unknown[]) => {
				calls.push(args);
				return { run: async () => {}, first: async () => null, all: async () => ({ results: [] }) };
			},
		}),
	};
	const ctx = { waitUntil: (p: Promise<unknown>) => void p };

	assert.doesNotThrow(() => recordEvent(db, ctx, { source: "app", type: "x", data: { email: "a@b.com" } }));
	assert.equal(calls.length, 0); // rejected before ever reaching the DB
});

test("recordEvent queues an insert via ctx.waitUntil on a valid event", () => {
	let bound: unknown[] | null = null;
	const db = {
		prepare: (query: string) => {
			assert.match(query, /INSERT INTO events/);
			return {
				bind: (...args: unknown[]) => {
					bound = args;
					return { run: async () => {}, first: async () => null, all: async () => ({ results: [] }) };
				},
			};
		},
	};
	const waited: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) };

	recordEvent(db, ctx, { shop: "box-craft-demo.myshopify.com", source: "guardrail", type: "check" });

	assert.equal(waited.length, 1);
	assert.ok(bound);
	assert.equal((bound as unknown[])[1], "box-craft-demo.myshopify.com");
});

test("recordEvent never throws even if the DB write itself rejects", async () => {
	const db = {
		prepare: () => ({
			bind: () => ({
				run: async () => Promise.reject(new Error("db down")),
				first: async () => null,
				all: async () => ({ results: [] }),
			}),
		}),
	};
	const waited: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) };

	assert.doesNotThrow(() => recordEvent(db, ctx, { source: "guardrail", type: "check" }));
	// The queued promise itself must not reject uncaught.
	await assert.doesNotReject(waited[0]);
});
