import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBundleSaleSummary, type OrdersPaidPayload } from "../src/orders-paid.ts";

function lineItem(price: string, quantity: number, bundleId?: string) {
	return {
		quantity,
		price,
		properties: bundleId ? [{ name: "_bundle_id", value: bundleId }] : [],
	};
}

test("an order with no bundle line items produces no summary", () => {
	const payload: OrdersPaidPayload = {
		id: 1,
		line_items: [lineItem("19.99", 1), lineItem("29.99", 2)],
	};
	assert.equal(computeBundleSaleSummary(payload), null);
});

test("a single bundle's lines are grouped into one bundle, revenue summed across them", () => {
	const payload: OrdersPaidPayload = {
		id: 42,
		line_items: [
			lineItem("19.99", 1, "bundle-a"),
			lineItem("29.99", 1, "bundle-a"),
		],
	};
	assert.deepEqual(computeBundleSaleSummary(payload), {
		orderId: 42,
		bundleCount: 1,
		revenueCents: 4998,
	});
});

test("two distinct bundle ids in one order count as two bundles", () => {
	const payload: OrdersPaidPayload = {
		id: 7,
		line_items: [
			lineItem("10.00", 1, "bundle-a"),
			lineItem("10.00", 1, "bundle-a"),
			lineItem("20.00", 1, "bundle-b"),
		],
	};
	const summary = computeBundleSaleSummary(payload);
	assert.equal(summary?.bundleCount, 2);
	assert.equal(summary?.revenueCents, 4000);
});

test("non-bundle line items in the same order are excluded from the count and revenue", () => {
	const payload: OrdersPaidPayload = {
		id: 9,
		line_items: [lineItem("10.00", 1, "bundle-a"), lineItem("999.00", 1)],
	};
	assert.deepEqual(computeBundleSaleSummary(payload), {
		orderId: 9,
		bundleCount: 1,
		revenueCents: 1000,
	});
});

test("quantity multiplies the per-unit price for revenue", () => {
	const payload: OrdersPaidPayload = {
		id: 3,
		line_items: [lineItem("15.00", 3, "bundle-a")],
	};
	assert.equal(computeBundleSaleSummary(payload)?.revenueCents, 4500);
});

test("a missing properties array on a line item is treated as no bundle id", () => {
	const payload: OrdersPaidPayload = {
		id: 5,
		line_items: [{ quantity: 1, price: "10.00" }],
	};
	assert.equal(computeBundleSaleSummary(payload), null);
});

test("an unparseable price contributes zero revenue but still counts toward bundleCount", () => {
	const payload: OrdersPaidPayload = {
		id: 6,
		line_items: [lineItem("not-a-number", 1, "bundle-a")],
	};
	assert.deepEqual(computeBundleSaleSummary(payload), {
		orderId: 6,
		bundleCount: 1,
		revenueCents: 0,
	});
});
