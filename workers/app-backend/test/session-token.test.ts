import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySessionToken } from "../src/session-token.ts";

const CLIENT_ID = "client123";
const SECRET = "shhh";
const NOW = 1_790_000_000;

function b64url(input: string | Buffer): string {
	return Buffer.from(input).toString("base64url");
}

function sign(payload: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }): string {
	const head = b64url(JSON.stringify(header));
	const body = b64url(JSON.stringify(payload));
	const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
	return `${head}.${body}.${sig}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		iss: "https://box-craft-demo.myshopify.com/admin",
		dest: "https://box-craft-demo.myshopify.com",
		aud: CLIENT_ID,
		sub: "1",
		exp: NOW + 60,
		nbf: NOW - 5,
		iat: NOW - 5,
		jti: "abc",
		...overrides,
	};
}

test("a valid session token yields the shop domain from dest", async () => {
	const result = await verifySessionToken(sign(claims()), CLIENT_ID, SECRET, NOW);
	assert.deepEqual(result, { shop: "box-craft-demo.myshopify.com" });
});

test("rejects a token signed with the wrong secret", async () => {
	assert.equal(await verifySessionToken(sign(claims(), "other"), CLIENT_ID, SECRET, NOW), null);
});

test("rejects a token with a tampered payload", async () => {
	const [head, , sig] = sign(claims()).split(".");
	const forged = `${head}.${b64url(JSON.stringify(claims({ dest: "https://victim.myshopify.com" })))}.${sig}`;
	assert.equal(await verifySessionToken(forged, CLIENT_ID, SECRET, NOW), null);
});

test("rejects a token issued for a different app", async () => {
	assert.equal(await verifySessionToken(sign(claims({ aud: "someone-else" })), CLIENT_ID, SECRET, NOW), null);
});

test("rejects an expired token", async () => {
	assert.equal(await verifySessionToken(sign(claims({ exp: NOW - 30 })), CLIENT_ID, SECRET, NOW), null);
});

test("rejects a token that isn't valid yet", async () => {
	assert.equal(await verifySessionToken(sign(claims({ nbf: NOW + 30 })), CLIENT_ID, SECRET, NOW), null);
});

test("rejects a non-HS256 algorithm (alg:none downgrade)", async () => {
	const head = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
	const body = b64url(JSON.stringify(claims()));
	assert.equal(await verifySessionToken(`${head}.${body}.`, CLIENT_ID, SECRET, NOW), null);
});

test("rejects a dest that isn't a myshopify.com shop", async () => {
	assert.equal(await verifySessionToken(sign(claims({ dest: "https://evil.com" })), CLIENT_ID, SECRET, NOW), null);
});

test("rejects malformed input", async () => {
	assert.equal(await verifySessionToken("not-a-jwt", CLIENT_ID, SECRET, NOW), null);
	assert.equal(await verifySessionToken("", CLIENT_ID, SECRET, NOW), null);
});
