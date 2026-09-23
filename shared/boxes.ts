// Shared "box" types (D8/D10) — a merchant-defined Pick-N configuration.
// Used by app-backend's boxes API, and will be used by the Cart Transform
// function (T8) to compute a discount from the same JSON.

export type Discount =
	| { type: "none" }
	| { type: "percent"; percent: number }
	| { type: "tiered"; tiers: Array<{ min_items: number; percent: number }> };

export interface Box {
	handle: string;
	title: string;
	collection_handle: string | null;
	pick_count: number;
	discount: Discount;
	active: boolean;
}

export const DEFAULT_BOX_HANDLE = "default";

export function defaultBox(): Box {
	return {
		handle: DEFAULT_BOX_HANDLE,
		title: "Build your box",
		collection_handle: null,
		pick_count: 4,
		discount: { type: "none" },
		active: true,
	};
}
