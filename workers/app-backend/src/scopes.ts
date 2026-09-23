// Whether a token's granted scopes include everything the app now requires.
// Used to re-run token exchange after shopify.app.toml's scopes grow: the
// stored token keeps its old scopes until it's replaced. Shopify grants
// write_X as implying read_X, and may report only the write scope.
export function scopesCover(granted: string, required: string): boolean {
	const have = new Set(split(granted));
	return split(required).every(
		(scope) => have.has(scope) || (scope.startsWith("read_") && have.has(`write_${scope.slice(5)}`)),
	);
}

function split(scopes: string): string[] {
	return scopes.split(",").map((s) => s.trim()).filter(Boolean);
}
