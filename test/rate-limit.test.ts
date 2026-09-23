import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../shared/rate-limit.ts";

test("allows up to the max requests within the window", () => {
	const limiter = createRateLimiter(3, 1000);
	assert.equal(limiter.allow("ip1", 0), true);
	assert.equal(limiter.allow("ip1", 10), true);
	assert.equal(limiter.allow("ip1", 20), true);
	assert.equal(limiter.allow("ip1", 30), false);
});

test("different keys are tracked independently", () => {
	const limiter = createRateLimiter(1, 1000);
	assert.equal(limiter.allow("ip1", 0), true);
	assert.equal(limiter.allow("ip2", 0), true);
	assert.equal(limiter.allow("ip1", 0), false);
});

test("old hits fall out of the window, freeing up capacity again", () => {
	const limiter = createRateLimiter(1, 1000);
	assert.equal(limiter.allow("ip1", 0), true);
	assert.equal(limiter.allow("ip1", 999), false);
	assert.equal(limiter.allow("ip1", 1001), true);
});
