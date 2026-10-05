/**
 * Reads a boolean env flag.
 *
 * Trimmed and case-insensitive on purpose: a `.env` saved with Windows line
 * endings yields `"true\r"`, which an exact comparison would read as unset. For
 * `ALLOW_DEV_AUTH` that mistake runs in the safe direction, but the same class
 * of bug silently disabling something else would not.
 */
const flag = (value: string | undefined) => {
	const normalized = value?.trim().toLowerCase();
	return normalized === "true" || normalized === "1";
};

/**
 * True on the deployed VPS, where the process has no ambient credentials and
 * every request must authenticate for itself.
 */
export const isHostedRuntime = () =>
	process.env.DEPLOY_RUNTIME?.trim() === "vps" ||
	process.env.NODE_ENV?.trim() === "production";

/**
 * Guest/local convenience identity. Never enable this on a public deployment:
 * it hands every caller the same account.
 *
 * Both conditions must hold, and that conjunction is the whole point:
 *
 *   - `ALLOW_DEV_AUTH` must be explicitly set, and
 *   - the runtime must not be the hosted VPS.
 *
 * This was previously `!isHostedRuntime() || flag(ALLOW_DEV_AUTH)`, which is an
 * OR, so on any non-hosted runtime the left side was already true and the flag
 * could only ever *add* the shared identity -- never remove it. The practical
 * effect was that `ALLOW_DEV_AUTH` unset meant dev auth ON for every developer
 * machine, and any integration test asserting that an anonymous request gets a
 * 401 was asserting something the server could not do.
 *
 * The order of the terms matters for the same reason: a hosted runtime must not
 * be talked out of it by the flag, so the AND cannot be short-circuited into an
 * OR by a well-meaning refactor.
 */
export const isDevIdentityAllowed = () =>
	flag(process.env.ALLOW_DEV_AUTH) && !isHostedRuntime();

export const useSecureCookies = () => isHostedRuntime();
