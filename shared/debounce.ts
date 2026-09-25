// Portability plan D2/T2: the actual contract webhook-consumer's route code
// needs from a debouncer ("collapse a burst of per-key updates into one
// write after a quiet window"), not Cloudflare's Durable Object API shape.
// This is the one genuinely non-portable primitive in the codebase (actor
// model + alarms have no equivalent elsewhere) — the goal isn't to make it
// portable today, it's to make sure only the one adapter file implementing
// this interface would need rewriting on a real migration, not every
// caller.
export interface PendingLocationUpdate {
	locationId: string;
	available: boolean;
}

export interface Debouncer {
	schedule(skuKey: string, update: PendingLocationUpdate): Promise<void>;
}
