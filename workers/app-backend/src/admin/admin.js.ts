// T12: the admin page's card behavior. Kept as a template-string export
// (see admin.css.ts for why) so it loads identically under Node and
// wrangler. DOM wiring here isn't unit-tested — same convention as
// shopify-app/extensions/pick-n-picker/assets/pick-n-picker.js, where only
// the pure numeric/business logic is (and here, that logic already lives
// server-side in performance.ts/setup-status.ts/sync.ts, which are).
export const ADMIN_JS = `function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function formatMoney(cents) {
  return "$" + ((cents ?? 0) / 100).toFixed(2);
}

function formatDateTime(ts) {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

// D17: tiny inline SVG sparkline, no chart library.
function sparkline(values) {
  const width = 80;
  const height = 24;
  if (!values || values.length === 0) return "";
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => \`\${(i * step).toFixed(1)},\${(height - (v / max) * height).toFixed(1)}\`)
    .join(" ");
  return \`<svg class="sparkline" viewBox="0 0 \${width} \${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="\${points}" /></svg>\`;
}

async function boxcraftFetch(path, options) {
  options = options || {};
  const token = await window.shopify.idToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(path, Object.assign({}, options, { headers }));
}

function cardBody(id) {
  return document.querySelector('[data-card="' + id + '"] [data-card-body]');
}

// ---- Setup + Inventory sync (share one /api/overview fetch) ----

let latestOverview = null;

function renderSetupCard(overview) {
  const el = cardBody("setup");
  if (!el) return;
  const check = (ok) => (ok ? '<span class="check check--ok">✓</span>' : '<span class="check check--pending">•</span>');
  el.innerHTML = \`
    <ul class="checklist">
      <li>\${check(overview.tokenOk)} Access token stored</li>
      <li>\${check(overview.bundleProductPublished)} Bundle product published</li>
      <li>\${check(overview.cartTransformActive)} Cart Transform active</li>
      <li>\${check(!!overview.lastSync)} Inventory sync \${overview.lastSync ? "(" + formatDateTime(overview.lastSync.startedAt) + ")" : "— never run"}</li>
    </ul>
    <p><a href="\${overview.themeBlockDeepLink}" target="_top">Add Pick-N block to a theme →</a></p>
  \`;
}

function renderSyncCard(overview) {
  const el = cardBody("sync");
  if (!el) return;
  const last = overview.lastSync;
  const summary = last
    ? formatDateTime(last.startedAt) + " — " + last.status + (last.variants != null ? " (" + last.variants + " variants)" : "")
    : "Never run";
  el.innerHTML = \`
    <p data-sync-summary>Last run: \${summary}</p>
    <button type="button" class="button" data-sync-now>Sync now</button>
  \`;
  el.querySelector("[data-sync-now]").addEventListener("click", runSyncNow);
}

async function loadOverview() {
  const res = await boxcraftFetch("/api/overview");
  if (!res.ok) return;
  latestOverview = await res.json();
  renderSetupCard(latestOverview);
  renderSyncCard(latestOverview);
}

async function runSyncNow() {
  const button = cardBody("sync")?.querySelector("[data-sync-now]");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    await boxcraftFetch("/api/sync", { method: "POST" });
  } catch (err) {
    console.error("[BoxCraft]", err);
  }
  // The spec's "polls /api/overview": our sync runs to completion before
  // responding, so one re-fetch after it settles reflects the new state —
  // no separate interval-polling loop needed for a call this short-lived.
  await loadOverview();
}

// ---- Performance ----

let performanceWindowDays = 7;

function renderPerformanceCard(metrics) {
  const el = cardBody("performance");
  if (!el) return;
  const stat = (value, label, series) => \`
    <div class="stat">
      <div class="stat__value">\${value}</div>
      <div class="stat__label">\${label}</div>
      \${series ? sparkline(series) : ""}
    </div>\`;

  el.innerHTML = \`
    <div class="toggle-group" data-perf-toggle>
      <button type="button" class="toggle\${metrics.windowDays === 7 ? " is-active" : ""}" data-days="7">7 days</button>
      <button type="button" class="toggle\${metrics.windowDays === 30 ? " is-active" : ""}" data-days="30">30 days</button>
    </div>
    <div class="stat-grid">
      \${stat(metrics.bundlesAdded, "Bundles added", metrics.series.bundlesAdded)}
      \${stat(metrics.bundlesSold, "Bundles sold", metrics.series.bundlesSold)}
      \${stat(formatMoney(metrics.revenueCents), "Bundle revenue")}
      \${stat(metrics.conversionPercent + "%", "Add → sold conversion")}
      \${stat(metrics.guardrailChecks, "Guardrail checks", metrics.series.guardrailChecks)}
      \${stat(metrics.blockedPercent + "%", "Blocked")}
      \${stat(metrics.failOpens, "Fail-opens")}
    </div>
  \`;
  el.querySelectorAll("[data-days]").forEach((btn) => {
    btn.addEventListener("click", () => {
      performanceWindowDays = Number(btn.dataset.days);
      loadPerformance();
    });
  });
}

async function loadPerformance() {
  const res = await boxcraftFetch("/api/performance?days=" + performanceWindowDays);
  if (!res.ok) return;
  renderPerformanceCard(await res.json());
}

// ---- Location guardrail ----

function renderGuardrailCard(config) {
  const el = cardBody("guardrail");
  if (!el) return;
  el.innerHTML = \`
    <label class="switch">
      <input type="checkbox" data-guardrail-enabled \${config.guardrailEnabled ? "checked" : ""}>
      Guardrail enabled
    </label>
    <p class="hint">When off, every combination is allowed to ship together as one bundle.</p>
    <fieldset class="fieldset">
      <legend>Unknown-stock items</legend>
      <label class="radio">
        <input type="radio" name="unknown_stock_policy" value="allow" \${config.unknownStockPolicy === "allow" ? "checked" : ""}>
        Allow — items with no inventory data yet are treated as available anywhere.
      </label>
      <label class="radio">
        <input type="radio" name="unknown_stock_policy" value="block" \${config.unknownStockPolicy === "block" ? "checked" : ""}>
        Block — items with no inventory data yet block the whole bundle.
      </label>
    </fieldset>
    <p class="hint" data-guardrail-saved hidden>Saved.</p>
  \`;

  const save = async (patch) => {
    const res = await boxcraftFetch("/api/config", { method: "PUT", body: JSON.stringify(patch) });
    if (!res.ok) return;
    const saved = el.querySelector("[data-guardrail-saved]");
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 2000);
  };

  el.querySelector("[data-guardrail-enabled]").addEventListener("change", (e) => {
    save({ guardrail_enabled: e.target.checked });
  });
  el.querySelectorAll('input[name="unknown_stock_policy"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) save({ unknown_stock_policy: e.target.value });
    });
  });
}

async function loadGuardrailConfig() {
  const res = await boxcraftFetch("/api/config");
  if (!res.ok) return;
  renderGuardrailCard(await res.json());
}

// ---- Boxes ----

function discountSummary(discount) {
  if (!discount || discount.type === "none") return "None";
  if (discount.type === "percent") return discount.percent + "% off";
  if (discount.type === "tiered") {
    return discount.tiers.map((t) => t.min_items + "+: " + t.percent + "%").join(", ");
  }
  return "None";
}

function boxRowHtml(box) {
  return \`
    <tr data-box-row="\${escapeHtml(box.handle)}">
      <td><code>\${escapeHtml(box.handle)}</code> <button type="button" class="button button--icon" data-copy-handle="\${escapeHtml(box.handle)}" title="Copy handle">⧉</button></td>
      <td>\${escapeHtml(box.title)}</td>
      <td>\${box.pick_count}</td>
      <td>\${escapeHtml(discountSummary(box.discount))}</td>
      <td>\${box.active ? "Yes" : "No"}</td>
      <td>
        <button type="button" class="button" data-edit-box="\${escapeHtml(box.handle)}">Edit</button>
        <button type="button" class="button" data-delete-box="\${escapeHtml(box.handle)}">Delete</button>
      </td>
    </tr>\`;
}

let latestBoxes = [];

function renderBoxesCard() {
  const el = cardBody("boxes");
  if (!el) return;
  el.innerHTML = \`
    <table class="table">
      <thead><tr><th>Handle</th><th>Title</th><th>Pick #</th><th>Discount</th><th>Active</th><th></th></tr></thead>
      <tbody data-boxes-rows>\${latestBoxes.map(boxRowHtml).join("")}</tbody>
    </table>
    <button type="button" class="button" data-add-box>Add box</button>
    <form class="box-form" data-box-form hidden>
      <input type="hidden" data-field="original_handle">
      <label>Handle <input type="text" data-field="handle" required pattern="[a-z0-9-]{1,40}"></label>
      <label>Title <input type="text" data-field="title" required></label>
      <fieldset class="fieldset">
        <legend>Pools — pick N from each collection, all merged into one bundle</legend>
        <div data-pools-rows></div>
        <button type="button" class="button" data-add-pool>Add pool</button>
      </fieldset>
      <label class="switch"><input type="checkbox" data-field="active" checked> Active</label>
      <fieldset class="fieldset">
        <legend>Discount</legend>
        <label class="radio"><input type="radio" name="discount_type" value="none" checked> None</label>
        <label class="radio"><input type="radio" name="discount_type" value="percent"> Percent</label>
        <label class="radio"><input type="radio" name="discount_type" value="tiered"> Tiered</label>
        <div data-discount-percent hidden>
          <label>Percent off <input type="number" data-field="discount_percent" min="0" max="90"></label>
        </div>
        <div data-discount-tiers hidden>
          <div data-tiers-rows></div>
          <button type="button" class="button" data-add-tier>Add tier</button>
        </div>
      </fieldset>
      <button type="submit" class="button">Save</button>
      <button type="button" class="button" data-cancel-box>Cancel</button>
      <p class="hint" data-box-error hidden></p>
    </form>
  \`;
  wireBoxesCard(el);
}

function tierRowHtml(minItems, percent) {
  return \`<div class="tier-row">
    <label>Min items <input type="number" min="1" data-tier-min value="\${minItems ?? ""}"></label>
    <label>Percent <input type="number" min="0" max="90" data-tier-percent value="\${percent ?? ""}"></label>
    <button type="button" class="button button--icon" data-remove-tier title="Remove tier">✕</button>
  </div>\`;
}

// D3: 1-5 pools per box, mirrored client-side (the server is the real
// enforcement — see validatePools).
const MAX_POOLS = 5;

function poolRowHtml(collectionHandle, count) {
  return \`<div class="pool-row">
    <label>Collection handle <input type="text" data-pool-collection value="\${escapeHtml(collectionHandle ?? "")}" required></label>
    <label>Count <input type="number" min="1" max="20" data-pool-count value="\${count ?? ""}" required></label>
    <button type="button" class="button button--icon" data-remove-pool title="Remove pool">✕</button>
  </div>\`;
}

function wireBoxesCard(el) {
  const form = el.querySelector("[data-box-form]");
  const rows = el.querySelector("[data-boxes-rows]");
  const errorEl = el.querySelector("[data-box-error]");
  const tiersRows = el.querySelector("[data-tiers-rows]");
  const poolsRows = el.querySelector("[data-pools-rows]");
  const addPoolButton = el.querySelector("[data-add-pool]");

  function updateAddPoolButton() {
    addPoolButton.disabled = poolsRows.querySelectorAll(".pool-row").length >= MAX_POOLS;
  }

  poolsRows.addEventListener("click", (e) => {
    if (!e.target.matches("[data-remove-pool]")) return;
    // Keep at least one pool row — a box always needs somewhere to pick from.
    if (poolsRows.querySelectorAll(".pool-row").length <= 1) return;
    e.target.closest(".pool-row").remove();
    updateAddPoolButton();
  });
  addPoolButton.addEventListener("click", () => {
    poolsRows.insertAdjacentHTML("beforeend", poolRowHtml());
    updateAddPoolButton();
  });

  function setDiscountType(type) {
    form.querySelector("[data-discount-percent]").hidden = type !== "percent";
    form.querySelector("[data-discount-tiers]").hidden = type !== "tiered";
  }

  form.querySelectorAll('input[name="discount_type"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) setDiscountType(e.target.value);
    });
  });

  tiersRows.addEventListener("click", (e) => {
    if (e.target.matches("[data-remove-tier]")) e.target.closest(".tier-row").remove();
  });
  form.querySelector("[data-add-tier]").addEventListener("click", () => {
    tiersRows.insertAdjacentHTML("beforeend", tierRowHtml());
  });

  function openForm(box) {
    errorEl.hidden = true;
    form.hidden = false;
    form.querySelector('[data-field="original_handle"]').value = box ? box.handle : "";
    form.querySelector('[data-field="handle"]').value = box ? box.handle : "";
    form.querySelector('[data-field="title"]').value = box ? box.title : "";
    form.querySelector('[data-field="active"]').checked = box ? box.active : true;

    // Existing boxes always come back with pools populated (T1/T3's
    // normalizeBox synthesizes one from legacy collection_handle/pick_count
    // for anything saved before pools existed) — a brand-new box starts
    // with one empty pool row, matching the old single-pool default.
    const pools = box && box.pools && box.pools.length ? box.pools : [{ collection_handle: "", count: 4 }];
    poolsRows.innerHTML = pools.map((p) => poolRowHtml(p.collection_handle, p.count)).join("");
    updateAddPoolButton();

    const discount = (box && box.discount) || { type: "none" };
    form.querySelector('input[name="discount_type"][value="' + discount.type + '"]').checked = true;
    setDiscountType(discount.type);
    form.querySelector('[data-field="discount_percent"]').value = discount.type === "percent" ? discount.percent : "";
    tiersRows.innerHTML =
      discount.type === "tiered" ? discount.tiers.map((t) => tierRowHtml(t.min_items, t.percent)).join("") : "";

    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  el.querySelector("[data-add-box]").addEventListener("click", () => openForm(null));
  el.querySelector("[data-cancel-box]").addEventListener("click", () => {
    form.hidden = true;
  });

  rows.addEventListener("click", async (e) => {
    const editHandle = e.target.getAttribute("data-edit-box");
    const deleteHandle = e.target.getAttribute("data-delete-box");
    const copyHandle = e.target.getAttribute("data-copy-handle");

    if (editHandle) {
      openForm(latestBoxes.find((b) => b.handle === editHandle));
    } else if (deleteHandle) {
      if (!confirm('Delete box "' + deleteHandle + '"?')) return;
      await boxcraftFetch("/api/boxes/" + encodeURIComponent(deleteHandle), { method: "DELETE" });
      await loadBoxes();
    } else if (copyHandle) {
      navigator.clipboard?.writeText(copyHandle).catch(() => {});
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const discountType = form.querySelector('input[name="discount_type"]:checked').value;
    let discount = { type: "none" };
    if (discountType === "percent") {
      discount = { type: "percent", percent: Number(form.querySelector('[data-field="discount_percent"]').value) };
    } else if (discountType === "tiered") {
      const tiers = Array.from(tiersRows.querySelectorAll(".tier-row")).map((row) => ({
        min_items: Number(row.querySelector("[data-tier-min]").value),
        percent: Number(row.querySelector("[data-tier-percent]").value),
      }));
      discount = { type: "tiered", tiers };
    }

    const pools = Array.from(poolsRows.querySelectorAll(".pool-row")).map((row) => ({
      collection_handle: row.querySelector("[data-pool-collection]").value,
      count: Number(row.querySelector("[data-pool-count]").value),
    }));

    const body = {
      handle: form.querySelector('[data-field="handle"]').value,
      title: form.querySelector('[data-field="title"]').value,
      active: form.querySelector('[data-field="active"]').checked,
      discount,
      pools,
    };

    const originalHandle = form.querySelector('[data-field="original_handle"]').value;
    const path = originalHandle ? "/api/boxes/" + encodeURIComponent(originalHandle) : "/api/boxes";
    const method = originalHandle ? "PUT" : "POST";

    const res = await boxcraftFetch(path, { method, body: JSON.stringify(body) });
    if (!res.ok && res.status !== 207) {
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = (data.errors || [data.error || "Couldn't save this box."]).join(", ");
      errorEl.hidden = false;
      return;
    }

    form.hidden = true;
    await loadBoxes();
  });
}

async function loadBoxes() {
  const res = await boxcraftFetch("/api/boxes");
  if (!res.ok) return;
  const data = await res.json();
  latestBoxes = data.boxes;
  renderBoxesCard();
}

// ---- Init ----
// Guarded the same way as pick-n-picker.js's own DOM wiring: this module
// is also loaded directly by Node (see index.ts's /admin.js route test),
// where window/document don't exist.
if (typeof document !== "undefined") {
  document.querySelector("[data-retry-setup]")?.addEventListener("click", () => {
    location.reload();
  });

  if (window.shopify && typeof window.shopify.idToken === "function") {
    loadOverview();
    loadPerformance();
    loadGuardrailConfig();
    loadBoxes();
  }
}
`;
