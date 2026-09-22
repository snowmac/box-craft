// Core Cart Transform business logic, kept as a pure function independent
// of Shopify's Functions runtime so it's directly unit-testable in plain
// Node (see ../../test/group-bundles.test.ts). run.ts is the thin adapter
// that wires this into the actual Shopify Function entry point.

export interface CartLine {
	id: string;
	quantity: number;
	bundleId: { value: string } | null;
	bundlePrice: { value: string } | null;
	sellingPlanAllocation: { sellingPlan: { id: string } } | null;
}

export interface CartTransformInput {
	shop: {
		metafield: { value: string } | null;
	};
	cart: {
		lines: CartLine[];
	};
}

export interface LinesMergeOperation {
	linesMerge: {
		cartLines: Array<{ cartLineId: string; quantity: number }>;
		parentVariantId: string;
		price: {
			fixedPricePerUnit: {
				amount: string;
			};
		};
	};
}

export interface CartTransformResult {
	operations: LinesMergeOperation[];
}

export function buildCartTransformOperations(
	input: CartTransformInput,
): CartTransformResult {
	const parentVariantId = input.shop.metafield?.value;
	if (!parentVariantId) {
		// No placeholder bundle product configured yet for this store (see
		// "Configure placeholder bundle product" task) — nothing to merge
		// into. Matches Shopify's own fallback for an erroring function:
		// unmerged lines, not a broken cart.
		return { operations: [] };
	}

	const groups = new Map<string, CartLine[]>();
	for (const line of input.cart.lines) {
		if (line.sellingPlanAllocation) {
			// Cart Transform rejects the whole operation set if any targeted
			// line has a selling plan. Skip explicitly rather than relying on
			// that rejection — see the plan's subscriptions constraint.
			continue;
		}

		const bundleId = line.bundleId?.value;
		if (!bundleId) continue; // not part of any bundle, pass through untouched

		const group = groups.get(bundleId) ?? [];
		group.push(line);
		groups.set(bundleId, group);
	}

	const operations: LinesMergeOperation[] = [];
	for (const lines of groups.values()) {
		const bundlePrice = lines[0]?.bundlePrice?.value;
		if (!bundlePrice) continue; // malformed bundle (storefront bug) — skip rather than guess a price

		operations.push({
			linesMerge: {
				cartLines: lines.map((l) => ({ cartLineId: l.id, quantity: l.quantity })),
				parentVariantId,
				price: {
					fixedPricePerUnit: { amount: bundlePrice },
				},
			},
		});
	}

	return { operations };
}
