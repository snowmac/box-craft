import {
	buildCartTransformOperations,
	type CartTransformInput,
	type CartTransformResult,
} from "./lib/group-bundles.ts";

// Thin adapter for Shopify's JS Functions runtime. Shape follows the
// official functions-cart-transform-js template (Shopify/extensions-templates):
// src/index.ts re-exports `cartTransformRun`, which the toml targets as
// export "cart-transform-run"; the CLI compiles it to dist/function.wasm.
// Uses our hand-written input/output types rather than ../generated/api
// so the pure logic stays testable without running typegen.
export function cartTransformRun(input: CartTransformInput): CartTransformResult {
	return buildCartTransformOperations(input);
}
