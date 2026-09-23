import { test } from "node:test";
import assert from "node:assert/strict";
import { computePerformanceMetrics, loadPerformanceMetrics } from "../src/performance.ts";
import type { D1Like } from "../../../shared/events.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 10 * DAY; // an arbitrary "now" comfortably past a 7-day window

function event(source: string, type: string, ts: number, data: Record<string, unknown> = {}) {
	return { ts, source, type, data: JSON.stringify(data) };
}

test("an empty event list yields all-zero metrics", () => {
	const metrics = computePerformanceMetrics([], 7, NOW);
	assert.equal(metrics.bundlesAdded, 0);
	assert.equal(metrics.bundlesSold, 0);
	assert.equal(metrics.revenueCents, 0);
	assert.equal(metrics.conversionPercent, 0);
	assert.equal(metrics.guardrailChecks, 0);
	assert.equal(metrics.blockedPercent, 0);
	assert.equal(metrics.failOpens, 0);
	assert.deepEqual(metrics.series.bundlesAdded, [0, 0, 0, 0, 0, 0, 0]);
});

test("counts bundle_added, bundle_sold, and guardrail events by kind", () => {
	const events = [
		event("picker", "bundle_added", NOW),
		event("picker", "bundle_added", NOW - DAY),
		event("webhook", "bundle_sold", NOW, { bundleCount: 2, revenueCents: 4998 }),
		event("guardrail", "check", NOW, { compatible: true }),
		event("guardrail", "check", NOW, { compatible: false }),
		event("guardrail", "error", NOW),
	];
	const metrics = computePerformanceMetrics(events, 7, NOW);

	assert.equal(metrics.bundlesAdded, 2);
	assert.equal(metrics.bundlesSold, 2);
	assert.equal(metrics.revenueCents, 4998);
	assert.equal(metrics.guardrailChecks, 2);
	assert.equal(metrics.blockedPercent, 50);
	assert.equal(metrics.failOpens, 1);
});

test("conversionPercent is bundlesSold / bundlesAdded as a percent, 0 with no adds", () => {
	const events = [
		event("picker", "bundle_added", NOW),
		event("picker", "bundle_added", NOW),
		event("webhook", "bundle_sold", NOW, { bundleCount: 1, revenueCents: 1000 }),
	];
	assert.equal(computePerformanceMetrics(events, 7, NOW).conversionPercent, 50);
	assert.equal(computePerformanceMetrics([], 7, NOW).conversionPercent, 0);
});

test("events outside the window are excluded", () => {
	const events = [
		event("picker", "bundle_added", NOW - 8 * DAY), // just outside a 7-day window
		event("picker", "bundle_added", NOW - 6 * DAY), // inside
	];
	const metrics = computePerformanceMetrics(events, 7, NOW);
	assert.equal(metrics.bundlesAdded, 1);
});

test("events bucket into the correct day, oldest first, for the sparkline series", () => {
	const events = [
		event("picker", "bundle_added", NOW), // today -> last bucket
		event("picker", "bundle_added", NOW - 6 * DAY), // 6 days ago -> first bucket
	];
	const metrics = computePerformanceMetrics(events, 7, NOW);
	assert.equal(metrics.series.bundlesAdded[0], 1); // oldest day
	assert.equal(metrics.series.bundlesAdded[6], 1); // today
	assert.equal(metrics.series.bundlesAdded.reduce((a, b) => a + b, 0), 2);
});

test("a malformed data JSON string is treated as an empty object rather than throwing", () => {
	const events = [{ ts: NOW, source: "webhook", type: "bundle_sold", data: "not json" }];
	const metrics = computePerformanceMetrics(events, 7, NOW);
	assert.equal(metrics.bundlesSold, 0);
	assert.equal(metrics.revenueCents, 0);
});

test("a 30-day window produces a 30-entry series", () => {
	const metrics = computePerformanceMetrics([], 30, NOW);
	assert.equal(metrics.series.bundlesAdded.length, 30);
});

test("loadPerformanceMetrics queries events scoped to the shop and window, then aggregates", async () => {
	const seen: { shop: string; windowStart: number }[] = [];
	const db: D1Like = {
		prepare: (query: string) => ({
			bind: (...args: unknown[]) => ({
				run: async () => {},
				first: async () => null,
				all: async <T>() => {
					if (query.includes("FROM events")) {
						const [shop, windowStart] = args as [string, number];
						seen.push({ shop, windowStart });
						return {
							results: [event("picker", "bundle_added", NOW)] as unknown as T[],
						};
					}
					return { results: [] as T[] };
				},
			}),
		}),
	};

	const metrics = await loadPerformanceMetrics(db, "box-craft-demo.myshopify.com", 7, NOW);

	assert.equal(metrics.bundlesAdded, 1);
	assert.equal(seen[0].shop, "box-craft-demo.myshopify.com");
	assert.equal(seen[0].windowStart, NOW - 7 * DAY);
});
