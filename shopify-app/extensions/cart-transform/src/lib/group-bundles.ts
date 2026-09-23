// Core Cart Transform business logic, kept as a pure function independent
// of Shopify's Functions runtime so it's directly unit-testable in plain
// Node (see ../../test/group-bundles.test.ts). cart_transform_run.ts is the thin adapter
// that wires this into the actual Shopify Function entry point.

export interface CartLine {
	id: string;
	quantity: number;
	bundleId: { value: string } | null;
	// T7/D11: the box handle the picker selected from, not a price. The
	// function computes its own price from the box's own discount rule
	// below — see BundleBox / discountPercent.
	bundleBox: { value: string } | null;
	sellingPlanAllocation: { sellingPlan: { id: string } } | null;
}

// Mirrors the subset of shared/boxes.ts's Box/Discount that this function
// actually reads. Kept local (not imported from shared/) so this Function's
// bundle stays self-contained rather than reaching outside the extension.
export interface BundleBox {
	handle: string;
	discount:
		| { type: "none" }
		| { type: "percent"; percent: number }
		| { type: "tiered"; tiers: Array<{ min_items: number; percent: number }> };
}

export interface CartTransformInput {
	cartTransform: {
		// Set by app-backend when it activates this function on a store
		// (cartTransformCreate), in the app-reserved namespace.
		metafield: { value: string } | null;
		// D11: the same boxes list the merchant admin/picker use (T5/T7),
		// mirrored onto the cart transform itself so this function never has
		// to trust anything the storefront/cart says about pricing.
		boxes: { value: string } | null;
	};
	cart: {
		lines: CartLine[];
	};
}

export interface LinesMergeOperation {
	linesMerge: {
		cartLines: Array<{ cartLineId: string; quantity: number }>;
		parentVariantId: string;
		// Omitted when the box has no discount (unknown box, "none", or a
		// tiered box whose smallest tier isn't met yet).
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

// D10: an unknown box (deleted, or the picker sent a stale handle) or a
// "none" discount both mean no price adjustment. For "tiered", the highest
// tier whose min_items the itemCount satisfies wins — tiers are validated
// strictly ascending by validate.ts, so the last matching one in order is
// always the highest.
export function discountPercent(box: BundleBox | undefined, itemCount: number): number {
	if (!box) return 0;
	if (box.discount.type === "percent") return box.discount.percent;
	if (box.discount.type === "tiered") {
		let best = 0;
		for (const tier of box.discount.tiers) {
			if (itemCount >= tier.min_items) best = tier.percent;
		}
		return best;
	}
	return 0; // "none"
}

function parseBoxes(raw: string | null | undefined): BundleBox[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as BundleBox[]) : [];
	} catch {
		return [];
	}
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

	const boxes = parseBoxes(input.cartTransform.boxes?.value);

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
		// The picker writes the same _bundle_box value on every line of a
		// given bundle, so any one line's is representative of the group.
		const boxHandle = lines[0]?.bundleBox?.value;
		const box = boxHandle ? boxes.find((b) => b.handle === boxHandle) : undefined;
		const percent = discountPercent(box, lines.length);

		const merge: LinesMergeOperation["linesMerge"] = {
			cartLines: lines.map((l) => ({ cartLineId: l.id, quantity: l.quantity })),
			parentVariantId,
		};
		// linesMerge only accepts a percentageDecrease, not a fixed price, so
		// the box's discount is expressed as a discount off the merged
		// lines' list total.
		if (percent > 0) {
			merge.price = { percentageDecrease: { value: String(percent) } };
		}

		operations.push({ linesMerge: merge });
	}

	return { operations };
}
