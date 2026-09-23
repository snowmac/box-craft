import { test } from "node:test";
import assert from "node:assert/strict";
import {
	renderOverviewBody,
	renderStoreDetailBody,
	renderEventsBody,
	renderErrorsBody,
	renderKvInspectorBody,
	renderGuardrailTesterBody,
} from "../src/views.ts";

test("renderOverviewBody lists each shop with a link to its detail page", () => {
	const body = renderOverviewBody(
		[
			{
				shop: "box-craft-demo.myshopify.com",
				installedAt: "2026-01-01T00:00:00.000Z",
				setupAt: "2026-01-01T00:01:00.000Z",
				scope: "read_inventory,read_locations",
				config: { guardrailEnabled: true, unknownStockPolicy: "allow" },
				lastSync: { startedAt: 1000, finishedAt: 2000, variants: 26, status: "ok" },
				last24h: { guardrailChecks: 10, blockedPercent: 5, errors: 0 },
			},
		],
		{ guardrail: true, webhookConsumer: true, appBackend: false },
	);
	assert.match(body, /href="\/stores\/box-craft-demo\.myshopify\.com"/);
	assert.match(body, /badge--error/); // appBackend down
	assert.match(body, /26/); // variants in lastSync summary
});

test("renderOverviewBody handles zero shops without throwing", () => {
	const body = renderOverviewBody([], { guardrail: true, webhookConsumer: true, appBackend: true });
	assert.match(body, /No shops installed/);
});

test("renderOverviewBody never lets a shop domain break out of the table cell", () => {
	const body = renderOverviewBody(
		[
			{
				shop: '<script>alert(1)</script>.myshopify.com',
				installedAt: "x",
				setupAt: null,
				scope: "x",
				config: { guardrailEnabled: true, unknownStockPolicy: "allow" },
				lastSync: null,
				last24h: { guardrailChecks: 0, blockedPercent: 0, errors: 0 },
			},
		],
		{ guardrail: true, webhookConsumer: true, appBackend: true },
	);
	assert.doesNotMatch(body, /<script>alert/);
});

test("renderStoreDetailBody includes the three action forms and never shows a raw token", () => {
	const body = renderStoreDetailBody({
		shop: "box-craft-demo.myshopify.com",
		scope: "read_inventory",
		config: { guardrailEnabled: true, unknownStockPolicy: "allow" },
		boxes: [{ handle: "default", title: "Build your box", collection_handle: null, pick_count: 4, discount: { type: "none" }, active: true }],
		events: [{ id: 1, ts: 1000, shop: "box-craft-demo.myshopify.com", source: "guardrail", type: "check", level: "info", data: null }],
		syncHistory: [{ id: 1, trigger: "manual", started_at: 1000, finished_at: 2000, variants: 26, status: "ok", error: null }],
		bundleProductPublished: true,
		cartTransformActive: true,
	});
	assert.match(body, /action="\/actions\/rerun-setup"/);
	assert.match(body, /action="\/actions\/run-sync"/);
	assert.match(body, /action="\/actions\/force-reexchange"/);
	assert.doesNotMatch(body, /shpat_/);
	assert.match(body, /default/);
});

test("renderEventsBody shows filtered rows and pagination links", () => {
	const body = renderEventsBody(
		{ shop: "box-craft-demo.myshopify.com" },
		[{ id: 1, ts: 1000, shop: "box-craft-demo.myshopify.com", source: "guardrail", type: "check", level: "info", data: '{"n":2}' }],
		true,
		0,
		"shop=box-craft-demo.myshopify.com",
	);
	assert.match(body, /Next/);
	assert.doesNotMatch(body, /Prev/); // page 0 has no previous page
	assert.match(body, /<details>/);
});

test("renderEventsBody shows a message when there are no matching events", () => {
	const body = renderEventsBody({}, [], false, 0, "");
	assert.match(body, /No matching events/);
});

test("renderErrorsBody lists grouped errors with counts and a prune action", () => {
	const body = renderErrorsBody([{ where: "check", message: "bitmap read failed", count: 3, firstSeen: 100, lastSeen: 300 }], 7);
	assert.match(body, /bitmap read failed/);
	assert.match(body, />3</);
	assert.match(body, /action="\/actions\/prune-events"/);
});

test("renderErrorsBody handles an empty group list", () => {
	const body = renderErrorsBody([], 1);
	assert.match(body, /No errors/);
});

test("renderKvInspectorBody shows a bitmap entry result when found", () => {
	const body = renderKvInspectorBody({ variantId: "123", variantResult: { locations: ["gid://shopify/Location/1"], updatedAt: "x" } });
	assert.match(body, /gid:\/\/shopify\/Location\/1/);
});

test("renderKvInspectorBody shows a not-found message when the variant has no entry", () => {
	const body = renderKvInspectorBody({ variantId: "999", variantResult: null });
	assert.match(body, /No bitmap entry/);
});

test("renderKvInspectorBody shows only the form when no lookup has been submitted yet", () => {
	const body = renderKvInspectorBody({});
	assert.doesNotMatch(body, /No bitmap entry/);
	assert.doesNotMatch(body, /No mapping/);
});

test("renderGuardrailTesterBody shows the check response and missing-bitmap variants", () => {
	const body = renderGuardrailTesterBody({
		shop: "box-craft-demo.myshopify.com",
		variantIdsRaw: "1,2",
		result: { checkResponse: { compatible: true, locations: [] }, missingBitmapVariantIds: ["2"] },
	});
	assert.match(body, /compatible.*true/);
	assert.match(body, /<code>2<\/code>/);
});

test("renderGuardrailTesterBody shows just the form before any test has run", () => {
	const body = renderGuardrailTesterBody({});
	assert.doesNotMatch(body, /Result/);
});
