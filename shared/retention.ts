import type { D1Like } from "./events.ts";

// D3: keep 90 days of events, pruned by a daily Cron Trigger.
export const EVENT_RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function eventRetentionCutoff(
	now: number,
	retentionDays: number = EVENT_RETENTION_DAYS,
): number {
	return now - retentionDays * MS_PER_DAY;
}

// Shared between the daily cron (app-backend's scheduled handler) and the
// ops console's "prune events now" action (T14), so both call one place.
export async function pruneOldEvents(db: D1Like, now: number = Date.now()): Promise<void> {
	const cutoff = eventRetentionCutoff(now);
	await db.prepare("DELETE FROM events WHERE ts < ?").bind(cutoff).run();
}
