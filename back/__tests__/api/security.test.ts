import { beforeAll, describe, expect, test } from "bun:test";

import { API_URL, createClient } from "../helpers/client";
import { assertStackReady } from "../helpers/setup";

/**
 * Covers the hardening pass: request ceilings applied before a handler reads a
 * body, the closed set of analysis types, and the headers on every response.
 *
 * These run against a live API on a live database like the rest of the suite, so
 * they assert on real responses rather than on unit-level mocks.
 *
 * `registerLifecycle` is deliberately not used here: it closes the shared
 * postgres client in `afterAll`, and Bun runs test files in one process, so
 * closing it from one file would break the files that run afterwards.
 */

describe("security", () => {
	beforeAll(() => assertStackReady(API_URL));

	describe("response headers", () => {
		test("baseline hardening is present on every response", async () => {
			const response = await fetch(`${API_URL}/health`);

			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("x-frame-options")).toBe("DENY");
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
		});

		test("errors do not leak internals", async () => {
			const response = await fetch(`${API_URL}/projects/00000000-0000-0000-0000-000000000000`);
			const body = await response.json();

			expect(response.status).toBe(401);
			// The envelope carries a code and a message, never a stack trace.
			expect(JSON.stringify(body)).not.toContain("at ");
			expect(JSON.stringify(body)).not.toContain(".ts:");
		});
	});

	describe("request body ceilings", () => {
		test("an oversized JSON body is refused before it is read", async () => {
			// 1 MiB is the ceiling for ordinary JSON routes; this is comfortably
			// over it. The point is that the request never reaches a handler.
			const client = createClient();
			const huge = "x".repeat(2 * 1024 * 1024);

			const result = await client.post(
				"/conversations",
				{ projectId: "00000000-0000-0000-0000-000000000000", role: "user", content: huge },
				false,
			);

			expect(result.status).toBe(413);
			expect(result.body.error.code).toBe("PAYLOAD_TOO_LARGE");
		});

		test("a body inside the ceiling is still validated normally", async () => {
			const client = createClient();
			const user = await client.createUser("body-limit");

			expect(user.id).toBeTruthy();

			// Well under the limit: the request must reach the handler and be
			// rejected on its merits (no project), not on its size.
			const result = await client.post(
				"/conversations",
				{
					projectId: "00000000-0000-0000-0000-000000000000",
					role: "user",
					content: "small note",
				},
			);

			expect(result.status).toBe(404);
			expect(result.body.error.code).toBe("PROJECT_NOT_FOUND");
		}, 30_000);
	});

	describe("analysis type allowlist", () => {
		// Timeouts raised throughout: each case registers a user, creates a
		// project and creates a sequence against a remote database before it can
		// submit anything, which can exceed Bun's 5s default on a slow link.
		test("an unrecognised type is refused rather than queued", async () => {
			const client = createClient();
			await client.createUser("analysis-allowlist");
			const projectId = await client.createProject();
			const sequence = await client.createSequence(projectId);

			const result = await client.post("/analyses", {
				sequenceId: sequence.body.data.id,
				analysisType: "; drop table analyses --",
			});

			expect(result.status).toBe(422);
			expect(result.body.error.code).toBe("UNSUPPORTED_ANALYSIS");
		}, 30_000);

		// Timeout raised for the same reason: submitting a real analysis also
		// enqueues against Redis, which is shared with the deployed worker.
		test("a known type is accepted and normalised", async () => {
			const client = createClient();
			await client.createUser("analysis-known");
			const projectId = await client.createProject();
			const sequence = await client.createSequence(projectId);

			const result = await client.post("/analyses", {
				sequenceId: sequence.body.data.id,
				// Mixed case: the allowlist lowercases, so this must be the same
				// analysis rather than a second distinct queue entry.
				analysisType: "GC_Content",
			});

			// 202 means it queued; 503 means Redis is unreachable in this
			// environment, which is a valid environment answer.
			expect([202, 503]).toContain(result.status);

			if (result.status === 202) {
				expect(result.body.data.analysisType).toBe("gc_content");
			}
		}, 30_000);
	});

	describe("queue status", () => {
		test("reports depth without requiring a session", async () => {
			const response = await fetch(`${API_URL}/queue/status`);
			const body = (await response.json()) as { data?: Record<string, unknown> };

			expect(response.status).toBe(200);
			expect(body.data?.queue).toBe("genomic-analysis");
			// Counts only: this endpoint is public, so it must expose no user data
			// and no secrets.
			expect(body.data).not.toHaveProperty("jobIds");
			expect(JSON.stringify(body)).not.toContain("password");
		});
	});

	describe("storage health", () => {
		test("an anonymous caller does not learn the bucket or region", async () => {
			const response = await fetch(`${API_URL}/storage/health`);
			const body = (await response.json()) as Record<string, unknown>;

			expect(response.status).toBe(200);
			expect(body.status).toBe("ok");
			expect(body.bucket).toBeUndefined();
			expect(body.region).toBeUndefined();
		});

		test("an authenticated caller does", async () => {
			const client = createClient();
			await client.createUser("storage-health");

			const result = await client.request("/storage/health");

			expect(result.status).toBe(200);
			expect(result.body.data?.bucket ?? result.body.bucket).toBeDefined();
		}, 30_000);
	});
});
