import {
	buildCartTransformOperations,
	type CartTransformInput,
	type CartTransformResult,
} from "./lib/group-bundles.ts";

// ASSUMPTION: Shopify's JS Functions runtime (the CLI's `--flavor
// javascript` scaffold, via @shopify/shopify_function) expects this file
// to export a `run` function that receives the parsed input JSON (matching
// cart_transform_run.graphql) and returns the operations JSON — the
// runtime package handles stdin/stdout and typegen. This adapter hasn't
// been validated against a real generated scaffold (no Partner-linked app
// in this environment to generate one from) — re-verify shape and export
// name against shopify.dev/docs/api/functions and
// `shopify app function typegen` before first deploy. See
// specs/product/assumptions.md.
export function run(input: CartTransformInput): CartTransformResult {
	return buildCartTransformOperations(input);
}
