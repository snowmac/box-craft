// T9/D12: inventory sync, moved into the Worker. Writes the location
// bitmap directly via a real LOCATION_BITMAP KV binding (no Cloudflare
// REST token needed here, unlike scripts/backfill.ts). Records a
// sync_runs row per attempt and a "sync" event, both best-effort — a D1
// outage must never stop the sync itself from running.
import { runBackfill, type BackfillKvEntry, type FetchLike } from "../../../shared/backfill.ts";
import { recordEvent, type D1Like, type EventContext } from "../../../shared/events.ts";
import { ADMIN_API_VERSION } from "./admin-client.ts";

export type SyncTrigger = "setup" | "manual" | "cron";

export interface SyncResult {
	status: "ok" | "error" | "skipped";
	variants?: number;
	error?: string;
}

// D12: skip a new run if one is already in flight for this shop — a stuck
// or slow run shouldn't stack concurrent syncs. 10 minutes comfortably
// covers a real sync (26 variants took well under a minute) while still
// self-healing if a run genuinely died without recording its own outcome.
const CONCURRENT_RUN_WINDOW_MS = 10 * 60 * 1000;
const KV_WRITE_BATCH_SIZE = 20;

async function hasRecentRunningSync(db: D1Like, shop: string, now: number): Promise<boolean> {
	const cutoff = now - CONCURRENT_RUN_WINDOW_MS;
	const row = await db
		.prepare("SELECT id FROM sync_runs WHERE shop = ? AND status = 'running' AND started_at > ? LIMIT 1")
		.bind(shop, cutoff)
		.first();
	return row !== null;
}

async function startSyncRun(db: D1Like, shop: string, trigger: SyncTrigger, startedAt: number): Promise<void> {
	await db
		.prepare("INSERT INTO sync_runs (shop, trigger, started_at, status) VALUES (?, ?, ?, 'running')")
		.bind(shop, trigger, startedAt)
		.run();
}

// Identifies the row to close out by (shop, started_at) rather than an
// autoincrement id — our minimal D1Like type doesn't expose
// run().meta.last_row_id, and (shop, started_at) is unique enough in
// practice for this diagnostic data.
async function finishSyncRun(
	db: D1Like,
	shop: string,
	startedAt: number,
	finishedAt: number,
	outcome: { status: "ok"; variants: number } | { status: "error"; error: string },
): Promise<void> {
	if (outcome.status === "ok") {
		await db
			.prepare(
				"UPDATE sync_runs SET finished_at = ?, variants = ?, status = 'ok' WHERE shop = ? AND started_at = ? AND status = 'running'",
			)
			.bind(finishedAt, outcome.variants, shop, startedAt)
			.run();
	} else {
		await db
			.prepare(
				"UPDATE sync_runs SET finished_at = ?, status = 'error', error = ? WHERE shop = ? AND started_at = ? AND status = 'running'",
			)
			.bind(finishedAt, outcome.error, shop, startedAt)
			.run();
	}
}

async function writeBitmapEntries(kv: KVNamespace, entries: BackfillKvEntry[]): Promise<void> {
	for (let i = 0; i < entries.length; i += KV_WRITE_BATCH_SIZE) {
		const batch = entries.slice(i, i + KV_WRITE_BATCH_SIZE);
		await Promise.all(batch.map((e) => kv.put(e.key, e.value)));
	}
}

export interface SyncEnv {
	DB: D1Like;
	LOCATION_BITMAP: KVNamespace;
}

export async function runSync(
	env: SyncEnv,
	ctx: EventContext,
	shop: string,
	accessToken: string,
	trigger: SyncTrigger,
	// Injectable for deterministic tests (the 10-minute concurrent-run
	// window, batching over real fetch); default to the real clock/fetch.
	now: () => number = Date.now,
	fetchImpl: FetchLike = fetch,
): Promise<SyncResult> {
	const startedAt = now();

	try {
		if (await hasRecentRunningSync(env.DB, shop, startedAt)) {
			return { status: "skipped" };
		}
	} catch {
		// D1 outage on the guard check: fail open rather than block a sync
		// over an unrelated read failure.
	}

	try {
		await startSyncRun(env.DB, shop, trigger, startedAt);
	} catch {
		// Couldn't record the run starting (e.g. DB not yet provisioned) —
		// still attempt the sync itself, since the KV write doesn't depend
		// on D1 at all.
	}

	try {
		const { entries, variantCount } = await runBackfill({
			shop,
			accessToken,
			apiVersion: ADMIN_API_VERSION,
			fetchImpl,
		});
		await writeBitmapEntries(env.LOCATION_BITMAP, entries);

		await finishSyncRun(env.DB, shop, startedAt, now(), { status: "ok", variants: variantCount }).catch(() => {});
		recordEvent(env.DB, ctx, {
			shop,
			source: "app",
			type: "sync",
			data: { trigger, ok: true, variants: variantCount },
		});
		return { status: "ok", variants: variantCount };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await finishSyncRun(env.DB, shop, startedAt, now(), { status: "error", error: message }).catch(() => {});
		recordEvent(env.DB, ctx, {
			shop,
			source: "app",
			type: "sync",
			level: "error",
			data: { trigger, ok: false, error: message },
		});
		return { status: "error", error: message };
	}
}
