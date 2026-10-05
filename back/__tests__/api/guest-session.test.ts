import { beforeAll, describe, expect, test } from "bun:test";

import { API_URL, createClient } from "../helpers/client";
import { guestSessionExists, projectOwnership } from "../helpers/db";
import { assertStackReady } from "../helpers/setup";

/**
 * Guest accounts are the difference between "let me try this" and "sign up
 * before you can touch it", so these tests care about two things above all: a
 * guest reaches the same routes a user does, and a guest cannot reach anyone
 * else's. A claim test that only walks the happy path would still pass if
 * ownership leaked freely between two anonymous visitors.
 *
 * Every test builds its own client, so no guest session survives into the next.
 */
const api = createClient();

beforeAll(async () => {
	await assertStackReady(API_URL);
});

describe("guest session", () => {
	test("issues an HttpOnly session and reports a guest principal", async () => {
		api.clearSession();
		const issued = await api.post("/auth/guest", {}, false);

		expect(issued.status).toBe(201);
		expect(issued.body.data.kind).toBe("guest");
		expect(issued.body.data.id).toMatch(/^gs_[0-9a-f]{64}$/);

		// The cookie is the credential, so script must not be able to read it.
		// Asserted on the raw header because the client jar keeps only the pair.
		expect(issued.headers.get("set-cookie")).toContain("HttpOnly");
		expect(issued.headers.get("set-cookie")).toContain("SameSite");

		const me = await api.get("/auth/me");

		expect(me.status).toBe(200);
		expect(me.body.data.kind).toBe("guest");
		expect(me.body.data.expiresAt).toBeTruthy();
		// A guest has no account, so the user half of the union must be absent
		// rather than null — the frontend branches on `kind`, and a null `user`
		// would make that branch quietly render an empty account block.
		expect("user" in me.body.data).toBe(false);
	});

	test("gives each guest a distinct token", async () => {
		const other = createClient();
		api.clearSession();
		other.clearSession();

		const first = await api.createGuest();
		const second = await other.createGuest();

		expect(first.id).not.toBe(second.id);
	});
});

describe("guest ownership", () => {
	test("creates and lists its own projects", async () => {
		api.clearSession();
		await api.createGuest();
		const projectId = await api.createProject("Guest project");

		// Ownership lives on the project row, so a guest project must have no
		// user at all — a stray null-vs-absent mismatch here is what makes a
		// later claim silently drop the row instead of moving it.
		expect(await projectOwnership(projectId)).toEqual({ userId: null, guestId: expect.stringMatching(/^gs_/) });

		const listed = await api.get("/projects");

		expect(listed.status).toBe(200);
		expect(listed.body.data.some((p: { id: string }) => p.id === projectId)).toBe(true);
	});

	test("cannot read or mutate another guest's project", async () => {
		const owner = createClient();
		const stranger = createClient();
		owner.clearSession();
		stranger.clearSession();

		const guest = await owner.createGuest();
		const projectId = await owner.createProject("Private to one guest");

		await stranger.createGuest();

		expect((await stranger.get(`/projects/${projectId}`)).status).toBe(404);
		expect((await stranger.get(`/projects/${projectId}/sequences`)).status).toBe(404);
		expect(
			(
				await stranger.post(`/projects/${projectId}/sequences`, {
					format: "fasta",
					recordId: "probe|1",
					sequenceLength: 12,
					sequenceHash: "hash-probe",
				})
			).status,
		).toBe(404);

		expect((await projectOwnership(projectId)).guestId).toBe(guest.id);
	});
});

describe("guest claim", () => {
	test("moves guest work onto the account that signed up", async () => {
		api.clearSession();
		const guest = await api.createGuest();
		const projectId = await api.createProject("Claim me");

		// Registering overwrites the cookie with a user session, which is
		// exactly the state the real frontend is in when it claims.
		const { id: userId } = await api.createUser("claimer");

		const claimed = await api.post("/guest/claim", { guestId: guest.id });

		expect(claimed.status).toBe(200);
		expect(await projectOwnership(projectId)).toEqual({ userId, guestId: null });
		expect(await guestSessionExists(guest.id)).toBe(false);

		const me = await api.get("/auth/me");

		expect(me.body.data.kind).toBe("user");

		const listed = await api.get("/projects");

		expect(listed.body.data.some((p: { id: string }) => p.id === projectId)).toBe(true);
	}, 30_000);

	test("keeps the sequence tree attached to the moved project", async () => {
		api.clearSession();
		const guest = await api.createGuest();
		const projectId = await api.createProject("With children");

		expect((await api.createSequence(projectId)).status).toBe(201);

		await api.createUser("claimer-tree");
		await api.post("/guest/claim", { guestId: guest.id });

		// Ownership of a sequence is derived through its project, so if the
		// claim moved the project but broke that join the row would be orphaned
		// and the new owner would see an empty board.
		const rows = await api.get(`/projects/${projectId}/sequences`);

		expect(rows.status).toBe(200);
		expect(rows.body.data).toHaveLength(1);
	});

	test("is idempotent", async () => {
		api.clearSession();
		const guest = await api.createGuest();
		const projectId = await api.createProject("Claim twice");

		await api.createUser("twice");

		expect((await api.post("/guest/claim", { guestId: guest.id })).status).toBe(200);
		expect((await api.post("/guest/claim", { guestId: guest.id })).status).toBe(200);

		expect((await projectOwnership(projectId)).guestId).toBeNull();
	});

	test("rejects a malformed guest token with 422", async () => {
		api.clearSession();
		await api.createUser("malformed");

		for (const guestId of ["", "nope", "gs_", "gs_zzzz", `gs_${"a".repeat(63)}`]) {
			expect((await api.post("/guest/claim", { guestId })).status).toBe(422);
		}
	});

	test("claims nothing for an unknown but well-formed token", async () => {
		api.clearSession();
		const guest = await api.createGuest();
		const projectId = await api.createProject("Untouched");

		await api.createUser("unknown-token");

		// Idempotence means replaying a claim never errors, including one whose
		// guest session was already consumed or expired.
		expect((await api.post("/guest/claim", { guestId: `gs_${"0".repeat(64)}` })).status).toBe(200);

		expect((await projectOwnership(projectId)).guestId).toBe(guest.id);
	});

	test("refuses a claim from a caller with no session", async () => {
		const stranger = createClient();
		stranger.clearSession();

		expect((await stranger.post("/guest/claim", { guestId: `gs_${"0".repeat(64)}` })).status).toBe(401);
	});

	test("refuses a claim from a guest, which has no account to move work to", async () => {
		api.clearSession();
		const guest = await api.createGuest();

		expect((await api.post("/guest/claim", { guestId: guest.id })).status).toBe(401);
	});
});
