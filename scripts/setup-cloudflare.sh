#!/usr/bin/env bash
# Interactive wrapper around setup-cloudflare.mjs: prompts for the
# Shopify app's client secret with masked input (never echoed, never left
# in shell history) instead of requiring it as a plain env var on the
# command line, then hands off to the Node script.
#
# The secret itself still has to come from you — it's issued by Shopify
# at app registration and only ever shown in the Partner Dashboard
# (your app -> Client credentials). Nothing can generate or fetch it
# automatically. Prerequisite: `npx wrangler login` first.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${SHOPIFY_CLIENT_SECRET:-}" ]; then
	read -r -s -p "Shopify app client secret (Partner Dashboard -> your app -> Client credentials): " SHOPIFY_CLIENT_SECRET
	echo
fi

if [ -z "$SHOPIFY_CLIENT_SECRET" ]; then
	echo "No secret entered, aborting." >&2
	exit 1
fi

export SHOPIFY_CLIENT_SECRET
exec node scripts/setup-cloudflare.mjs
