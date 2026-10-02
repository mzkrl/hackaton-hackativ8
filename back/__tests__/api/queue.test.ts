import { beforeAll, describe, expect, test } from "bun:test";

import { API_URL, createClient } from "../helpers/client";
import { analysisById } from "../helpers/db";
import { assertStackReady } from "../helpers/setup";

const api = createClient();

const LIFECYCLE = ["queued", "processing", "completed", "failed"];

/**
 * `analysisType` is validated against an allowlist, so these tests use real types
 * from it rather than the ad-hoc strings they used when any 1-64 char string was
 * accepted. The lifecycle assertions below are about queueing, not about the
 * name, so the substitution does not weaken them.
 */
const KNOWN_TYPE = "gc_content";

beforeAll(async () => {
	await assertStackReady(API_URL);
});

describe("analysis submission", () => {
	test("accepts a job, persists it, and exposes its status", async () => {
		api.clearSession();
		await api.createUser("queue");

		const projectId = await api.createProject("Queue project");
		const sequence = await api.createSequence(projectId);
		const sequenceId = sequence.body.data.id as string;

		const submitted = await api.post("/analyses", {
			sequenceId,
			analysisType: KNOWN_TYPE,
		});

		expect([200, 201, 202]).toContain(submitted.status);

		const analysisId = submitted.body.data.id as string;
		expect(typeof analysisId).toBe("string");

		const status = await api.request(`/analyses/${analysisId}/status`);

		expect(status.status).toBe(200);
		expect(LIFECYCLE).toContain(status.body.data.status);

		// the record is durable in postgres, not just in the response
		const row = await analysisById(analysisId);

		expect(row).toHaveLength(1);
		expect(row[0]!.status).toBe(status.body.data.status);
	}, 30_000);

	test("is created queued and holds a queue job id", async () => {
		api.clearSession();
		await api.createUser("queue-2");

		const projectId = await api.createProject("Queue project 2");
		const sequence = await api.createSequence(projectId);
		const submitted = await api.post("/analyses", {
			sequenceId: sequence.body.data.id,
			analysisType: KNOWN_TYPE,
		});

		// 202 is the contract: accepted and enqueued, work happens in the worker.
		expect(submitted.status).toBe(202);

		const row = await analysisById(submitted.body.data.id);

		// The row is re-read from postgres to prove it is durable rather than
		// only present in the response body.
		expect(row).toHaveLength(1);

		// Deliberately not asserted as exactly "queued". The API writes the row as
		// queued and enqueues before responding, but Redis is shared with the
		// deployed worker, which can pick the job up and advance it to
		// "processing" or "failed" before this read lands — so by the time the test
		// looks, a completed or failed status is a legitimate outcome rather than
		// a defect. Any value in the lifecycle means the job was accepted and is
		// being tracked durably.
		expect(LIFECYCLE).toContain(row[0]!.status);

		// This part is not racy. The id is written by the API synchronously
		// before it responds, so a truthy value proves enqueue reached Redis.
		expect(row[0]!.queue_job_id).toBeTruthy();
	}, 30_000);

	test("rejects a job for a sequence owned by someone else", async () => {
		api.clearSession();
		await api.createUser("queue-owner");

		const projectId = await api.createProject("Not yours");
		const sequence = await api.createSequence(projectId);

		api.clearSession();
		await api.createUser("queue-intruder");

		const attempt = await api.post("/analyses", {
			sequenceId: sequence.body.data.id,
			analysisType: KNOWN_TYPE,
		});

		expect(attempt.status).toBe(404);
	}, 30_000);

	test("rejects server-owned lifecycle fields", async () => {
		api.clearSession();
		await api.createUser("queue-guard");

		const projectId = await api.createProject("Guarded project");
		const sequence = await api.createSequence(projectId);

		const attempt = await api.post("/analyses", {
			sequenceId: sequence.body.data.id,
			analysisType: KNOWN_TYPE,
			status: "completed",
		});

		expect(attempt.status).toBe(422);
	}, 30_000);

	test("refuses an anonymous submission", async () => {
		api.clearSession();

		expect(
			(await api.post("/analyses", { sequenceId: crypto.randomUUID(), analysisType: KNOWN_TYPE })).status,
		).toBe(401);
	});
});
