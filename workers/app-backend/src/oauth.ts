// Pure OAuth install-flow logic, kept independent of the Worker runtime so
// it's directly unit-testable (see ../test/oauth.test.ts). index.ts wires
// this into actual routes.

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Validates that a `shop` query param is a genuine *.myshopify.com host
// before it's ever used to build a redirect URL or an API request target.
// Without this, a `shop` param could be used to redirect a merchant
// somewhere attacker-controlled, or make this Worker issue requests to an
// arbitrary host (SSRF) during token exchange.
export function isValidShopDomain(shop: string): boolean {
	return SHOP_DOMAIN_PATTERN.test(shop);
}

export interface AuthorizeUrlParams {
	shop: string;
	clientId: string;
	scopes: string;
	redirectUri: string;
	state: string;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
	const url = new URL(`https://${params.shop}/admin/oauth/authorize`);
	url.searchParams.set("client_id", params.clientId);
	url.searchParams.set("scope", params.scopes);
	url.searchParams.set("redirect_uri", params.redirectUri);
	url.searchParams.set("state", params.state);
	return url.toString();
}

export interface TokenExchangeRequest {
	url: string;
	body: string;
}

export function buildTokenExchangeRequest(
	shop: string,
	clientId: string,
	clientSecret: string,
	code: string,
): TokenExchangeRequest {
	return {
		url: `https://${shop}/admin/oauth/access_token`,
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
		}),
	};
}

// Where a merchant lands after a successful install — inside the embedded
// app in Shopify admin, not on this Worker's bare URL.
export function buildEmbeddedAppUrl(shop: string, clientId: string): string {
	return `https://${shop}/admin/apps/${clientId}`;
}

export function generateState(): string {
	return crypto.randomUUID();
}
