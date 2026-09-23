// T10/D13: bundle sales attribution from orders/paid. Pure grouping logic,
// independent of the Worker fetch handler so it's directly unit-testable.
// No PII per the plan's ground rules — the summary this produces is only
// an order id, a count, and a money total, never line item titles,
// customer details, or addresses.
export interface OrderLineItemProperty {
	name: string;
	value: string;
}

export interface OrderLineItem {
	quantity: number;
	// Per-unit price as Shopify's REST webhook payload sends it: a decimal
	// string, e.g. "19.99".
	price: string;
	properties?: OrderLineItemProperty[] | null;
}

export interface OrdersPaidPayload {
	id: number;
	line_items: OrderLineItem[];
}

export interface BundleSaleSummary {
	orderId: number;
	bundleCount: number;
	revenueCents: number;
}

function bundleId(item: OrderLineItem): string | null {
	return item.properties?.find((p) => p.name === "_bundle_id")?.value ?? null;
}

function centsFromDecimalString(amount: string): number | null {
	const n = Number(amount);
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// Groups line items by the _bundle_id property the picker sets on
// add-to-cart (see pick-n-picker.js). Returns null when the order has no
// bundle line items at all, so the caller knows not to record an event.
//
// NOTE: this groups whatever line items the payload actually contains.
// Whether _bundle_id survives onto the order's line item(s) after the
// Cart Transform function merges a bundle's cart lines into one parent
// line (see shopify-app/extensions/cart-transform) hasn't been verified
// against a real paid order — flagged in assumptions.md as needing that
// check on the dev store.
export function computeBundleSaleSummary(payload: OrdersPaidPayload): BundleSaleSummary | null {
	const bundleIds = new Set<string>();
	let revenueCents = 0;

	for (const item of payload.line_items) {
		const id = bundleId(item);
		if (!id) continue;
		bundleIds.add(id);
		const priceCents = centsFromDecimalString(item.price);
		if (priceCents !== null) revenueCents += priceCents * item.quantity;
	}

	if (bundleIds.size === 0) return null;
	return { orderId: payload.id, bundleCount: bundleIds.size, revenueCents };
}
