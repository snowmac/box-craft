import { test } from "node:test";
import assert from "node:assert/strict";
import {
	signOpsSession,
	verifyOpsSession,
	verifyOpsToken,
	readCookie,
	sessionCookieHeader,
	clearedSessionCookieHeader,
	OPS_SESSION_COOKIE,
	SESSION_MAX_AGE_SECONDS,
} from "../src/auth.ts";

const OPS_TOKEN = "correct-horse-battery-staple";

test("signOpsSession is deterministic for the same token", async () => {
	const a = await signOpsSession(OPS_TOKEN);
	const b = await signOpsSession(OPS_TOKEN);
	assert.equal(a, b);
});

test("signOpsSession never just echoes the token back", async () => {
	const signed = await signOpsSession(OPS_TOKEN);
	assert.notEqual(signed, OPS_TOKEN);
});

test("different tokens sign to different session values", async () => {
	const a = await signOpsSession(OPS_TOKEN);
	const b = await signOpsSession("a-totally-different-token");
	assert.notEqual(a, b);
});

test("verifyOpsSession accepts a cookie signed with the right token", async () => {
	const signed = await signOpsSession(OPS_TOKEN);
	assert.equal(await verifyOpsSession(signed, OPS_TOKEN), true);
});

test("verifyOpsSession rejects a cookie signed with the wrong token", async () => {
	const signed = await signOpsSession("wrong-token");
	assert.equal(await verifyOpsSession(signed, OPS_TOKEN), false);
});

test("verifyOpsSession rejects a missing cookie or missing token", async () => {
	assert.equal(await verifyOpsSession(null, OPS_TOKEN), false);
	assert.equal(await verifyOpsSession("something", ""), false);
});

test("verifyOpsToken accepts the exact configured token", () => {
	assert.equal(verifyOpsToken(OPS_TOKEN, OPS_TOKEN), true);
});

test("verifyOpsToken rejects anything else, including empty strings", () => {
	assert.equal(verifyOpsToken("wrong", OPS_TOKEN), false);
	assert.equal(verifyOpsToken("", OPS_TOKEN), false);
	assert.equal(verifyOpsToken(OPS_TOKEN, ""), false);
});

test("readCookie finds a named cookie among several", () => {
	const request = new Request("https://ops.example/", {
		headers: { Cookie: "a=1; box_craft_ops_session=abc123; b=2" },
	});
	assert.equal(readCookie(request, OPS_SESSION_COOKIE), "abc123");
});

test("readCookie returns null when the cookie isn't present", () => {
	const request = new Request("https://ops.example/", { headers: { Cookie: "a=1; b=2" } });
	assert.equal(readCookie(request, OPS_SESSION_COOKIE), null);
});

test("readCookie returns null with no Cookie header at all", () => {
	const request = new Request("https://ops.example/");
	assert.equal(readCookie(request, OPS_SESSION_COOKIE), null);
});

test("sessionCookieHeader sets HttpOnly, Secure, SameSite=Strict, and the max age", () => {
	const header = sessionCookieHeader("abc123");
	assert.match(header, /^box_craft_ops_session=abc123;/);
	assert.match(header, /HttpOnly/);
	assert.match(header, /Secure/);
	assert.match(header, /SameSite=Strict/);
	assert.match(header, new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}`));
});

test("clearedSessionCookieHeader expires the cookie immediately", () => {
	assert.match(clearedSessionCookieHeader(), /Max-Age=0/);
});
