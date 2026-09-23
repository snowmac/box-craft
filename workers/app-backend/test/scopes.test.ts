import { test } from "node:test";
import assert from "node:assert/strict";
import { scopesCover } from "../src/scopes.ts";

test("exact match covers", () => {
	assert.equal(scopesCover("read_inventory,write_products", "read_inventory,write_products"), true);
});

test("order and whitespace don't matter", () => {
	assert.equal(scopesCover("write_products, read_inventory", "read_inventory,write_products"), true);
});

test("a write scope implies its read scope", () => {
	assert.equal(scopesCover("write_products", "read_products"), true);
});

test("a read scope does not imply write", () => {
	assert.equal(scopesCover("read_products", "write_products"), false);
});

test("a missing scope is not covered (e.g. token from before a scope was added)", () => {
	assert.equal(
		scopesCover("read_inventory,read_locations,read_products", "read_inventory,read_locations,write_products,write_cart_transforms"),
		false,
	);
});

test("empty granted covers nothing", () => {
	assert.equal(scopesCover("", "read_products"), false);
});
