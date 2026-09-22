export interface VariantLocations {
	variantId: string;
	locations: string[];
}

export type CompatibilityResult =
	| { compatible: true; locations: string[] }
	| { compatible: false; conflictingVariants: string[] };

export function checkCompatibility(
	selections: VariantLocations[],
): CompatibilityResult {
	if (selections.length === 0) {
		return { compatible: true, locations: [] };
	}

	const sets = selections.map((s) => new Set(s.locations));
	const intersectAll = intersectAllSets(sets);

	if (intersectAll.size > 0) {
		return { compatible: true, locations: [...intersectAll].sort() };
	}

	// Identify which variant(s) are the "odd one out": removing them from the
	// selection would make the rest compatible. If no single removal fixes
	// it, every variant is contributing to the conflict.
	const conflicting: string[] = [];
	for (let i = 0; i < selections.length; i++) {
		const others = sets.filter((_, idx) => idx !== i);
		const otherIntersection = intersectAllSets(others);
		if (otherIntersection.size > 0) {
			conflicting.push(selections[i].variantId);
		}
	}

	if (conflicting.length === 0) {
		conflicting.push(...selections.map((s) => s.variantId));
	}

	return { compatible: false, conflictingVariants: conflicting };
}

function intersectAllSets(sets: Set<string>[]): Set<string> {
	if (sets.length === 0) return new Set();
	return sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
}
