// T14: HTML for the six views. Each render function takes plain data
// (already loaded by index.ts via queries.ts) and returns the <body>
// content passed to layout.ts's renderLayout. Kept out of index.ts so the
// routing stays readable.
import { escapeHtml } from "./layout.ts";
import type { OverviewShopRow } from "./queries.ts";
import type { ShopConfig } from "../../../shared/shop-config.ts";
import type { Box } from "../../../shared/boxes.ts";
import type { EventRow, SyncRunRow, ErrorGroup, EventFilters } from "./queries.ts";
import type { BitmapEntry } from "../../../shared/bitmap.ts";
import type { GuardrailTestResult } from "./guardrail-tester.ts";

// Accepts either an epoch-ms number (events.ts, sync_runs) or an ISO
// string (SHOP_TOKENS' installedAt/setupAt) — Date() parses both.
function formatTs(ts: number | string | null | undefined): string {
	if (ts === null || ts === undefined) return "never";
	const date = new Date(ts);
	return Number.isNaN(date.getTime()) ? String(ts) : date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function badge(ok: boolean, okLabel = "up", downLabel = "down"): string {
	return `<span class="badge badge--${ok ? "ok" : "error"}">${ok ? okLabel : downLabel}</span>`;
}

// ---- Overview ----

export interface WorkerHealth {
	guardrail: boolean;
	webhookConsumer: boolean;
	appBackend: boolean;
}

export function renderOverviewBody(shops: OverviewShopRow[], health: WorkerHealth): string {
	const healthCard = `<div class="card">
    <h2>Worker health</h2>
    <p>Guardrail ${badge(health.guardrail)} &nbsp; Webhook consumer ${badge(health.webhookConsumer)} &nbsp; App backend ${badge(health.appBackend)}</p>
  </div>`;

	if (shops.length === 0) {
		return `${healthCard}<p class="hint">No shops installed yet.</p>`;
	}

	const rows = shops
		.map(
			(s) => `<tr>
        <td><a href="/stores/${encodeURIComponent(s.shop)}">${escapeHtml(s.shop)}</a></td>
        <td>${formatTs(s.installedAt)}</td>
        <td>${s.setupAt ? badge(true, "done") : badge(false, "", "pending")}</td>
        <td><code>${escapeHtml(s.scope)}</code></td>
        <td>${s.lastSync ? `${formatTs(s.lastSync.startedAt)} (${escapeHtml(s.lastSync.status)})` : "never"}</td>
        <td>${s.last24h.guardrailChecks}</td>
        <td>${s.last24h.blockedPercent}%</td>
        <td>${s.last24h.errors > 0 ? badge(false, "", String(s.last24h.errors)) : "0"}</td>
      </tr>`,
		)
		.join("");

	return `${healthCard}
  <table>
    <thead><tr><th>Shop</th><th>Installed</th><th>Setup</th><th>Scopes</th><th>Last sync</th><th>24h checks</th><th>24h blocked</th><th>24h errors</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- Store detail ----

function confirmForm(action: string, shop: string, label: string, danger = false): string {
	return `<form method="POST" action="${action}" class="action-form" data-confirm-form>
    <input type="hidden" name="shop" value="${escapeHtml(shop)}">
    <button type="submit" class="button${danger ? " button--danger" : ""}" data-confirm-trigger>${label}</button>
    <span class="confirm-inline" data-confirm-inline hidden>
      Are you sure? <button type="submit" class="button button--danger">Confirm</button>
      <button type="button" class="button" data-confirm-cancel>Cancel</button>
    </span>
  </form>`;
}

export interface StoreDetailData {
	shop: string;
	scope: string;
	config: ShopConfig;
	boxes: Box[];
	events: EventRow[];
	syncHistory: SyncRunRow[];
	bundleProductPublished: boolean;
	cartTransformActive: boolean;
}

export function renderStoreDetailBody(data: StoreDetailData): string {
	const actions = `<div class="card">
    <h2>Actions</h2>
    ${confirmForm("/actions/rerun-setup", data.shop, "Re-run store setup")}
    ${confirmForm("/actions/run-sync", data.shop, "Run sync")}
    ${confirmForm("/actions/force-reexchange", data.shop, "Force setup re-run (clears setupAt)", true)}
  </div>`;

	const statusCard = `<div class="card">
    <h2>Status</h2>
    <p>Token scope: <code>${escapeHtml(data.scope)}</code> (token value never shown)</p>
    <p>Bundle product published: ${badge(data.bundleProductPublished)} &nbsp; Cart Transform active: ${badge(data.cartTransformActive)}</p>
    <p>Guardrail: ${data.config.guardrailEnabled ? "enabled" : "disabled"} — unknown-stock policy: <code>${data.config.unknownStockPolicy}</code></p>
  </div>`;

	const boxesCard = `<div class="card">
    <h2>Boxes (${data.boxes.length})</h2>
    ${
			data.boxes.length === 0
				? '<p class="hint">No boxes configured.</p>'
				: `<table><thead><tr><th>Handle</th><th>Title</th><th>Pick #</th><th>Active</th></tr></thead>
        <tbody>${data.boxes
					.map(
						(b) =>
							`<tr><td><code>${escapeHtml(b.handle)}</code></td><td>${escapeHtml(b.title)}</td><td>${b.pick_count}</td><td>${b.active ? "yes" : "no"}</td></tr>`,
					)
					.join("")}</tbody></table>`
		}
  </div>`;

	const syncCard = `<div class="card">
    <h2>Sync history</h2>
    ${
			data.syncHistory.length === 0
				? '<p class="hint">No sync runs recorded.</p>'
				: `<table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Variants</th><th>Error</th></tr></thead>
        <tbody>${data.syncHistory
					.map(
						(r) =>
							`<tr><td>${formatTs(r.started_at)}</td><td>${escapeHtml(r.trigger)}</td><td>${badge(r.status === "ok", r.status, r.status)}</td><td>${r.variants ?? "—"}</td><td>${escapeHtml(r.error ?? "")}</td></tr>`,
					)
					.join("")}</tbody></table>`
		}
  </div>`;

	const eventsCard = `<div class="card">
    <h2>Last ${data.events.length} events</h2>
    ${renderEventsTable(data.events)}
  </div>`;

	return `${actions}${statusCard}${boxesCard}${syncCard}${eventsCard}`;
}

// ---- Events explorer ----

function renderEventsTable(rows: EventRow[]): string {
	if (rows.length === 0) return '<p class="hint">No matching events.</p>';
	return `<table>
    <thead><tr><th>Time</th><th>Shop</th><th>Source</th><th>Type</th><th>Level</th><th>Data</th></tr></thead>
    <tbody>${rows
			.map((r) => {
				let pretty = r.data ?? "";
				try {
					pretty = JSON.stringify(JSON.parse(r.data ?? "{}"), null, 2);
				} catch {
					// leave raw
				}
				return `<tr>
          <td>${formatTs(r.ts)}</td>
          <td>${r.shop ? escapeHtml(r.shop) : "—"}</td>
          <td>${escapeHtml(r.source)}</td>
          <td>${escapeHtml(r.type)}</td>
          <td>${r.level === "error" ? badge(false, "", "error") : escapeHtml(r.level)}</td>
          <td>${r.data ? `<details><summary>view</summary><pre>${escapeHtml(pretty)}</pre></details>` : ""}</td>
        </tr>`;
			})
			.join("")}</tbody>
  </table>`;
}

export function renderEventsBody(filters: EventFilters, rows: EventRow[], hasMore: boolean, page: number, queryString: string): string {
	const filterForm = `<form method="GET" class="filters">
    <label>Shop <input type="text" name="shop" value="${escapeHtml(filters.shop ?? "")}"></label>
    <label>Source <input type="text" name="source" value="${escapeHtml(filters.source ?? "")}" placeholder="guardrail, picker, webhook, app, cron"></label>
    <label>Type <input type="text" name="type" value="${escapeHtml(filters.type ?? "")}"></label>
    <label>Level
      <select name="level">
        <option value="">any</option>
        ${["info", "warn", "error"].map((l) => `<option value="${l}" ${filters.level === l ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </label>
    <label>Since <input type="datetime-local" name="since" value="${filters.sinceMs ? new Date(filters.sinceMs).toISOString().slice(0, 16) : ""}"></label>
    <label>Until <input type="datetime-local" name="until" value="${filters.untilMs ? new Date(filters.untilMs).toISOString().slice(0, 16) : ""}"></label>
    <label><input type="checkbox" data-auto-refresh> Auto-refresh (5s)</label>
    <button type="submit" class="button">Filter</button>
  </form>`;

	const params = new URLSearchParams(queryString);
	params.set("page", String(page + 1));
	const nextLink = hasMore ? `<a class="button" href="/events?${params.toString()}">Next →</a>` : "";
	params.set("page", String(Math.max(0, page - 1)));
	const prevLink = page > 0 ? `<a class="button" href="/events?${params.toString()}">← Prev</a>` : "";

	return `${filterForm}${renderEventsTable(rows)}<div class="pagination">${prevLink}${nextLink}</div>`;
}

// ---- Errors ----

export function renderErrorsBody(groups: ErrorGroup[], days: number): string {
	const dayLinks = [1, 7, 30]
		.map((d) => `<a class="button" href="/errors?days=${d}">${d}d${d === days ? " ✓" : ""}</a>`)
		.join(" ");

	if (groups.length === 0) {
		return `<p>${dayLinks}</p><p class="hint">No errors in the last ${days} day(s).</p>`;
	}

	const rows = groups
		.map(
			(g) => `<tr>
        <td><code>${escapeHtml(g.where)}</code></td>
        <td>${escapeHtml(g.message)}</td>
        <td>${g.count}</td>
        <td>${formatTs(g.firstSeen)}</td>
        <td>${formatTs(g.lastSeen)}</td>
      </tr>`,
		)
		.join("");

	return `<p>${dayLinks}</p>
  <table>
    <thead><tr><th>Where</th><th>Message</th><th>Count</th><th>First seen</th><th>Last seen</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${confirmFormNoShop("/actions/prune-events", "Prune events now")}`;
}

function confirmFormNoShop(action: string, label: string): string {
	return `<form method="POST" action="${action}" class="action-form" data-confirm-form>
    <button type="submit" class="button" data-confirm-trigger>${label}</button>
    <span class="confirm-inline" data-confirm-inline hidden>
      Are you sure? <button type="submit" class="button button--danger">Confirm</button>
      <button type="button" class="button" data-confirm-cancel>Cancel</button>
    </span>
  </form>`;
}

// ---- KV inspector ----

export function renderKvInspectorBody(options: {
	variantId?: string;
	variantResult?: BitmapEntry | null;
	inventoryItemId?: string;
	inventoryItemResult?: string | null;
}): string {
	const variantSection = `<div class="card">
    <h2>Variant → bitmap</h2>
    <form method="GET" class="filters">
      <label>Variant id (numeric or GID) <input type="text" name="variant" value="${escapeHtml(options.variantId ?? "")}"></label>
      <button type="submit" class="button">Look up</button>
    </form>
    ${
			options.variantId === undefined
				? ""
				: options.variantResult
					? `<pre>${escapeHtml(JSON.stringify(options.variantResult, null, 2))}</pre>`
					: '<p class="hint">No bitmap entry for this variant.</p>'
		}
  </div>`;

	const inventorySection = `<div class="card">
    <h2>Inventory item → variant</h2>
    <form method="GET" class="filters">
      <label>Inventory item id <input type="text" name="inventory_item" value="${escapeHtml(options.inventoryItemId ?? "")}"></label>
      <button type="submit" class="button">Look up</button>
    </form>
    ${
			options.inventoryItemId === undefined
				? ""
				: options.inventoryItemResult
					? `<pre>${escapeHtml(options.inventoryItemResult)}</pre>`
					: '<p class="hint">No mapping for this inventory item.</p>'
		}
  </div>`;

	return `${variantSection}${inventorySection}`;
}

// ---- Guardrail tester ----

export function renderGuardrailTesterBody(options: {
	shop?: string;
	variantIdsRaw?: string;
	result?: GuardrailTestResult;
	error?: string;
}): string {
	const form = `<form method="GET" class="filters">
    <label>Shop <input type="text" name="shop" value="${escapeHtml(options.shop ?? "")}"></label>
    <label style="flex-basis:100%">Variant ids (comma or newline separated)
      <textarea name="variant_ids">${escapeHtml(options.variantIdsRaw ?? "")}</textarea>
    </label>
    <button type="submit" class="button">Test</button>
  </form>`;

	if (options.error) {
		return `${form}<div class="card"><p class="hint">${escapeHtml(options.error)}</p></div>`;
	}
	if (!options.result) return form;

	return `${form}<div class="card">
    <h2>Result</h2>
    <pre>${escapeHtml(JSON.stringify(options.result.checkResponse, null, 2))}</pre>
    <p>Variants with no bitmap data: ${
			options.result.missingBitmapVariantIds.length > 0
				? options.result.missingBitmapVariantIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")
				: "none"
		}</p>
  </div>`;
}
