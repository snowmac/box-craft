// T11: kept as a template-string export (not a plain .css file) so it
// loads identically under both Node's test runner and wrangler's bundler
// without any module-rule configuration — same reasoning as page.ts's HTML.
// Served as-is with a text/css content type by index.ts's /admin.css route.
export const ADMIN_CSS = `:root {
  --bc-bg: #f6f6f7;
  --bc-surface: #ffffff;
  --bc-border: #e3e3e3;
  --bc-text: #202223;
  --bc-text-secondary: #6d7175;
  --bc-radius: 16px;
  --bc-danger-bg: #fef3f2;
  --bc-danger-text: #b42318;
  --bc-ok-text: #1a7f37;
  --bc-accent: #202223;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bc-bg: #1a1a1a;
    --bc-surface: #242424;
    --bc-border: #3a3a3a;
    --bc-text: #f2f2f2;
    --bc-text-secondary: #a3a3a3;
    --bc-danger-bg: #3a1f1d;
    --bc-danger-text: #ff8a80;
    --bc-ok-text: #56d364;
    --bc-accent: #f2f2f2;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bc-bg);
  color: var(--bc-text);
  padding: 24px;
}

.page-header h1 {
  margin: 0 0 20px;
  font-size: 1.5rem;
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--bc-radius);
  margin-bottom: 20px;
}

.banner--error {
  background: var(--bc-danger-bg);
  color: var(--bc-danger-text);
}

.banner p {
  margin: 0;
}

.button {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--bc-border);
  background: var(--bc-surface);
  color: var(--bc-text);
  cursor: pointer;
  font-size: 0.875rem;
  font-family: inherit;
}

.button:hover {
  border-color: var(--bc-text-secondary);
}

.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.card {
  background: var(--bc-surface);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius);
  padding: 20px;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 1rem;
}

.card__body {
  color: var(--bc-text-secondary);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .cards {
    grid-template-columns: 1fr;
  }
}

/* T12: card contents */

.hint {
  color: var(--bc-text-secondary);
  font-size: 0.8125rem;
}

.checklist {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check {
  display: inline-block;
  width: 1.25em;
  text-align: center;
  font-weight: 700;
}

.check--ok {
  color: var(--bc-ok-text);
}

.check--pending {
  color: var(--bc-text-secondary);
}

.toggle-group {
  display: inline-flex;
  border: 1px solid var(--bc-border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.toggle {
  border: none;
  border-right: 1px solid var(--bc-border);
  background: var(--bc-surface);
  color: var(--bc-text);
  padding: 6px 14px;
  cursor: pointer;
  font-size: 0.8125rem;
  font-family: inherit;
}

.toggle:last-child {
  border-right: none;
}

.toggle.is-active {
  background: var(--bc-accent);
  color: var(--bc-surface);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 16px;
}

.stat__value {
  font-size: 1.25rem;
  font-weight: 600;
}

.stat__label {
  color: var(--bc-text-secondary);
  font-size: 0.75rem;
}

.sparkline {
  width: 80px;
  height: 24px;
  margin-top: 4px;
}

.sparkline polyline {
  fill: none;
  stroke: var(--bc-accent);
  stroke-width: 2;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  margin-bottom: 12px;
}

.table th,
.table td {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid var(--bc-border);
}

.button--icon {
  padding: 2px 6px;
  font-size: 0.75rem;
}

.box-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--bc-border);
}

.box-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8125rem;
}

.box-form input[type="text"],
.box-form input[type="number"] {
  padding: 6px 8px;
  border: 1px solid var(--bc-border);
  border-radius: 6px;
  background: var(--bc-surface);
  color: var(--bc-text);
  font: inherit;
}

.fieldset {
  border: 1px solid var(--bc-border);
  border-radius: 8px;
  padding: 10px;
}

.fieldset legend {
  padding: 0 4px;
  font-size: 0.75rem;
  color: var(--bc-text-secondary);
}

.radio,
.switch {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.8125rem;
  margin-bottom: 6px;
}

.tier-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 8px;
}
`;
