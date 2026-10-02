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
 */
export const isDevIdentityAllowed = () =>
	!isHostedRuntime() || flag(process.env.ALLOW_DEV_AUTH);

export const useSecureCookies = () => isHostedRuntime();
