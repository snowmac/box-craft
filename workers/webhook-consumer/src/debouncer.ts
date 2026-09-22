import {
	applyLocationUpdates,
	bitmapKey,
	type BitmapEntry,
} from "../../../shared/bitmap.ts";

// How long to wait after the last event for a SKU before writing the
// bitmap. Resolves the webhook-volume open item from the plan: a burst of
// N events for one SKU within this window collapses to exactly one KV
// write, because each event just resets the alarm rather than writing
// immediately. Chosen as a reasonable default, not yet validated against
// real merchant webhook volume — see specs/product/assumptions.md.
const DEBOUNCE_WINDOW_MS = 3000;

interface PendingUpdate {
	skuKey: string;
	locationId: string;
	available: boolean;
}

export interface DebouncerEnv {
	LOCATION_BITMAP: KVNamespace;
}

export class SkuDebouncer implements DurableObject {
	constructor(
		private readonly state: DurableObjectState,
		private readonly env: DebouncerEnv,
	) {}

	async fetch(request: Request): Promise<Response> {
		const update = (await request.json()) as PendingUpdate;

		await this.state.storage.put<string>("skuKey", update.skuKey);
		const pending =
			(await this.state.storage.get<Record<string, boolean>>("pending")) ??
			{};
		pending[update.locationId] = update.available;
		await this.state.storage.put("pending", pending);

		if ((await this.state.storage.getAlarm()) === null) {
			await this.state.storage.setAlarm(Date.now() + DEBOUNCE_WINDOW_MS);
		}

		return new Response("queued", { status: 202 });
	}

	async alarm(): Promise<void> {
		const skuKey = await this.state.storage.get<string>("skuKey");
		const pending =
			(await this.state.storage.get<Record<string, boolean>>("pending")) ??
			{};
		await this.state.storage.delete("pending");

		if (!skuKey || Object.keys(pending).length === 0) {
			return;
		}

		const key = bitmapKey(skuKey);
		const raw = await this.env.LOCATION_BITMAP.get(key);
		const existing: BitmapEntry = raw
			? (JSON.parse(raw) as BitmapEntry)
			: { locations: [], updatedAt: "" };

		const entry: BitmapEntry = {
			locations: applyLocationUpdates(existing.locations, pending),
			updatedAt: new Date().toISOString(),
		};

		await this.env.LOCATION_BITMAP.put(key, JSON.stringify(entry));
	}
}
