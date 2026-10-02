import { decodeBase64Url, encodeBase64Url } from "./base64url";
import { useSecureCookies } from "./runtime";

export const SESSION_COOKIE = "gia_session";

const TOKEN_VERSION = "v1";
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

type SessionPayload = {
	sub: string;
	exp: number;
};

const sessionSecret = () => process.env.AUTH_SECRET?.trim() ?? "";

export const isAuthConfigured = () =>
	sessionSecret().length >= MIN_SECRET_LENGTH;

const signingKey = () =>
	crypto.subtle.importKey(
		"raw",
		encoder.encode(sessionSecret()),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);

const ttlSeconds = () => {
	const configured = Number(
		process.env.SESSION_TTL_SECONDS?.trim() || DEFAULT_TTL_SECONDS,
	);
	return Number.isInteger(configured) && configured > 0
		? configured
		: DEFAULT_TTL_SECONDS;
};

export const signSession = async (userId: string): Promise<string> => {
	if (!isAuthConfigured()) {
		throw new Error("AUTH_SECRET must be set to at least 32 characters");
	}

	const payload: SessionPayload = {
		sub: userId,
		exp: Math.floor(Date.now() / 1000) + ttlSeconds(),
	};

	const body = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
	const key = await signingKey();
	const signature = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
	);

	return `${TOKEN_VERSION}.${body}.${encodeBase64Url(signature)}`;
};

/**
 * Returns the user id when the token is authentic and unexpired, otherwise null.
 *
 * Any failure is a null rather than a throw: a caller with a broken cookie is
 * simply unauthenticated, and the signature is checked with `subtle.verify`
 * instead of a hand-rolled comparison so it does not leak by timing.
 */
export const verifySession = async (
	token: string | undefined,
): Promise<string | null> => {
	if (!token || !isAuthConfigured()) {
		return null;
	}

	const parts = token.split(".");
	if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
		return null;
	}

	const [, body, signature] = parts;

	try {
		const key = await signingKey();
		const authentic = await crypto.subtle.verify(
			"HMAC",
			key,
			decodeBase64Url(signature),
			encoder.encode(body),
		);

		if (!authentic) {
			return null;
		}

		const payload = JSON.parse(
			new TextDecoder().decode(decodeBase64Url(body)),
		) as SessionPayload;

		if (typeof payload.sub !== "string" || payload.sub.length === 0) {
			return null;
		}

		if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
			return null;
		}

		return payload.sub;
	} catch {
		return null;
	}
};

export const readCookie = (request: Request, name: string): string | undefined => {
	const header = request.headers.get("cookie");
	if (!header) {
		return undefined;
	}

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) {
			continue;
		}
		if (part.slice(0, separator).trim() === name) {
			return decodeURIComponent(part.slice(separator + 1).trim());
		}
	}

	return undefined;
};

/**
 * `Lax` is correct and the default, but it is only sent on a cross-origin request
 * when the frontend and the API are on the *same site* — that means different
 * subdomains of one registrable domain, such as `app.example.com` and
 * `api.example.com`. Point the frontend at an unrelated site and the browser
 * drops the cookie on every `fetch`, which looks exactly like a silent logout.
 *
 * For a genuinely cross-site API, set `COOKIE_SAME_SITE=none`. Browsers reject
 * `SameSite=None` without `Secure`, so that combination is enforced here rather
 * than left to fail invisibly in the browser.
 */
const sameSite = (): "Lax" | "None" =>
	process.env.COOKIE_SAME_SITE?.trim().toLowerCase() === "none" ? "None" : "Lax";

const cookieAttributes = (maxAgeSeconds: number) => {
	const secure = useSecureCookies() || sameSite() === "None";

	return [
		"Path=/",
		"HttpOnly",
		`SameSite=${sameSite()}`,
		`Max-Age=${maxAgeSeconds}`,
		...(secure ? ["Secure"] : []),
	].join("; ");
};

export const sessionCookie = (token: string) =>
	`${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(ttlSeconds())}`;

export const clearedSessionCookie = () =>
	`${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
