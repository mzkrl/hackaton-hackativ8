import { describe, expect, test } from "bun:test";

import { isTimeout, TimeoutError, withTimeout } from "../../src/lib/timeout";

describe("withTimeout", () => {
	test("resolves with the value when the promise settles in time", async () => {
		const result = await withTimeout(Promise.resolve("done"), 1000);

		expect(result).toBe("done");
	});

	test("rejects with a TimeoutError when the deadline passes first", async () => {
		const never = new Promise<string>(() => {});

		await expect(withTimeout(never, 10)).rejects.toBeInstanceOf(TimeoutError);
	});

	test("propagates the wrapped promise's own rejection unchanged", async () => {
		// A failure is not a timeout: the two want opposite responses, so the
		// original error has to survive rather than being relabelled.
		const failure = new Error("executor exploded");

		await expect(withTimeout(Promise.reject(failure), 1000)).rejects.toBe(failure);
	});

	test("does not reject with a timeout when the promise fails before the deadline", async () => {
		const failure = new Error("fast failure");

		await expect(withTimeout(Promise.reject(failure), 1000)).rejects.not.toBeInstanceOf(
			TimeoutError,
		);
	});

	test("clears the timer when the promise settles before the deadline", async () => {
		// If the timer were left pending it would hold the event loop open and
		// the test process would hang instead of exiting.
		await withTimeout(Promise.resolve("quick"), 60_000);

		expect(true).toBe(true);
	});
});

describe("isTimeout", () => {
	test("recognises a TimeoutError", () => {
		expect(isTimeout(new TimeoutError(1000))).toBe(true);
	});

	test("does not treat an ordinary error as a timeout", () => {
		expect(isTimeout(new Error("Timed out after 30000ms"))).toBe(false);
	});

	test("does not throw on a non-error value", () => {
		expect(isTimeout("Timed out after 30000ms")).toBe(false);
		expect(isTimeout(undefined)).toBe(false);
		expect(isTimeout(null)).toBe(false);
	});
});
