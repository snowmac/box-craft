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
`;
