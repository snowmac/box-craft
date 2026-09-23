import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAdminPage } from "../src/admin/page.ts";

test("renders the shell with all five cards", () => {
	const html = renderAdminPage({ clientId: "client123", installed: true });
	for (const id of ["setup", "performance", "boxes", "guardrail", "sync"]) {
		assert.match(html, new RegExp(`data-card="${id}"`));
	}
});

test("installed=true renders no setup-failed banner", () => {
	const html = renderAdminPage({ clientId: "client123", installed: true });
	assert.doesNotMatch(html, /data-setup-banner/);
});

test("installed=false renders the setup-failed banner with a retry button", () => {
	const html = renderAdminPage({ clientId: "client123", installed: false });
	assert.match(html, /data-setup-banner/);
	assert.match(html, /data-retry-setup/);
	assert.match(html, /setup didn't finish/);
});

test("carries the shopify-api-key meta tag and App Bridge script for the given client id", () => {
	const html = renderAdminPage({ clientId: "my-client-id", installed: true });
	assert.match(html, /<meta name="shopify-api-key" content="my-client-id">/);
	assert.match(html, /cdn\.shopify\.com\/shopifycloud\/app-bridge\.js/);
});

test("references admin.css and admin.js with a version query string", () => {
	const html = renderAdminPage({ clientId: "client123", installed: true });
	assert.match(html, /href="\/admin\.css\?v=\d+"/);
	assert.match(html, /src="\/admin\.js\?v=\d+"/);
});
