// Strict schema for the picker's "bundle_added" beacon (T7). Deliberately
// narrow — this endpoint is public and unauthenticated (a sendBeacon call
// from any storefront), so anything not matching this exact shape is
// dropped rather than recorded. No PII per the plan's ground rules: only
// ids/handles, a count, and a money total.
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const MAX_BOX_HANDLE_LENGTH = 40;
const MAX_ITEM_COUNT = 50;
const MAX_TOTAL_PRICE = 1_000_000;

export interface BundleAddedEvent {
	shop: string;
	boxHandle: string;
	itemCount: number;
	totalPrice: number;
}

export function parseBundleAddedEvent(body: unknown): BundleAddedEvent | null {
	if (typeof body !== "object" || body === null) return null;
	const b = body as Record<string, unknown>;

	if (b.type !== "bundle_added") return null;
	if (typeof b.shop !== "string" || !SHOP_DOMAIN_PATTERN.test(b.shop)) return null;
	if (typeof b.boxHandle !== "string" || b.boxHandle.length === 0 || b.boxHandle.length > MAX_BOX_HANDLE_LENGTH) {
		return null;
	}
	if (
		typeof b.itemCount !== "number" ||
		!Number.isInteger(b.itemCount) ||
		b.itemCount < 1 ||
		b.itemCount > MAX_ITEM_COUNT
	) {
		return null;
	}
	if (typeof b.totalPrice !== "number" || !Number.isFinite(b.totalPrice) || b.totalPrice < 0 || b.totalPrice > MAX_TOTAL_PRICE) {
		return null;
	}

	return { shop: b.shop, boxHandle: b.boxHandle, itemCount: b.itemCount, totalPrice: b.totalPrice };
}
