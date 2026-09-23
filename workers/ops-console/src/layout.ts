// T14: shared page chrome for every protected view — nav, flash message,
// the console's one stylesheet/script. Plain HTML from template strings,
// same ground rules as the merchant admin page.
export const CONSOLE_ASSET_VERSION = "1";

const NAV_LINKS: Array<{ path: string; label: string }> = [
	{ path: "/", label: "Overview" },
	{ path: "/events", label: "Events" },
	{ path: "/errors", label: "Errors" },
	{ path: "/kv", label: "KV inspector" },
	{ path: "/guardrail-tester", label: "Guardrail tester" },
];

export interface FlashMessage {
	ok: boolean;
	message: string;
}

export function renderLayout(options: { title: string; activePath: string; body: string; flash?: FlashMessage | null }): string {
	const nav = NAV_LINKS.map(
		(link) =>
			`<a href="${link.path}" class="nav-link${options.activePath === link.path ? " is-active" : ""}">${link.label}</a>`,
	).join("");

	const flash = options.flash
		? `<div class="flash flash--${options.flash.ok ? "ok" : "error"}">${escapeHtml(options.flash.message)}</div>`
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} — BoxCraft Ops</title>
  <link rel="stylesheet" href="/console.css?v=${CONSOLE_ASSET_VERSION}">
</head>
<body>
  <div class="shell">
    <nav class="nav">
      <div class="nav__brand">BoxCraft Ops</div>
      ${nav}
      <form method="POST" action="/logout" class="nav__logout"><button type="submit" class="link-button">Log out</button></form>
    </nav>
    <main class="content">
      ${flash}
      <h1>${escapeHtml(options.title)}</h1>
      ${options.body}
    </main>
  </div>
  <script type="module" src="/console.js?v=${CONSOLE_ASSET_VERSION}"></script>
</body>
</html>`;
}

export function escapeHtml(value: unknown): string {
	return String(value ?? "").replace(/[&<>"']/g, (c) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
	);
}
