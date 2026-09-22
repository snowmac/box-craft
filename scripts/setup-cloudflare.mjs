#!/usr/bin/env node
// Provisions the Cloudflare side of workers/webhook-consumer and
// workers/app-backend: creates the SHOP_TOKENS KV namespace, sets
// secrets, deploys both Workers (direct upload — creates them on the
// account if they don't exist yet), and wires the resulting app-backend
// URL back into its own wrangler.toml and shopify-app/shopify.app.toml.
//
// Prerequisites (all local, none of this runs in the Claude session):
//   1. `npx wrangler login` — this script assumes you're already
//      authenticated; it does not attempt interactive login itself.
//   2. Two env vars set before running:
//        SHOPIFY_CLIENT_SECRET   — Partner Dashboard → your app → API credentials
//        SHOPIFY_WEBHOOK_SECRET  — same place; can reuse one value app-wide
//
// Usage:
//   SHOPIFY_CLIENT_SECRET=... SHOPIFY_WEBHOOK_SECRET=... \
//     node scripts/setup-cloudflare.mjs
//
// Safe to re-run: skips KV namespace creation if one's already wired in,
// and `wrangler secret put`/`wrangler deploy` are both naturally
// idempotent.
//
// What this script deliberately does NOT do (see printed summary at the
// end, and specs/product/assumptions.md):
//   - Git-connect either Worker to a Cloudflare Workers Build project
//     (auto-deploy-on-push) — that's dashboard-only, no CLI/API for it.
//   - Anything on the Shopify side (Partner Dashboard config, Managed
//     Pricing, `shopify app deploy`) — needs `shopify login`, out of
//     scope for a script that assumes only `wrangler login`.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const webhookConsumerDir = path.join(repoRoot, "workers/webhook-consumer");
const appBackendDir = path.join(repoRoot, "workers/app-backend");
const appBackendWranglerToml = path.join(appBackendDir, "wrangler.toml");
const shopifyAppToml = path.join(repoRoot, "shopify-app/shopify.app.toml");

function log(step, message) {
	console.log(`\n[${step}] ${message}`);
}

function fail(message) {
	console.error(`\nError: ${message}`);
	process.exit(1);
}

function run(cmd, args, opts = {}) {
	const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
	if (result.status !== 0) {
		console.error(result.stdout ?? "");
		console.error(result.stderr ?? "");
		fail(`Command failed: ${cmd} ${args.join(" ")}`);
	}
	return result.stdout ?? "";
}

// --- Preflight ---------------------------------------------------------

log("preflight", "Checking wrangler authentication...");
const whoami = spawnSync("npx", ["wrangler", "whoami"], { encoding: "utf8" });
if (whoami.status !== 0 || /not authenticated/i.test(whoami.stdout ?? "")) {
	fail("Not authenticated. Run `npx wrangler login` first, then re-run this script.");
}
console.log(whoami.stdout.trim());

const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
if (!clientSecret || !webhookSecret) {
	fail(
		"Missing SHOPIFY_CLIENT_SECRET and/or SHOPIFY_WEBHOOK_SECRET env vars. " +
			"Get both from the Partner Dashboard → your app → API credentials, then re-run:\n" +
			"  SHOPIFY_CLIENT_SECRET=... SHOPIFY_WEBHOOK_SECRET=... node scripts/setup-cloudflare.mjs",
	);
}

// --- Step 1: SHOP_TOKENS KV namespace for app-backend -------------------

let appBackendToml = readFileSync(appBackendWranglerToml, "utf8");
const hasActiveBinding = /^\[\[kv_namespaces\]\]/m.test(appBackendToml);

if (hasActiveBinding) {
	log("kv", "SHOP_TOKENS binding already present in wrangler.toml, skipping creation.");
} else {
	log("kv", "Creating SHOP_TOKENS KV namespace...");
	const output = run("npx", ["wrangler", "kv", "namespace", "create", "SHOP_TOKENS"], {
		cwd: appBackendDir,
	});
	console.log(output.trim());

	const match = output.match(/id\s*=\s*"([a-f0-9]+)"/);
	if (!match) {
		fail(
			"Couldn't parse a namespace id out of `wrangler kv namespace create` output. " +
				"Add the [[kv_namespaces]] block to workers/app-backend/wrangler.toml by hand using the id shown above.",
		);
	}
	const namespaceId = match[1];

	appBackendToml = appBackendToml.replace(
		/# \[\[kv_namespaces\]\]\n# binding = "SHOP_TOKENS"\n# id = ""/,
		`[[kv_namespaces]]\nbinding = "SHOP_TOKENS"\nid = "${namespaceId}"`,
	);
	writeFileSync(appBackendWranglerToml, appBackendToml);
	log("kv", `Wired namespace id ${namespaceId} into workers/app-backend/wrangler.toml`);
}

