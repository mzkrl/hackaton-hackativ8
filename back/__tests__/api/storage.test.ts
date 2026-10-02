import { beforeAll, describe, expect, test } from "bun:test";

import { API_URL, createClient } from "../helpers/client";
import { sequenceById } from "../helpers/db";
import { assertStackReady } from "../helpers/setup";

const api = createClient();

beforeAll(async () => {
	await assertStackReady(API_URL);
});

describe("object storage", () => {
	test("reports the configured bucket as healthy", async () => {
		api.clearSession();
		await api.createUser("storage-health");

		const result = await api.request("/storage/health");

		expect(result.status).toBe(200);
		expect(result.body.status).toBe("ok");
		expect(result.body.bucket).toBe(process.env.S3_BUCKET);
	});

	// Generous timeout: this is the only test that makes a real external call to
	// object storage several times, over a network hop to the VPS. The default
	// Bun timeout is too tight for it on a slow link, which showed up as an
	// intermittent failure rather than an honest one.
	test("round-trips an object through upload, presigned GET, and delete", async () => {
		api.clearSession();
		await api.createUser("storage-roundtrip");

		const projectId = await api.createProject("Storage project");
		const fasta = ">probe_investigation\nACGTACGTACGT\n";

		const upload = await api.upload(projectId, "probe.fasta", fasta);

		expect(upload.status).toBe(201);

		const objectKey = upload.body.data.objectKey as string;
		const sequenceId = upload.body.data.sequenceId as string;

		expect(objectKey).toContain(projectId);
		expect(upload.body.data.sizeBytes).toBe(fasta.length);

		// the sequence row is written alongside the object
		const row = await sequenceById(sequenceId);

		expect(row[0]!.object_key).toBe(objectKey);
		expect(row[0]!.original_filename).toBe("probe.fasta");

		// the presigned URL resolves to the exact bytes we uploaded
		const signed = await api.request(`/storage/${objectKey}`);

		expect(signed.status).toBe(200);

		const downloaded = await fetch(signed.body.data.downloadUrl as string);

		expect(downloaded.status).toBe(200);
		expect(await downloaded.text()).toBe(fasta);

		// delete removes the object and detaches the key from the sequence
		const removed = await api.request(`/storage/${objectKey}`, { method: "DELETE" });

		expect(removed.status).toBe(200);
		expect(removed.body.data.deleted).toBe(true);

		const after = await sequenceById(sequenceId);

		expect(after[0]!.object_key).toBeNull();
	}, 60_000);

	test("a presigned PUT writes directly to object storage", async () => {
		api.clearSession();
		await api.createUser("storage-presign");

		const projectId = await api.createProject("Presign project");

		const presign = await api.post("/storage/presign", {
			projectId,
			filename: "direct.fasta",
			contentType: "text/plain",
		});

		expect(presign.status).toBe(201);

		const put = await fetch(presign.body.data.uploadUrl as string, {
			method: "PUT",
			headers: { "content-type": "text/plain" },
			body: "direct-put-body",
		});

		expect(put.status).toBe(200);

		const fetched = await fetch(
			(await api.request(`/storage/${presign.body.data.objectKey}`)).body.data.downloadUrl as string,
		);

		expect(await fetched.text()).toBe("direct-put-body");
	}, 60_000);

	test("refuses a filename outside the allowed set", async () => {
		api.clearSession();
		await api.createUser("storage-guard");

		const projectId = await api.createProject("Guarded project");
		const attempt = await api.post("/storage/presign", {
			projectId,
			filename: "payload.exe",
		});

		expect(attempt.status).toBe(422);
	});

	test("hides another user's object behind 404", async () => {
		api.clearSession();
		await api.createUser("storage-owner");

		const projectId = await api.createProject("Owned project");
		const upload = await api.upload(projectId, "private.fasta", "acgt");
		const objectKey = upload.body.data.objectKey as string;

		api.clearSession();
		await api.createUser("storage-intruder");

		expect((await api.request(`/storage/${objectKey}`)).status).toBe(404);
		expect((await api.request(`/storage/${objectKey}`, { method: "DELETE" })).status).toBe(404);
	}, 60_000);

	test("refuses an anonymous upload", async () => {
		api.clearSession();
		const projectId = "00000000-0000-4000-8000-000000000000";

		expect((await api.upload(projectId, "anon.fasta", "acgt")).status).toBe(401);
	});
});
