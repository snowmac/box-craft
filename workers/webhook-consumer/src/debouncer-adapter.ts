// The one file allowed to reach into env.SKU_DEBOUNCER (the Durable Object
// namespace binding) — everything past this point depends on the
// Debouncer interface only. See shared/debounce.ts.
import type { Debouncer, PendingLocationUpdate } from "../../../shared/debounce.ts";

interface DurableObjectDebouncerEnv {
	SKU_DEBOUNCER: DurableObjectNamespace;
}

export function createDurableObjectDebouncer(env: DurableObjectDebouncerEnv): Debouncer {
	return {
		async schedule(skuKey: string, update: PendingLocationUpdate): Promise<void> {
			const doId = env.SKU_DEBOUNCER.idFromName(skuKey);
			const stub = env.SKU_DEBOUNCER.get(doId);
			await stub.fetch("https://sku-debouncer/update", {
				method: "POST",
				body: JSON.stringify({ skuKey, ...update }),
			});
		},
	};
}
