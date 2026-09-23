// Pick-N picker: client-side selection state, guardrail wiring, and
// add-to-cart. Pure/calculable pieces are exported so they're directly
// unit-testable in Node (see ../test/picker-logic.test.ts) without a DOM.
// The DOM wiring below them is what actually runs in the storefront.

export function computeBundleTotal(selections) {
	let total = 0;
	for (const { price } of selections.values()) {
		total += price;
	}
	// Round to cents to avoid floating point drift accumulating across
	// several selected items before it reaches the Cart Transform function.
	return Math.round(total * 100) / 100;
}

export function buildAddToCartPayload(selections, bundleId, totalPrice, boxHandle) {
	return {
		items: Array.from(selections.keys()).map((variantId) => ({
			id: variantId,
			quantity: 1,
			properties: {
				_bundle_id: bundleId,
				_bundle_price: totalPrice.toFixed(2),
				_bundle_box: boxHandle,
			},
		})),
	};
}

// A single selected item can never conflict with itself, so there's no
// reason to call the Guardrail Worker until there are 2+.
export function shouldRunGuardrailCheck(selectionSize) {
	return selectionSize >= 2;
}

// T7: payload for the fire-and-forget "bundle_added" beacon (see
// src/bundle-added-event.ts on the Guardrail Worker for the schema it's
// validated against).
export function buildBundleAddedBeacon(shop, boxHandle, itemCount, totalPrice) {
	return JSON.stringify({
		type: "bundle_added",
		shop,
		boxHandle,
		itemCount,
		totalPrice,
	});
}

const DEBOUNCE_MS = 250;
const CHECK_TIMEOUT_MS = 300;

function initPicker(root) {
	const pickCount = parseInt(root.dataset.pickCount, 10) || 1;
	const guardrailUrl = root.dataset.guardrailUrl;
	const shop = root.dataset.shop;
	const boxHandle = root.dataset.box;
	const items = Array.from(root.querySelectorAll("[data-boxcraft-item]"));
	const counterEl = root.querySelector("[data-boxcraft-counter]");
	const addButton = root.querySelector("[data-boxcraft-add-to-cart]");
	const blockedEl = root.querySelector("[data-boxcraft-blocked]");

	const selected = new Map(); // variantId -> { price }
	let debounceTimer = null;
	// Fail-open by default: until a guardrail check actually runs (or when
	// none is configured for this store), never block add-to-cart on it.
	let compatible = true;

	items.forEach((item) => {
		item.addEventListener("click", () => toggleItem(item));
	});

	addButton.addEventListener("click", addBundleToCart);

	function toggleItem(item) {
		const variantId = item.dataset.variantId;
		if (selected.has(variantId)) {
			selected.delete(variantId);
			item.setAttribute("aria-pressed", "false");
			item.classList.remove("is-selected");
		} else {
			if (selected.size >= pickCount) return; // blocks a submit past N
			selected.set(variantId, { price: parseFloat(item.dataset.variantPrice) || 0 });
			item.setAttribute("aria-pressed", "true");
			item.classList.add("is-selected");
		}
		updateUI();
		scheduleGuardrailCheck();
	}

	function updateUI() {
		counterEl.textContent = `${selected.size} / ${pickCount} selected`;
		addButton.disabled = selected.size !== pickCount || !compatible;
	}

	function scheduleGuardrailCheck() {
		if (!guardrailUrl) return; // no guardrail configured for this store yet

		clearTimeout(debounceTimer);
		if (!shouldRunGuardrailCheck(selected.size)) {
			setCompatible(true);
			return;
		}

		debounceTimer = setTimeout(runGuardrailCheck, DEBOUNCE_MS);
	}

	async function runGuardrailCheck() {
		const variantIds = Array.from(selected.keys());
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

		try {
			const res = await fetch(`${guardrailUrl.replace(/\/$/, "")}/check`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ variantIds, shop }),
				signal: controller.signal,
			});
			clearTimeout(timeout);
			if (!res.ok) throw new Error(`guardrail check failed: ${res.status}`);
			const data = await res.json();
			setCompatible(data.compatible !== false);
		} catch {
			// Client-side fail-open mirrors the Worker's own fail-open
			// design — a timeout or network error must never block
			// add-to-cart. See specs/product/technical-spec.md.
			clearTimeout(timeout);
			setCompatible(true);
		}
	}

	function setCompatible(value) {
		compatible = value;
		blockedEl.hidden = value;
		if (!value) {
			blockedEl.textContent =
				"This combination can't ship together from one location. Try swapping an item.";
		}
		updateUI();
	}

	async function addBundleToCart() {
		if (selected.size !== pickCount || !compatible) return;

		const bundleId = crypto.randomUUID(); // fresh per bundle instance, not per product
		const totalPrice = computeBundleTotal(selected);
		const payload = buildAddToCartPayload(selected, bundleId, totalPrice, boxHandle);

		addButton.disabled = true;
		addButton.textContent = "Adding...";

		try {
			const res = await fetch("/cart/add.js", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (!res.ok) throw new Error(`add to cart failed: ${res.status}`);
			addButton.textContent = "Added!";
			sendBundleAddedBeacon(selected.size, totalPrice);
			document.dispatchEvent(
				new CustomEvent("boxcraft:bundle-added", { detail: { bundleId } }),
			);
		} catch (err) {
			addButton.textContent = "Try again";
			console.error("[BoxCraft]", err);
		} finally {
			addButton.disabled = false;
		}
	}

	// Fire-and-forget: navigator.sendBeacon defaults to a text/plain body,
	// which the browser sends as a "simple request" — no CORS preflight,
	// and no response is ever read back (see src/index.ts's /events route
	// on the Guardrail Worker). Never blocks or errors the add-to-cart flow.
	function sendBundleAddedBeacon(itemCount, totalPrice) {
		if (!guardrailUrl || !shop || typeof navigator.sendBeacon !== "function") return;
		const url = `${guardrailUrl.replace(/\/$/, "")}/events`;
		navigator.sendBeacon(url, buildBundleAddedBeacon(shop, boxHandle, itemCount, totalPrice));
	}

	updateUI();
}

if (typeof document !== "undefined") {
	document.querySelectorAll("[data-boxcraft-picker]").forEach(initPicker);
}
