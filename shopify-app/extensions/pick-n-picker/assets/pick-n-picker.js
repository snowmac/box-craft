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

// Multi-pool boxes (D7): selection state is Map<poolIndex,
// Map<variantId, {price}>>. "Add Bundle" enables only when every pool's
// selected size equals its required count — requiredCounts is
// Map<poolIndex, count>, read from the block's data-boxcraft-pools JSON.
export function allPoolsFull(selections, requiredCounts) {
	for (const [poolIndex, count] of requiredCounts) {
		const selectedSize = selections.get(poolIndex)?.size ?? 0;
		if (selectedSize !== count) return false;
	}
	return true;
}

// Guardrail check and the add-to-cart payload never need to know about
// pools — they operate on one flat variant-id list, exactly as before
// pools existed.
export function flattenSelections(selections) {
	const flat = new Map();
	for (const poolSelections of selections.values()) {
		for (const [variantId, value] of poolSelections) flat.set(variantId, value);
	}
	return flat;
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
	const guardrailUrl = root.dataset.guardrailUrl;
	const shop = root.dataset.shop;
	const boxHandle = root.dataset.box;
	const addButton = root.querySelector("[data-boxcraft-add-to-cart]");
	const blockedEl = root.querySelector("[data-boxcraft-blocked]");

	// D6: one <script type="application/json"> per block, {index, count,
	// collection_handle} per pool — avoids fragile multi-value
	// data-attributes now that there can be more than one pool.
	const poolsJson = root.querySelector("[data-boxcraft-pools]");
	const poolsData = poolsJson ? JSON.parse(poolsJson.textContent) : [];
	const requiredCounts = new Map(poolsData.map((p) => [p.index, p.count]));

	const selections = new Map(); // poolIndex -> Map<variantId, { price }>
	const poolCounters = new Map(); // poolIndex -> counter element
	let debounceTimer = null;
	// Fail-open by default: until a guardrail check actually runs (or when
	// none is configured for this store), never block add-to-cart on it.
	let compatible = true;

	root.querySelectorAll("[data-boxcraft-pool]").forEach((section) => {
		const poolIndex = Number(section.dataset.poolIndex);
		selections.set(poolIndex, new Map());
		poolCounters.set(poolIndex, section.querySelector("[data-boxcraft-counter]"));
		section.querySelectorAll("[data-boxcraft-item]").forEach((item) => {
			item.addEventListener("click", () => toggleItem(poolIndex, item));
		});
	});

	addButton.addEventListener("click", addBundleToCart);

	function toggleItem(poolIndex, item) {
		const variantId = item.dataset.variantId;
		const poolSelections = selections.get(poolIndex);
		if (poolSelections.has(variantId)) {
			poolSelections.delete(variantId);
			item.setAttribute("aria-pressed", "false");
			item.classList.remove("is-selected");
		} else {
			if (poolSelections.size >= (requiredCounts.get(poolIndex) || 0)) return; // blocks a submit past N
			poolSelections.set(variantId, { price: parseFloat(item.dataset.variantPrice) || 0 });
			item.setAttribute("aria-pressed", "true");
			item.classList.add("is-selected");
		}
		updateUI(poolIndex);
		scheduleGuardrailCheck();
	}

	function updateUI(poolIndex) {
		if (poolIndex !== undefined) {
			const counterEl = poolCounters.get(poolIndex);
			if (counterEl) {
				counterEl.textContent = `${selections.get(poolIndex).size} / ${requiredCounts.get(poolIndex) || 0} selected`;
			}
		}
		addButton.disabled = !allPoolsFull(selections, requiredCounts) || !compatible;
	}

	function scheduleGuardrailCheck() {
		if (!guardrailUrl) return; // no guardrail configured for this store yet

		clearTimeout(debounceTimer);
		const flatSize = flattenSelections(selections).size;
		if (!shouldRunGuardrailCheck(flatSize)) {
			setCompatible(true);
			return;
		}

		debounceTimer = setTimeout(runGuardrailCheck, DEBOUNCE_MS);
	}

	async function runGuardrailCheck() {
		const variantIds = Array.from(flattenSelections(selections).keys());
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
		if (!allPoolsFull(selections, requiredCounts) || !compatible) return;

		const flat = flattenSelections(selections);
		const bundleId = crypto.randomUUID(); // fresh per bundle instance, not per product
		const totalPrice = computeBundleTotal(flat);
		const payload = buildAddToCartPayload(flat, bundleId, totalPrice, boxHandle);

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
			sendBundleAddedBeacon(flat.size, totalPrice);
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
