// Pure validation for the boxes/config API (T5). Kept independent of the
// Worker runtime so it's directly unit-testable.
import type { Box, Discount, Pool } from "../../../shared/boxes.ts";
import { totalPickCount } from "../../../shared/boxes.ts";

const HANDLE_PATTERN = /^[a-z0-9-]{1,40}$/;
const MAX_PERCENT = 90;
const MIN_PICK_COUNT = 1;
const MAX_PICK_COUNT = 20;
const MAX_POOLS = 5;
const MAX_TOTAL_PICK_COUNT = 20;

export function isValidHandle(handle: unknown): handle is string {
	return typeof handle === "string" && HANDLE_PATTERN.test(handle);
}

export function isValidPickCount(pickCount: unknown): pickCount is number {
	return (
		typeof pickCount === "number" &&
		Number.isInteger(pickCount) &&
		pickCount >= MIN_PICK_COUNT &&
		pickCount <= MAX_PICK_COUNT
	);
}

// Multi-pool boxes D3: 1-5 pools per box, 1-20 items per pool, total
// (sum of pool counts) <= 20 — same ceiling as the single-pool pick_count
// had, keeping the picker UI and Cart Transform math within already-
// tested ranges.
export function validatePools(pools: unknown): ValidationResult {
	if (!Array.isArray(pools) || pools.length === 0) {
		return { valid: false, errors: ["pools must be a non-empty array"] };
	}
	if (pools.length > MAX_POOLS) {
		return { valid: false, errors: [`pools must have at most ${MAX_POOLS} entries`] };
	}

	const errors: string[] = [];
	let total = 0;
	pools.forEach((pool: unknown, i: number) => {
		if (typeof pool !== "object" || pool === null) {
			errors.push(`pools[${i}] must be an object`);
			return;
		}
		const p = pool as Record<string, unknown>;
		if (typeof p.collection_handle !== "string" || p.collection_handle.trim().length === 0) {
			errors.push(`pools[${i}].collection_handle must be a non-empty string`);
		}
		if (isValidPickCount(p.count)) {
			total += p.count;
		} else {
			errors.push(`pools[${i}].count must be an integer ${MIN_PICK_COUNT}-${MAX_PICK_COUNT}`);
		}
	});
	if (total > MAX_TOTAL_PICK_COUNT) {
		errors.push(`pools' total count must be at most ${MAX_TOTAL_PICK_COUNT}`);
	}

	return { valid: errors.length === 0, errors };
}

function isValidPercent(percent: unknown): percent is number {
	return typeof percent === "number" && percent >= 0 && percent <= MAX_PERCENT;
}

export function isValidDiscount(discount: unknown): discount is Discount {
	if (typeof discount !== "object" || discount === null) return false;
	const d = discount as Record<string, unknown>;

	if (d.type === "none") return true;

	if (d.type === "percent") return isValidPercent(d.percent);

	if (d.type === "tiered") {
		if (!Array.isArray(d.tiers) || d.tiers.length === 0) return false;
		let previousMinItems = 0;
		for (const tier of d.tiers) {
			if (typeof tier !== "object" || tier === null) return false;
			const t = tier as Record<string, unknown>;
			if (typeof t.min_items !== "number" || !Number.isInteger(t.min_items) || t.min_items < 1) {
				return false;
			}
			if (!isValidPercent(t.percent)) return false;
			// Strictly ascending: each tier's threshold must exceed the last,
			// so "highest matching tier wins" (D10) has one unambiguous answer.
			if (t.min_items <= previousMinItems) return false;
			previousMinItems = t.min_items;
		}
		return true;
	}

	return false;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

// Multi-pool boxes D8: the admin UI now always sends `pools` (a repeatable
// pool editor, not a single collection-handle/pick-count pair), so those
// two fields become derived (D4/D5 — see toBox), not merchant-supplied.
export function validateBoxInput(input: unknown): ValidationResult {
	if (typeof input !== "object" || input === null) {
		return { valid: false, errors: ["box must be an object"] };
	}
	const b = input as Record<string, unknown>;
	const errors: string[] = [];

	if (!isValidHandle(b.handle)) errors.push("handle must match [a-z0-9-]{1,40}");
	if (typeof b.title !== "string" || b.title.trim().length === 0) errors.push("title is required");
	errors.push(...validatePools(b.pools).errors);
	if (!isValidDiscount(b.discount)) errors.push("discount is invalid");

	return { valid: errors.length === 0, errors };
}

// D4/D5: pick_count/collection_handle are always derived from pools —
// sum(pool.count) and the first pool's collection — so Cart Transform's
// discount tier math and every other pools-unaware reader keep working
// unmodified. Only called after validateBoxInput has confirmed `pools`
// is a valid, non-empty array.
export function toBox(input: Record<string, unknown>): Box {
	const pools = input.pools as Pool[];
	return {
		handle: input.handle as string,
		title: input.title as string,
		collection_handle: pools[0].collection_handle,
		pick_count: totalPickCount(pools),
		discount: input.discount as Discount,
		active: input.active !== false,
		pools,
	};
}

const UNKNOWN_STOCK_POLICIES = new Set(["allow", "block"]);

export function isValidUnknownStockPolicy(value: unknown): value is "allow" | "block" {
	return typeof value === "string" && UNKNOWN_STOCK_POLICIES.has(value);
}

export interface ConfigInput {
	guardrail_enabled?: boolean;
	unknown_stock_policy?: "allow" | "block";
}

export function validateConfigInput(input: unknown): ValidationResult {
	if (typeof input !== "object" || input === null) {
		return { valid: false, errors: ["config must be an object"] };
	}
	const c = input as Record<string, unknown>;
	const errors: string[] = [];

	if (c.guardrail_enabled !== undefined && typeof c.guardrail_enabled !== "boolean") {
		errors.push("guardrail_enabled must be a boolean");
	}
	if (c.unknown_stock_policy !== undefined && !isValidUnknownStockPolicy(c.unknown_stock_policy)) {
		errors.push('unknown_stock_policy must be "allow" or "block"');
	}

	return { valid: errors.length === 0, errors };
}
