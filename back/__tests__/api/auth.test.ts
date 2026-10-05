import { beforeAll, describe, expect, test } from "bun:test";

import { API_URL, PASSWORD, createClient } from "../helpers/client";
import { userByEmail } from "../helpers/db";
import { assertStackReady } from "../helpers/setup";

const api = createClient();

beforeAll(async () => {
	await assertStackReady(API_URL);
});

describe("register", () => {
	test("creates the user and hides the password hash", async () => {
		api.clearSession();
		const email = `auth-${crypto.randomUUID().slice(0, 8)}@vps.test`;
		const result = await api.post(
			"/auth/register",
			{ email, password: PASSWORD, name: "Auth probe" },
			false,
		);

		expect(result.status).toBe(201);
		expect(result.body.data.user.email).toBe(email);
		expect(result.body.data.user).not.toHaveProperty("passwordHash");
	});

	test("sets an HttpOnly, SameSite=Lax session cookie", async () => {
		api.clearSession();
		const email = `cookie-${crypto.randomUUID().slice(0, 8)}@vps.test`;
		const result = await api.post(
			"/auth/register",
			{ email, password: PASSWORD, name: "Cookie probe" },
			false,
		);
		const setCookie = result.headers.get("set-cookie")!;

		expect(result.status).toBe(201);
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Lax");
		expect(setCookie.startsWith("gia_session=")).toBe(true);
	});

	test("rejects a duplicate email with 409", async () => {
		api.clearSession();
		const email = `dupe-${crypto.randomUUID().slice(0, 8)}@vps.test`;
		const body = { email, password: PASSWORD, name: "Dupe" };

		expect((await api.post("/auth/register", body, false)).status).toBe(201);
		expect((await api.post("/auth/register", body, false)).status).toBe(409);
	});

	test("rejects a malformed email and a short password", async () => {
		api.clearSession();

		expect(
			(await api.post("/auth/register", { email: "not-an-email", password: PASSWORD, name: "x" }, false))
				.status,
		).toBe(422);

		expect(
			(
				await api.post(
					"/auth/register",
					{ email: `short-${crypto.randomUUID().slice(0, 6)}@vps.test`, password: "a", name: "x" },
					false,
				)
			).status,
		).toBe(422);
	});

	test("persists a PBKDF2-SHA512 hash rather than the password", async () => {
		api.clearSession();
		const email = `hash-${crypto.randomUUID().slice(0, 8)}@vps.test`;

		await api.post("/auth/register", { email, password: PASSWORD, name: "Hash" }, false);

		const rows = await userByEmail(email);

		expect(rows).toHaveLength(1);

		const hash = String(rows[0]!.password_hash);

		expect(hash.startsWith("pbkdf2-sha512$")).toBe(true);
		expect(hash).not.toContain(PASSWORD);
	}, 30_000);
});

describe("login", () => {
	test("returns a generic error for a wrong password", async () => {
		api.clearSession();
		const { email } = await api.createUser("login-wrong");
		const result = await api.post("/auth/login", { email, password: "Wrong-Password-9" }, false);

		expect(result.status).toBe(401);
		expect(result.body.error.message).toBe("Invalid email or password.");
	});

	test("returns the same generic error for an unknown user", async () => {
		api.clearSession();
		const result = await api.post(
			"/auth/login",
			{ email: `nobody-${crypto.randomUUID().slice(0, 8)}@vps.test`, password: PASSWORD },
			false,
		);

		expect(result.status).toBe(401);
		expect(result.body.error.message).toBe("Invalid email or password.");
	});

	test("accepts a case-insensitive email and clears the cookie on logout", async () => {
		api.clearSession();
		const { email } = await api.createUser("login-ok");

		api.clearSession();

		const login = await api.post("/auth/login", { email: email.toUpperCase(), password: PASSWORD }, false);

		expect(login.status).toBe(200);
		expect((await api.request("/auth/me")).body.data.user.email).toBe(email);

		const out = await api.request("/auth/logout", { method: "POST" });

		expect(out.status).toBe(200);
		expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
	},
	// Several PBKDF2 operations at 210k iterations; bun's 5s default is too tight.
	30_000,
	);
});

describe("session enforcement", () => {
	test("me resolves the session user", async () => {
		api.clearSession();
		const { email } = await api.createUser("me");

		expect((await api.request("/auth/me")).body.data.user.email).toBe(email);
	});

	test("a tampered cookie fails closed with 401", async () => {
		api.clearSession();
		await api.createUser("tamper");
		const good = api.cookie!;

		api.cookie = `${good.slice(0, -3)}xyz`;
		expect((await api.request("/auth/me")).status).toBe(401);

		api.cookie = "gia_session=garbage";
		expect((await api.request("/auth/me")).status).toBe(401);
	});

	test("no cookie at all fails closed with 401", async () => {
		api.clearSession();
		expect((await api.request("/auth/me")).status).toBe(401);
	});
});
