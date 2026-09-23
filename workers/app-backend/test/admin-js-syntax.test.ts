import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ADMIN_JS } from "../src/admin/admin.js.ts";

// ADMIN_JS is an opaque string to TypeScript (see admin.js.ts's own
// comment for why) — tsc never parses its contents, so a syntax error
// inside it would otherwise only surface by loading the real page in a
// browser. This at least catches a broken template literal or unbalanced
// brace before it ships.
test("ADMIN_JS is syntactically valid JavaScript", () => {
	assert.doesNotThrow(() => new vm.Script(ADMIN_JS));
});

// Mirrors pick-n-picker.js's own convention: top-level code must be
// guarded so the module can be loaded (not just parsed) outside a browser
// without throwing — this file gets imported directly by Node here.
test("ADMIN_JS runs without throwing when document/window are undefined", () => {
	const context = vm.createContext({ console });
	assert.doesNotThrow(() => new vm.Script(ADMIN_JS).runInContext(context));
});
