// Pure validation for the boxes/config API (T5). Kept independent of the
// Worker runtime so it's directly unit-testable.
import type { Box, Discount } from "../../../shared/boxes.ts";

const HANDLE_PATTERN = /^[a-z0-9-]{1,40}$/;
const MAX_PERCENT = 90;
const MIN_PICK_COUNT = 1;
const MAX_PICK_COUNT = 20;

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

export function validateBoxInput(input: unknown): ValidationResult {
	if (typeof input !== "object" || input === null) {
		return { valid: false, errors: ["box must be an object"] };
	}
	const b = input as Record<string, unknown>;
	const errors: string[] = [];

	if (!isValidHandle(b.handle)) errors.push("handle must match [a-z0-9-]{1,40}");
	if (typeof b.title !== "string" || b.title.trim().length === 0) errors.push("title is required");
	if (b.collection_handle !== null && b.collection_handle !== undefined && typeof b.collection_handle !== "string") {
		errors.push("collection_handle must be a string or null");
	}
	if (!isValidPickCount(b.pick_count)) errors.push(`pick_count must be an integer ${MIN_PICK_COUNT}-${MAX_PICK_COUNT}`);
	if (!isValidDiscount(b.discount)) errors.push("discount is invalid");

	return { valid: errors.length === 0, errors };
}

export function toBox(input: Record<string, unknown>): Box {
	return {
		handle: input.handle as string,
		title: input.title as string,
		collection_handle: (input.collection_handle as string | null) ?? null,
		pick_count: input.pick_count as number,
		discount: input.discount as Discount,
		active: input.active !== false,
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
