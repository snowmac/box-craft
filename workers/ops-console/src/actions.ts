// T14: the four operator actions. Each takes the minimal env slice it
// needs (structural typing — the real Env in index.ts satisfies all of
// these) and returns a plain result the caller renders as a flash message.
import type { D1Like, EventContext } from "../../../shared/events.ts";
import type { KVLike } from "../../../shared/kv.ts";
import { pruneOldEvents } from "../../../shared/retention.ts";
import { ensureStoreSetup } from "../../app-backend/src/store-setup.ts";
import { adminClient } from "../../app-backend/src/admin-client.ts";
import { runSync, type SyncEnv } from "../../app-backend/src/sync.ts";

export interface ActionResult {
	ok: boolean;
	message: string;
}

interface ShopTokenRecord {
	accessToken: string;
	scope: string;
	installedAt: string;
	setupAt?: string;
}

async function getShopRecord(shopTokens: KVLike, shop: string): Promise<ShopTokenRecord | null> {
	return shopTokens.get<ShopTokenRecord>(`shop:${shop}`, "json");
}

export async function rerunStoreSetup(shopTokens: KVLike, shop: string): Promise<ActionResult> {
	const record = await getShopRecord(shopTokens, shop);
	if (!record) return { ok: false, message: `No stored token for ${shop}.` };

	try {
		await ensureStoreSetup(adminClient(shop, record.accessToken));
		return { ok: true, message: `Store setup re-ran successfully for ${shop}.` };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, message: `Store setup failed for ${shop}: ${message}` };
	}
}

export async function triggerSync(
	env: SyncEnv & { SHOP_TOKENS: KVLike },
	ctx: EventContext,
	shop: string,
): Promise<ActionResult> {
	const record = await getShopRecord(env.SHOP_TOKENS, shop);
	if (!record) return { ok: false, message: `No stored token for ${shop}.` };

	const result = await runSync(env, ctx, shop, record.accessToken, "manual");
	if (result.status === "ok") return { ok: true, message: `Sync completed for ${shop}: ${result.variants} variants.` };
	if (result.status === "skipped") return { ok: false, message: `Sync skipped — one is already running for ${shop}.` };
	return { ok: false, message: `Sync failed for ${shop}: ${result.error}` };
}

// D15/T14: this clears setupAt so the shop's next natural app-backend page
// load re-runs ensureStoreSetup — the operator has no id_token to perform
// a real Shopify OAuth exchange from here, so "force re-exchange" really
// means "force the app to redo its own setup/exchange checks next time",
// not an immediate token-endpoint call from this Worker.
export async function forceSetupReRun(shopTokens: KVLike, shop: string): Promise<ActionResult> {
	const key = `shop:${shop}`;
	const record = await getShopRecord(shopTokens, shop);
	if (!record) return { ok: false, message: `No stored token for ${shop}.` };

	const { setupAt: _setupAt, ...rest } = record;
	await shopTokens.put(key, JSON.stringify(rest));
	return { ok: true, message: `Cleared setup state for ${shop} — it will re-run on the next app load.` };
}

export async function pruneEventsNow(db: D1Like): Promise<ActionResult> {
	try {
		await pruneOldEvents(db);
		return { ok: true, message: "Pruned events older than the retention window." };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, message: `Prune failed: ${message}` };
	}
}
