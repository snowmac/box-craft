// Shared "box" types (D8/D10) — a merchant-defined Pick-N configuration.
// Used by app-backend's boxes API, and will be used by the Cart Transform
// function (T8) to compute a discount from the same JSON.

export type Discount =
	| { type: "none" }
	| { type: "percent"; percent: number }
	| { type: "tiered"; tiers: Array<{ min_items: number; percent: number }> };

// Multi-pool boxes (multi-pool-boxes-plan.md, D1-D4): a box is a list of
// {collection, count} pools, each with its own required exact pick count,
// merged into one bundle at checkout. `collection_handle` is nullable
// (not `string`, despite the plan's own type sketch) so the seeded
// `default` box — created with no collection configured, falling back to
// the picker block's own setting — round-trips through a pool exactly as
// it did as a bare box before this existed; see normalizeBox.
export interface Pool {
	collection_handle: string | null;
	count: number; // 1..20
}

export interface Box {
	handle: string;
	title: string;
	collection_handle: string | null;
	pick_count: number;
	discount: Discount;
	active: boolean;
	pools: Pool[]; // always populated — see normalizeBox
}

// The raw D1 row shape (JSON columns still strings, pools possibly absent
// on a row written before this migration).
export interface BoxRow {
	handle: string;
	title: string;
	collection_handle: string | null;
	pick_count: number;
	discount: string;
	pools: string | null;
	active: number;
}

// D2: the single source of legacy synthesis. Every consumer past this
// point only ever sees `pools` — there is no separate legacy code path.
export function normalizeBox(row: BoxRow): Box {
	const pools: Pool[] = row.pools
		? (JSON.parse(row.pools) as Pool[])
		: [{ collection_handle: row.collection_handle, count: row.pick_count }];
	return {
		handle: row.handle,
		title: row.title,
		collection_handle: row.collection_handle,
		pick_count: row.pick_count,
		discount: JSON.parse(row.discount) as Discount,
		active: row.active !== 0,
		pools,
	};
}

// D4: pick_count is always derived as sum(pool.count) — Cart Transform's
// discount tier math and the events schema keep using pick_count exactly
// as today, needing zero changes.
export function totalPickCount(pools: Pool[]): number {
	return pools.reduce((sum, pool) => sum + pool.count, 0);
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
		pools: [{ collection_handle: null, count: 4 }],
	};
}
