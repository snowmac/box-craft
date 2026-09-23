// T11: the merchant admin page shell. Plain HTML from a template string
// (per the plan's ground rules — no React, no build step). T12 fills the
// card bodies in with real data via admin.js and the session-token
// authenticated /api/* routes (T5).

// Bump whenever admin.css/admin.js change in a way that matters — the
// query string it's appended as busts the long-cache headers those routes
// serve with (see index.ts), without needing a build step to hash content.
export const ADMIN_ASSET_VERSION = "1";

export interface AdminPageOptions {
	clientId: string;
	installed: boolean;
}

const CARDS: Array<{ id: string; title: string }> = [
	{ id: "setup", title: "Setup" },
	{ id: "performance", title: "Performance" },
	{ id: "boxes", title: "Boxes" },
	{ id: "guardrail", title: "Location guardrail" },
	{ id: "sync", title: "Inventory sync" },
];

export function renderAdminPage({ clientId, installed }: AdminPageOptions): string {
	const banner = installed
		? ""
		: `<div class="banner banner--error" data-setup-banner>
      <p>BoxCraft setup didn't finish. Reload to try again — if it keeps happening, reinstall the app.</p>
      <button type="button" class="button" data-retry-setup>Retry</button>
    </div>`;

	const cards = CARDS.map(
		({ id, title }) => `    <section class="card" data-card="${id}">
      <h2>${title}</h2>
      <div class="card__body" data-card-body>Loading…</div>
    </section>`,
	).join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BoxCraft</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <meta name="shopify-api-key" content="${clientId}">
  <link rel="stylesheet" href="/admin.css?v=${ADMIN_ASSET_VERSION}">
</head>
<body>
  <header class="page-header">
    <h1>BoxCraft</h1>
  </header>

  ${banner}

  <main class="cards">
${cards}
  </main>

  <script type="module" src="/admin.js?v=${ADMIN_ASSET_VERSION}"></script>
</body>
</html>`;
}