// --- Step 2: secrets -----------------------------------------------------

function putSecret(dir, name, value) {
	log("secret", `Setting ${name} on ${path.relative(repoRoot, dir)}...`);
	const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
		cwd: dir,
		input: value,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		console.error(result.stdout ?? "");
		console.error(result.stderr ?? "");
		fail(`Failed to set ${name} on ${dir}`);
	}
}

putSecret(webhookConsumerDir, "SHOPIFY_WEBHOOK_SECRET", webhookSecret);
putSecret(appBackendDir, "SHOPIFY_CLIENT_SECRET", clientSecret);
putSecret(appBackendDir, "SHOPIFY_WEBHOOK_SECRET", webhookSecret);

// --- Step 3: deploy webhook-consumer -------------------------------------

log("deploy", "Deploying webhook-consumer...");
console.log(run("npx", ["wrangler", "deploy"], { cwd: webhookConsumerDir }));

// --- Step 4: deploy app-backend, capture its URL -------------------------

log("deploy", "Deploying app-backend...");
const deployOutput = run("npx", ["wrangler", "deploy"], { cwd: appBackendDir });
console.log(deployOutput);

const urlMatch = deployOutput.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/);
if (!urlMatch) {
	fail(
		"Deployed, but couldn't find the *.workers.dev URL in wrangler's output. " +
			"Copy it from the output above and set APP_URL in workers/app-backend/wrangler.toml " +
			"and application_url/redirect_urls in shopify-app/shopify.app.toml by hand, then re-run " +
			"`npx wrangler deploy` from workers/app-backend so the new APP_URL var takes effect.",
	);
}
const appUrl = urlMatch[0];
log("url", `Deployed app-backend at ${appUrl}`);

// --- Step 5: wire the real URL into config -------------------------------

appBackendToml = readFileSync(appBackendWranglerToml, "utf8");
appBackendToml = appBackendToml.replace(
	/APP_URL = "https:\/\/REPLACE_WITH_APP_URL"/,
	`APP_URL = "${appUrl}"`,
);
writeFileSync(appBackendWranglerToml, appBackendToml);

let appToml = readFileSync(shopifyAppToml, "utf8");
appToml = appToml.replace(
	/application_url = "https:\/\/REPLACE_WITH_APP_URL"/,
	`application_url = "${appUrl}"`,
);
appToml = appToml.replace(
	/redirect_urls = \[ "https:\/\/REPLACE_WITH_APP_URL\/auth\/callback" \]/,
	`redirect_urls = [ "${appUrl}/auth/callback" ]`,
);
writeFileSync(shopifyAppToml, appToml);
log("config", "Updated APP_URL in wrangler.toml and application_url/redirect_urls in shopify.app.toml");

// --- Step 6: redeploy app-backend so it picks up the new APP_URL var ----

log("deploy", "Redeploying app-backend with the real APP_URL...");
console.log(run("npx", ["wrangler", "deploy"], { cwd: appBackendDir }));

// --- Summary ---------------------------------------------------------------

console.log(`
Done. Deployed:
  - workers/webhook-consumer  (secret set, live)
  - workers/app-backend       (secrets set, live at ${appUrl})

Still needed — none of this is scriptable with just a Cloudflare login:
  1. Git-connect both Workers to Cloudflare Workers Build projects if you
     want auto-deploy-on-push (Workers & Pages → Import a repository →
     Root directory = workers/webhook-consumer or workers/app-backend).
     They're already live via this script's direct deploy either way.
  2. Push the updated shopify.app.toml config to your Partner app —
     needs \`shopify login\` (out of scope here):
       cd shopify-app && shopify app deploy
     This registers the real redirect URL and the app/uninstalled
     webhook subscription with Shopify.
  3. Configure Managed Pricing plans in the Partner Dashboard.
  4. Create the dev store (2+ locations, split inventory) and a custom
     app on it for SHOPIFY_ADMIN_ACCESS_TOKEN, then run scripts/backfill.ts.

Don't forget to commit the config changes this script made:
  git add workers/app-backend/wrangler.toml shopify-app/shopify.app.toml
  git commit -m "Wire in real app-backend deploy URL"
  git push
`);
