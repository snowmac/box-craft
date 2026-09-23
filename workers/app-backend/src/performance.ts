// T12: the admin page's Performance card. computePerformanceMetrics is
// pure (given raw event rows) so the aggregation math is directly
// unit-testable; loadPerformanceMetrics is the thin D1-reading wrapper.
import type { D1Like } from "../../../shared/events.ts";

export type PerformanceWindow = 7 | 30;

export interface PerformanceSeries {
	bundlesAdded: number[];
	bundlesSold: number[];
	guardrailChecks: number[];
}

export interface PerformanceMetrics {
	windowDays: PerformanceWindow;
	bundlesAdded: number;
	bundlesSold: number;
	revenueCents: number;
	// bundlesSold / bundlesAdded, as a percent rounded to 1 decimal. 0 when
	// there were no bundles added (avoids a divide-by-zero NaN).
	conversionPercent: number;
	guardrailChecks: number;
	blockedPercent: number;
	failOpens: number;
	// One entry per day, oldest first — for T12's sparklines (D17).
	series: PerformanceSeries;
}

interface EventRow {
	ts: number;
	source: string;
	type: string;
	data: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function parseData(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function computePerformanceMetrics(
	events: EventRow[],
	windowDays: PerformanceWindow,
	now: number,
): PerformanceMetrics {
	const windowStart = now - windowDays * MS_PER_DAY;
	const dayBuckets = Array.from({ length: windowDays }, () => ({
		bundlesAdded: 0,
		bundlesSold: 0,
		guardrailChecks: 0,
	}));

	let bundlesAdded = 0;
	let bundlesSold = 0;
	let revenueCents = 0;
	let guardrailChecks = 0;
	let blockedChecks = 0;
	let failOpens = 0;

	for (const row of events) {
		if (row.ts < windowStart || row.ts > now) continue;
		// Oldest-first bucket ordering: day 0 is the oldest day in the window.
		const daysAgo = Math.min(windowDays - 1, Math.floor((now - row.ts) / MS_PER_DAY));
		const bucket = dayBuckets[windowDays - 1 - daysAgo];

		if (row.source === "picker" && row.type === "bundle_added") {
			bundlesAdded++;
			bucket.bundlesAdded++;
		} else if (row.source === "webhook" && row.type === "bundle_sold") {
			const data = parseData(row.data);
			const count = typeof data.bundleCount === "number" ? data.bundleCount : 0;
			bundlesSold += count;
			revenueCents += typeof data.revenueCents === "number" ? data.revenueCents : 0;
			bucket.bundlesSold += count;
		} else if (row.source === "guardrail" && row.type === "check") {
			guardrailChecks++;
			bucket.guardrailChecks++;
			if (parseData(row.data).compatible === false) blockedChecks++;
		} else if (row.source === "guardrail" && row.type === "error") {
			failOpens++;
		}
	}

	return {
		windowDays,
		bundlesAdded,
		bundlesSold,
		revenueCents,
		conversionPercent: bundlesAdded > 0 ? round1((bundlesSold / bundlesAdded) * 100) : 0,
		guardrailChecks,
		blockedPercent: guardrailChecks > 0 ? round1((blockedChecks / guardrailChecks) * 100) : 0,
		failOpens,
		series: {
			bundlesAdded: dayBuckets.map((b) => b.bundlesAdded),
			bundlesSold: dayBuckets.map((b) => b.bundlesSold),
			guardrailChecks: dayBuckets.map((b) => b.guardrailChecks),
		},
	};
}

export async function loadPerformanceMetrics(
	db: D1Like,
	shop: string,
	windowDays: PerformanceWindow,
	now: number = Date.now(),
): Promise<PerformanceMetrics> {
	const windowStart = now - windowDays * MS_PER_DAY;
	const { results } = await db
		.prepare("SELECT ts, source, type, data FROM events WHERE shop = ? AND ts >= ? ORDER BY ts ASC")
		.bind(shop, windowStart)
		.all<EventRow>();
	return computePerformanceMetrics(results, windowDays, now);
}
