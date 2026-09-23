// Core Cart Transform business logic, kept as a pure function independent
// of Shopify's Functions runtime so it's directly unit-testable in plain
// Node (see ../../test/group-bundles.test.ts). cart_transform_run.ts is the thin adapter
// that wires this into the actual Shopify Function entry point.

export interface CartLine {
	id: string;
	quantity: number;
	cost: { totalAmount: { amount: string } };
	bundleId: { value: string } | null;
	bundlePrice: { value: string } | null;
	sellingPlanAllocation: { sellingPlan: { id: string } } | null;
}

export interface CartTransformInput {
	// Set by app-backend when it activates this function on a store
	// (cartTransformCreate), in the app-reserved namespace.
	cartTransform: {
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
		// Omitted when the bundle price is at or above list — see below.
		price?: {
			percentageDecrease: {
				value: string;
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
	const parentVariantId = input.cartTransform.metafield?.value;
	if (!parentVariantId) {
		// No placeholder bundle product configured yet for this store
		// (app-backend's store setup hasn't run) — nothing to merge into. Matches Shopify's own fallback for an erroring function:
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
		// Work in integer cents: summing decimal strings as floats drifts
		// (699.95 + 729.95 + 749.95 + 600 !== 2779.85), which would turn an
		// at-list bundle into a bogus 0% decrease that Shopify rejects.
		const bundleCents = toCents(lines[0]?.bundlePrice?.value);
		// Missing or unparseable price is a storefront bug — skip rather than guess.
		if (bundleCents === null || bundleCents < 0) continue;

		let listCents = 0;
		for (const l of lines) listCents += toCents(l.cost.totalAmount.amount) ?? 0;

		const merge: LinesMergeOperation["linesMerge"] = {
			cartLines: lines.map((l) => ({ cartLineId: l.id, quantity: l.quantity })),
			parentVariantId,
		};
		// linesMerge only accepts a percentageDecrease, not a fixed price, so
		// the bundle price is expressed as a discount off the merged lines'
		// list total. A bundle priced at or above list can't be represented
		// (no negative decrease) and merges at list price instead; so does a
		// discount too small to survive rounding to 4 decimal places.
		if (bundleCents < listCents) {
			const percent = Math.round((1 - bundleCents / listCents) * 100 * 10000) / 10000;
			if (percent > 0) merge.price = { percentageDecrease: { value: String(percent) } };
		}

		operations.push({ linesMerge: merge });
	}

	return { operations };
}

function toCents(amount: string | undefined): number | null {
	const n = Number(amount);
	return amount !== undefined && amount !== "" && Number.isFinite(n) ? Math.round(n * 100) : null;
}
