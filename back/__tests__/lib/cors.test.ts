import { describe, expect, test } from "bun:test";

import { createApp } from "../../src/app";

/**
 * CORS is a pure, config-driven function of the request's `Origin`, so it is
 * tested here against an app built with its own allowlist instead of against the
 * running server on `TEST_API_URL`.
 *
 * That split is deliberate. When these assertions ran against the live server
 * they could only be made to pass by adding the test's origin to the operator's
 * real `CORS_ORIGINS`, which is backwards: a CORS failure is evidence about the
 * *configuration*, not something to widen until the assertion goes green. Testing
 * the rule directly means the origin under test is chosen by the test, the
 * allowlist is chosen by the test, and the real config is never touched.
 *
 * The same reasoning covers the reason a browser needs these headers at all: the
 * frontend is a separate origin reached through the tunnel, so the session
 * cookie is only sent back if `Access-Control-Allow-Origin` matches exactly.
 */
const ALLOWED = "https://app.example.test";
const ALSO_ALLOWED = "https://admin.example.test";
const NOT_ALLOWED = "https://evil.example.test";

/**
 * Builds an app whose CORS allowlist is exactly `corsOrigins`.
 *
 * `createApp()` reads `CORS_ORIGINS` once at construction, so the value has to be
 * in place for the call and restored straight after. The restore is in a
 * `finally` so a throw inside `createApp` cannot leak the override into whatever
 * runs next in this process.
 */
const appWithOrigins = (corsOrigins: string) => {
	const previous = process.env.CORS_ORIGINS;
	process.env.CORS_ORIGINS = corsOrigins;

	try {
		return createApp();
	} finally {
		if (previous === undefined) delete process.env.CORS_ORIGINS;
		else process.env.CORS_ORIGINS = previous;
	}
};

const app = appWithOrigins(`${ALLOWED},${ALSO_ALLOWED}`);

const get = (path: string, origin?: string) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			headers: origin ? { origin } : {},
		}),
	);

const preflight = (path: string, origin: string) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			method: "OPTIONS",
			headers: {
				origin,
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type",
			},
		}),
	);

describe("cors", () => {
	test("echoes a configured origin and allows credentials", async () => {
		const response = await get("/auth/me", ALLOWED);

		expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
		// Without this the browser silently drops the session cookie.
		expect(response.headers.get("access-control-allow-credentials")).toBe("true");
	});

	test("echoes each configured origin independently", async () => {
		const second = await get("/auth/me", ALSO_ALLOWED);

		expect(second.headers.get("access-control-allow-origin")).toBe(ALSO_ALLOWED);
		expect(second.headers.get("access-control-allow-credentials")).toBe("true");
	});

	test("does not reflect an origin that is not allowlisted", async () => {
		const response = await get("/auth/me", NOT_ALLOWED);

		// The browser then blocks the *response* from script. The request still
		// reaches the server, which is why this is not an authorisation control.
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	});

	test("answers the preflight so the browser accepts the request", async () => {
		const response = await preflight("/analyses", ALLOWED);

		expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
		expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
	});

	test("withholds the preflight headers from an origin that is not allowlisted", async () => {
		const response = await preflight("/analyses", NOT_ALLOWED);

		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	});

	test("varies on Origin so a shared cache cannot cross-serve allow-echo", async () => {
		// Without `Vary`, a cache could hand one origin's exact-echo header to
		// another origin, which is a real cross-origin data leak.
		const response = await get("/auth/me", ALLOWED);

		expect(response.headers.get("vary")).toContain("Origin");
	});

	test("tolerates whitespace and quotes-free entries in CORS_ORIGINS", async () => {
		// A CRLF `.env` or a hand-edited comma list leaves stray spaces; if those
		// were not trimmed the allowlist would silently stop matching the browser
		// and every cross-origin request would fail at once.
		const spaced = appWithOrigins(` ${ALLOWED} , ${ALSO_ALLOWED} `);

		const response = await spaced.handle(
			new Request("http://localhost/auth/me", { headers: { origin: ALLOWED } }),
		);

		expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
	});

	test("ignores a wildcard because it is incompatible with credentials", async () => {
		// The spec forbids `*` together with `Allow-Credentials: true`, and the
		// browser rejects the pair. A wildcard is dropped at parse time so it
		// cannot end up half-honoured.
		const wildcard = appWithOrigins("*");

		const response = await wildcard.handle(
			new Request("http://localhost/auth/me", { headers: { origin: NOT_ALLOWED } }),
		);

		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("sends no CORS headers when the request has no Origin", async () => {
		// A same-origin or server-to-server call has no `Origin`; there is nothing
		// to allow and nothing to leak.
		const response = await get("/auth/me");

		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	});

	test("keeps the baseline hardening headers on a cross-origin response", async () => {
		const response = await get("/auth/me", ALLOWED);

		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
	});
});
