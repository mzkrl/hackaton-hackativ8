import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { guestSessions, users } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { newGuestToken, requirePrincipal } from "../lib/current-user";
import {
	dummyPasswordHash,
	hashPassword,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	verifyPassword,
} from "../lib/password";
import { enforce, RATE_LIMITS, requireClientIp } from "../lib/rate-limit";
import {
	clearedSessionCookie,
	isAuthConfigured,
	sessionCookie,
	signSession,
} from "../lib/session";

const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const credentials = t.Object(
	{
		email: t.String({ minLength: 3, maxLength: 254, format: "email" }),
		password: t.String({
			minLength: PASSWORD_MIN_LENGTH,
			maxLength: PASSWORD_MAX_LENGTH,
		}),
	},
	{ additionalProperties: false },
);

const registerBody = t.Object(
	{
		...credentials.properties,
		name: t.String({ minLength: 1, maxLength: 120 }),
	},
	{ additionalProperties: false },
);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const publicUser = (user: typeof users.$inferSelect) => ({
	id: user.id,
	email: user.email,
	name: user.name,
	createdAt: user.createdAt,
});

/**
 * Registration is impossible without a signing key, and silently issuing an
 * unsigned session would be worse than refusing.
 */
const requireAuthConfigured = () => {
	if (!isAuthConfigured()) {
		throw new ApiError(
			503,
			"AUTH_NOT_CONFIGURED",
			"Authentication is not configured on this deployment.",
		);
	}
};

const startSession = async (userId: string) => sessionCookie(await signSession(userId));

const invalidCredentials = () =>
	new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");

export const authRoutes = new Elysia()
	.post(
		"/auth/register",
		async ({ request, body, set, status }) => {
			requireAuthConfigured();

			// Both unauthenticated routes are limited per client address, because
			// there is no user yet to key on. Register is capped tighter than login
			// since a single address creating many accounts is the pattern worth
			// catching early.
			await enforce(RATE_LIMITS.authRegister(), () => requireClientIp(request));

			const email = normalizeEmail(body.email);
			const name = body.name.trim();

			if (name.length === 0) {
				throw new ApiError(422, "VALIDATION_ERROR", "Name cannot be blank.");
			}

			const [existing] = await getDb()
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, email))
				.limit(1);

			if (existing) {
				throw new ApiError(409, "EMAIL_TAKEN", "Email is already registered.");
			}

			const [user] = await getDb()
				.insert(users)
				.values({ email, name, passwordHash: await hashPassword(body.password) })
				.onConflictDoNothing({ target: users.email })
				.returning();

			if (!user) {
				throw new ApiError(409, "EMAIL_TAKEN", "Email is already registered.");
			}

			set.headers["set-cookie"] = await startSession(user.id);
			return status(201, { data: { user: publicUser(user) } });
		},
		{ body: registerBody },
	)
	.post(
		"/auth/login",
		async ({ request, body, set }) => {
			requireAuthConfigured();

			// This is the expensive endpoint: every attempt runs a PBKDF2 verify at
			// 210k iterations, whether or not the address exists. Without a limit
			// login is both a brute-force surface and a way to keep a core busy,
			// so it is capped before any hashing happens.
			await enforce(RATE_LIMITS.authLogin(), () => requireClientIp(request));

			const email = normalizeEmail(body.email);
			const [user] = await getDb()
				.select()
				.from(users)
				.where(eq(users.email, email))
				.limit(1);

			if (!user) {
				// Spend the same work as a real verification so response time does
				// not reveal whether the address is registered.
				await verifyPassword(body.password, await dummyPasswordHash());
				throw invalidCredentials();
			}

			if (!(await verifyPassword(body.password, user.passwordHash))) {
				throw invalidCredentials();
			}

			set.headers["set-cookie"] = await startSession(user.id);
			return { data: { user: publicUser(user) } };
		},
		{ body: credentials },
	)
	.post("/auth/guest", async ({ request, set, status }) => {
		requireAuthConfigured();

		await enforce(RATE_LIMITS.authGuest(), () => requireClientIp(request));

		const id = newGuestToken();
		const expiresAt = new Date(Date.now() + GUEST_SESSION_TTL_SECONDS * 1000);

		await getDb().insert(guestSessions).values({ id, expiresAt });

		set.headers["set-cookie"] = sessionCookie(id);
		return status(201, {
			data: { kind: "guest" as const, id, expiresAt: expiresAt.toISOString() },
		});
	})
	.post("/auth/logout", async ({ set }) => {
		set.headers["set-cookie"] = clearedSessionCookie();
		return { data: { success: true } };
	})
	.get("/auth/me", async ({ request }) => {
		const principal = await requirePrincipal(request);

		if (principal.kind === "guest") {
			const [session] = await getDb()
				.select({ expiresAt: guestSessions.expiresAt })
				.from(guestSessions)
				.where(eq(guestSessions.id, principal.id))
				.limit(1);

			if (!session) {
				throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
			}

			return { data: { kind: "guest" as const, expiresAt: session.expiresAt.toISOString() } };
		}

		const [user] = await getDb()
			.select()
			.from(users)
			.where(eq(users.id, principal.id))
			.limit(1);

		if (!user) {
			throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
		}

		return {
			data: { kind: "user" as const, user: publicUser(user) },
		};
	});
