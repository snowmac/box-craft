import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBundleAddedEvent } from "../src/bundle-added-event.ts";

const VALID = {
	type: "bundle_added",
	shop: "box-craft-demo.myshopify.com",
	boxHandle: "default",
	itemCount: 4,
	totalPrice: 99.96,
};

test("accepts a well-formed bundle_added payload", () => {
	assert.deepEqual(parseBundleAddedEvent(VALID), {
		shop: "box-craft-demo.myshopify.com",
		boxHandle: "default",
		itemCount: 4,
		totalPrice: 99.96,
	});
});

test("rejects anything that isn't type bundle_added", () => {
	assert.equal(parseBundleAddedEvent({ ...VALID, type: "something_else" }), null);
	assert.equal(parseBundleAddedEvent({}), null);
	assert.equal(parseBundleAddedEvent(null), null);
	assert.equal(parseBundleAddedEvent("bundle_added"), null);
});

test("rejects an invalid shop domain", () => {
	assert.equal(parseBundleAddedEvent({ ...VALID, shop: "not-a-shop.com" }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, shop: 12345 }), null);
});

test("rejects a missing or oversized box handle", () => {
	assert.equal(parseBundleAddedEvent({ ...VALID, boxHandle: "" }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, boxHandle: "x".repeat(41) }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, boxHandle: undefined }), null);
});

test("rejects a non-integer or out-of-range itemCount", () => {
	assert.equal(parseBundleAddedEvent({ ...VALID, itemCount: 0 }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, itemCount: 4.5 }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, itemCount: 51 }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, itemCount: "4" }), null);
});

test("rejects a negative, non-finite, or absurdly large totalPrice", () => {
	assert.equal(parseBundleAddedEvent({ ...VALID, totalPrice: -1 }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, totalPrice: Infinity }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, totalPrice: 2_000_000 }), null);
	assert.equal(parseBundleAddedEvent({ ...VALID, totalPrice: "9.99" }), null);
});

test("rejects a payload with unrelated PII-shaped fields but still ignores them if the rest is valid", () => {
	// The schema only ever reads the fields it knows about — extra keys
	// (even ones that look like PII) never make it into the recorded event.
	const withExtra = { ...VALID, customerEmail: "person@example.com" };
	assert.deepEqual(parseBundleAddedEvent(withExtra), {
		shop: "box-craft-demo.myshopify.com",
		boxHandle: "default",
		itemCount: 4,
		totalPrice: 99.96,
	});
});
