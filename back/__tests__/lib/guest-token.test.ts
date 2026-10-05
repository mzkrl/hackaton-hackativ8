import { describe, expect, test } from "bun:test";

import { isGuestToken, newGuestToken } from "../../src/lib/current-user";

/**
 * The guest token is simultaneously a session credential and the discriminator
 * that routes `resolvePrincipal` to the guest branch. So the shape is not
 * cosmetic: a value that passes the prefix check but not the body check would
 * either be misread as a guest or, on the claim route, name a session that can
 * never exist while looking like a successful claim.
 */
describe("isGuestToken", () => {
	const body = (chars: string) => `gs_${chars}`;

	test("accepts a freshly minted token", () => {
		expect(isGuestToken(newGuestToken())).toBe(true);
	});

	test("accepts the exact 64-hex shape", () => {
		expect(isGuestToken(body("a".repeat(64)))).toBe(true);
		expect(isGuestToken(body("0123456789abcdef".repeat(4)))).toBe(true);
	});

	test("rejects the right length in the wrong alphabet", () => {
		// Uppercase would be a different string than the one stored, and non-hex
		// is not a byte `toString(16)` could ever emit.
		expect(isGuestToken(body("A".repeat(64)))).toBe(false);
		expect(isGuestToken(body("g".repeat(64)))).toBe(false);
		expect(isGuestToken(body("0".repeat(63) + "!"))).toBe(false);
		expect(isGuestToken(body("0".repeat(63) + " "))).toBe(false);
	});

	test("rejects any length but 64", () => {
		expect(isGuestToken(body(""))).toBe(false);
		expect(isGuestToken(body("a".repeat(63)))).toBe(false);
		expect(isGuestToken(body("a".repeat(65)))).toBe(false);
		expect(isGuestToken(body("a".repeat(128)))).toBe(false);
	});

	test("rejects a missing or wrong prefix", () => {
		expect(isGuestToken("a".repeat(64))).toBe(false);
		expect(isGuestToken(`GS_${"a".repeat(64)}`)).toBe(false);
		expect(isGuestToken(` gs_${"a".repeat(64)}`)).toBe(false);
		expect(isGuestToken(`gs _${"a".repeat(64)}`)).toBe(false);
	});

	test("does not accept a signed user token", () => {
		expect(isGuestToken("v1.abc.def")).toBe(false);
	});
});

describe("newGuestToken", () => {
	test("mints 32 bytes of entropy per token", () => {
		const token = newGuestToken();

		expect(token.startsWith("gs_")).toBe(true);
		expect(token.slice(3)).toHaveLength(64);
		expect(isGuestToken(token)).toBe(true);
	});

	test("does not repeat", () => {
		const tokens = new Set(Array.from({ length: 500 }, () => newGuestToken()));

		// A collision here means the random source is broken, and every colliding
		// guest would silently share one session's data.
		expect(tokens.size).toBe(500);
	});

	test("zero-pads bytes below 0x10", () => {
		// Without padding the hex string would be short and the token would fail
		// its own length check, so this is pinned by the format test above; this
		// asserts the shape directly over many samples.
		for (const token of Array.from({ length: 200 }, () => newGuestToken())) {
			expect(token).toMatch(/^gs_[0-9a-f]{64}$/);
		}
	});
});
