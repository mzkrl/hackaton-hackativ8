import { beforeAll, describe, expect, test } from "bun:test";

import { API_URL, createClient } from "../helpers/client";
import { assertStackReady } from "../helpers/setup";

const api = createClient();

beforeAll(async () => {
	await assertStackReady(API_URL);
});

describe("project isolation", () => {
	test("creates a project and lists it for its owner", async () => {
		api.clearSession();
		await api.createUser("owner");

		const created = await api.post("/projects", { name: "My project" });

		expect(created.status).toBe(201);
		expect(created.body.data.name).toBe("My project");

		const list = await api.request("/projects");

		expect(list.body.data).toHaveLength(1);
		expect(list.body.data[0].id).toBe(created.body.data.id);
	});

	// Timeout raised: this case registers two users, creates a project and reads
	// it back, each a round trip to a remote database, which can exceed Bun's 5s
	// default on a slow link.
	test("hides another user's project behind 404", async () => {
		api.clearSession();
		await api.createUser("owner-2");
		const projectId = await api.createProject("Private");

		api.clearSession();
		await api.createUser("intruder");

		expect((await api.request("/projects")).body.data).toHaveLength(0);
		expect((await api.request(`/projects/${projectId}`)).status).toBe(404);
	}, 30_000);
});

describe("sequence ownership", () => {
	test("creates a sequence inside an owned project", async () => {
		api.clearSession();
		await api.createUser("seq-owner");
		const projectId = await api.createProject("Sequence project");

		const created = await api.createSequence(projectId);

		expect(created.status).toBe(201);
		expect(created.body.data.projectId).toBe(projectId);
	});

	test("rejects a sequence created in a project owned by someone else", async () => {
		api.clearSession();
		await api.createUser("seq-owner-2");
		const projectId = await api.createProject("Not yours");

		api.clearSession();
		await api.createUser("seq-intruder");

		expect((await api.createSequence(projectId)).status).toBe(404);
	});

	test("rejects server-owned fields on a sequence", async () => {
		api.clearSession();
		await api.createUser("seq-guard");
		const projectId = await api.createProject("Guarded");

		const attempt = await api.createSequence(projectId, { objectKey: "injected/key" });

		expect(attempt.status).toBe(422);
	});
});
