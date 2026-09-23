// T14: the Guardrail tester view's logic. Calls the live, public
// Guardrail Worker /check endpoint (the real deployed compatibility
// logic, including current per-shop config) and separately checks
// LOCATION_BITMAP directly for each pasted variant, since /check's own
// response never says which specific variants it didn't have data for —
// only an aggregate count goes into its own recorded event.
import { bitmapKey, toVariantGid } from "../../../shared/bitmap.ts";

export function parseVariantIdsInput(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export async function findMissingBitmapEntries(kv: KVNamespace, variantIds: string[]): Promise<string[]> {
	const missing: string[] = [];
	for (const id of variantIds) {
		const raw = await kv.get(bitmapKey(toVariantGid(id)));
		if (raw === null) missing.push(id);
	}
	return missing;
}

export interface GuardrailTestResult {
	checkResponse: unknown;
	missingBitmapVariantIds: string[];
}

export async function runGuardrailTest(
	locationBitmap: KVNamespace,
	guardrailWorkerUrl: string,
	shop: string,
	variantIds: string[],
	fetchImpl: typeof fetch = fetch,
): Promise<GuardrailTestResult> {
	const [checkResponse, missingBitmapVariantIds] = await Promise.all([
		fetchImpl(`${guardrailWorkerUrl.replace(/\/$/, "")}/check`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ variantIds, shop }),
		}).then((r) => r.json()),
		findMissingBitmapEntries(locationBitmap, variantIds),
	]);
	return { checkResponse, missingBitmapVariantIds };
}
