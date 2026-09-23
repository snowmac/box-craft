// T14: kept as a template-string export — same reasoning as the merchant
// admin page's admin.css.ts (loads identically under Node and wrangler
// with no module-rule config).
export const CONSOLE_CSS = `:root {
  --bc-bg: #f6f6f7;
  --bc-surface: #ffffff;
  --bc-border: #e3e3e3;
  --bc-text: #202223;
  --bc-text-secondary: #6d7175;
  --bc-radius: 12px;
  --bc-danger-bg: #fef3f2;
  --bc-danger-text: #b42318;
  --bc-ok-bg: #ecfdf3;
  --bc-ok-text: #1a7f37;
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
    --bc-ok-bg: #163829;
    --bc-ok-text: #56d364;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bc-bg);
  color: var(--bc-text);
  font-size: 0.875rem;
}

.shell {
  display: flex;
  min-height: 100vh;
}

.nav {
  width: 200px;
  flex-shrink: 0;
  background: var(--bc-surface);
  border-right: 1px solid var(--bc-border);
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav__brand {
  font-weight: 700;
  margin-bottom: 12px;
  padding: 0 8px;
}

.nav-link {
  display: block;
  padding: 8px;
  border-radius: 8px;
  color: var(--bc-text);
  text-decoration: none;
}

.nav-link:hover, .nav-link.is-active {
  background: var(--bc-bg);
}

.nav__logout {
  margin-top: auto;
}

.link-button {
  background: none;
  border: none;
  color: var(--bc-text-secondary);
  cursor: pointer;
  padding: 8px;
  font: inherit;
}

.content {
  flex: 1;
  padding: 24px 32px;
  max-width: 1100px;
}

.content h1 {
  font-size: 1.25rem;
  margin: 0 0 16px;
}

.flash {
  padding: 10px 14px;
  border-radius: var(--bc-radius);
  margin-bottom: 16px;
}

.flash--ok { background: var(--bc-ok-bg); color: var(--bc-ok-text); }
.flash--error { background: var(--bc-danger-bg); color: var(--bc-danger-text); }

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  background: var(--bc-surface);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius);
  overflow: hidden;
}

th, td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--bc-border);
  vertical-align: top;
}

th { color: var(--bc-text-secondary); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }

tr:last-child td { border-bottom: none; }

.card {
  background: var(--bc-surface);
  border: 1px solid var(--bc-border);
  border-radius: var(--bc-radius);
  padding: 16px 20px;
  margin-bottom: 20px;
}

.card h2 { font-size: 1rem; margin: 0 0 10px; }

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge--ok { background: var(--bc-ok-bg); color: var(--bc-ok-text); }
.badge--error { background: var(--bc-danger-bg); color: var(--bc-danger-text); }
.badge--neutral { background: var(--bc-bg); color: var(--bc-text-secondary); }

.button {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--bc-border);
  background: var(--bc-surface);
  color: var(--bc-text);
  cursor: pointer;
  font-size: 0.8125rem;
  font-family: inherit;
}

.button--danger {
  background: var(--bc-danger-text);
  border-color: var(--bc-danger-text);
  color: #fff;
}

.confirm-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.action-form {
  display: inline-block;
  margin: 0 8px 8px 0;
}

form.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
  margin-bottom: 16px;
}

form.filters label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--bc-text-secondary);
}

input, select, textarea {
  padding: 6px 8px;
  border: 1px solid var(--bc-border);
  border-radius: 6px;
  background: var(--bc-surface);
  color: var(--bc-text);
  font: inherit;
}

textarea { min-height: 80px; }

code, pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

pre {
  background: var(--bc-bg);
  padding: 8px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 4px 0 0;
}

.hint { color: var(--bc-text-secondary); font-size: 0.8125rem; }

.pagination {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
`;
