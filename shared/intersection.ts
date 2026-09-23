export interface VariantLocations {
	variantId: string;
	locations: string[];
	// false = no bitmap entry at all (as opposed to a real entry with zero
	// locations). Defaults to true when omitted. Only matters under the
	// "allow" unknown-stock policy — see checkCompatibility.
	known?: boolean;
}

export type UnknownStockPolicy = "allow" | "block";

export type CompatibilityResult =
	| { compatible: true; locations: string[] }
	| { compatible: false; conflictingVariants: string[] };

// D6: under "allow" (the default per-shop config), a variant with no bitmap
// entry is left out of the intersection entirely rather than treated as
// available nowhere — a newly created product shouldn't block bundles just
// because backfill hasn't run for it yet. Under "block", it's kept in
// (today's original behavior: an empty locations list can never intersect
// with anything, so it always blocks).
export function checkCompatibility(
	selections: VariantLocations[],
	policy: UnknownStockPolicy = "block",
): CompatibilityResult {
	const considered = policy === "allow" ? selections.filter((s) => s.known !== false) : selections;

	if (considered.length === 0) {
		return { compatible: true, locations: [] };
	}

	const sets = considered.map((s) => new Set(s.locations));
	const intersectAll = intersectAllSets(sets);

	if (intersectAll.size > 0) {
		return { compatible: true, locations: [...intersectAll].sort() };
	}

	// Identify which variant(s) are the "odd one out": removing them from the
	// selection would make the rest compatible. If no single removal fixes
	// it, every variant is contributing to the conflict.
	const conflicting: string[] = [];
	for (let i = 0; i < considered.length; i++) {
		const others = sets.filter((_, idx) => idx !== i);
		const otherIntersection = intersectAllSets(others);
		if (otherIntersection.size > 0) {
			conflicting.push(considered[i].variantId);
		}
	}

	if (conflicting.length === 0) {
		conflicting.push(...considered.map((s) => s.variantId));
	}

	return { compatible: false, conflictingVariants: conflicting };
}

function intersectAllSets(sets: Set<string>[]): Set<string> {
	if (sets.length === 0) return new Set();
	return sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
}
