import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { CONSOLE_JS } from "../src/console.js.ts";

// Mirrors app-backend's admin-js-syntax.test.ts: CONSOLE_JS is an opaque
// string to TypeScript, so nothing else catches a broken template literal
// or unbalanced brace before it ships.
test("CONSOLE_JS is syntactically valid JavaScript", () => {
	assert.doesNotThrow(() => new vm.Script(CONSOLE_JS));
});

test("CONSOLE_JS runs without throwing when document/window are undefined", () => {
	const context = vm.createContext({ console });
	assert.doesNotThrow(() => new vm.Script(CONSOLE_JS).runInContext(context));
});
