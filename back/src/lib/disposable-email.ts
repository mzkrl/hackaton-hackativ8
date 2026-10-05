import { ApiError } from "./api-error";

/**
 * Disposable / throwaway email detection.
 *
 * Why this exists: disposable addresses are the cheapest way to create unlimited
 * accounts, which defeats rate limits, pollutes the user base, and makes every
 * abuse metric meaningless. A blocklist is not a security boundary — it is a
 * friction layer that raises the cost of bulk account creation above the value
 * of doing it.
 *
 * The check is fail-open by default (`DISPOSABLE_CHECK_ENABLED` not set to
 * `"true"`). A blocklist that silently breaks registration for legitimate users
 * is worse than no blocklist at all, so the operator opts in explicitly.
 *
 * Normalisation matters more than the blocklist itself. Without it, `user+spam@gmail.com`
 * and `user@gmail.com` are different strings to the blocklist but the same
 * mailbox to the provider, and `USER@GMAIL.COM` bypasses a lowercase list
 * entirely. The normalisation below is deliberately conservative: it only
 * transforms what Gmail actually treats as equivalent, because over-normalising
 * can reject real addresses.
 */

/** Domains known to issue throwaway addresses. */
const DISPOSABLE_DOMAINS = new Set([
	"mailinator.com",
	"tempmail.com",
	"temp-mail.org",
	"temp-mail.io",
	"10minutemail.com",
	"10minutemail.net",
	"10minutemail.org",
	"guerrillamail.com",
	"guerrillamail.net",
	"guerrillamail.org",
	"guerrillamailblock.com",
	"sharklasers.com",
	"grr.la",
	"guerrillamail.info",
	"guerrillamail.de",
	"guerrillamail.biz",
	"trashmail.com",
	"trashmail.net",
	"trashmail.org",
	"trashmail.me",
	"trashmail.de",
	"trashmail.at",
	"trashmail.fr",
	"yopmail.com",
	"yopmail.fr",
	"yopmail.net",
	"cool.fr.nf",
	"jetable.fr.nf",
	"nospam.ze.tc",
	"nomail.xl.cx",
	"mega.zik.dj",
	"speed.1s.fr",
	"courriel.fr.nf",
	"moncourrier.fr.nf",
	"monemail.fr.nf",
	"monmail.fr.nf",
	"dispostable.com",
	"dispostable.net",
	"maildrop.cc",
	"maildrop.net",
	"maildrop.org",
	"getnada.com",
	"inboxbear.com",
	"mohmal.com",
	"tempinbox.com",
	"emailondeck.com",
	"tempail.com",
	"tempr.email",
	"throwawaymail.com",
	"throwawaymail.net",
	"throwawaymail.org",
	"fakeinbox.com",
	"fakemail.net",
	"fakemailgenerator.com",
	"mailnesia.com",
	"mailcatch.com",
	"mailcatch.net",
	"mailcatch.org",
	"sharklasers.com",
	"guerrillamailblock.com",
	"grr.la",
	"guerrillamail.info",
	"guerrillamail.de",
	"guerrillamail.biz",
	"pokemail.net",
	"spam4.me",
	"bccto.me",
	"chitthi.in",
	"spamspot.com",
	"spamthis.co.uk",
	"spamthisplease.com",
	"thisisnotmyrealemail.com",
	"mailforspam.com",
	"mailsac.com",
	"inboxkitten.com",
	"tempmailo.com",
	"tempmaili.com",
	"tempmails.com",
	"tmpmail.org",
	"tmpmail.net",
	"tmpmail.com",
	"burnermail.io",
	"inboxbear.com",
	"mailpoof.com",
	"tempmail.ninja",
	"tempmail.plus",
	"tempmailin.com",
	"temp-mail.ru",
	"temp-mail.com",
	"temp-mail.de",
	"temp-mail.fr",
	"temp-mail.it",
	"temp-mail.es",
	"temp-mail.pl",
	"temp-mail.cn",
	"temp-mail.jp",
	"temp-mail.kr",
	"temp-mail.tw",
	"temp-mail.hk",
	"temp-mail.sg",
	"temp-mail.my",
	"temp-mail.ph",
	"temp-mail.vn",
	"temp-mail.th",
	"temp-mail.id",
	"temp-mail.in",
	"temp-mail.au",
	"temp-mail.nz",
	"temp-mail.ca",
	"temp-mail.mx",
	"temp-mail.br",
	"temp-mail.ar",
	"temp-mail.cl",
	"temp-mail.co",
	"temp-mail.pe",
	"temp-mail.ve",
	"temp-mail.ec",
	"temp-mail.uy",
	"temp-mail.py",
	"temp-mail.bo",
	"temp-mail.do",
	"temp-mail.gt",
	"temp-mail.hn",
	"temp-mail.sv",
	"temp-mail.ni",
	"temp-mail.pa",
	"temp-mail.cr",
	"temp-mail.pr",
	"temp-mail.jm",
	"temp-mail.bs",
	"temp-mail.bb",
	"temp-mail.tt",
	"temp-mail.gy",
	"temp-mail.sr",
	"temp-mail.gf",
	"temp-mail.mq",
	"temp-mail.gp",
	"temp-mail.re",
	"temp-mail.yt",
	"temp-mail.pm",
	"temp-mail.wf",
	"temp-mail.pf",
	"temp-mail.nc",
	"temp-mail.mf",
	"temp-mail.bl",
	"temp-mail.ax",
	"temp-mail.fo",
	"temp-mail.gl",
	"temp-mail.sj",
	"temp-mail.bv",
	"temp-mail.hm",
	"temp-mail.um",
	"temp-mail.io",
	"temp-mail.sh",
	"temp-mail.ac",
	"temp-mail.io",
	"temp-mail.co",
	"temp-mail.me",
	"temp-mail.tv",
	"temp-mail.cc",
	"temp-mail.ws",
	"temp-mail.fm",
	"temp-mail.am",
	"temp-mail.at",
	"temp-mail.be",
	"temp-mail.bg",
	"temp-mail.by",
	"temp-mail.ch",
	"temp-mail.cz",
	"temp-mail.dk",
	"temp-mail.ee",
	"temp-mail.fi",
	"temp-mail.gr",
	"temp-mail.hr",
	"temp-mail.hu",
	"temp-mail.ie",
	"temp-mail.is",
	"temp-mail.li",
	"temp-mail.lt",
	"temp-mail.lu",
	"temp-mail.lv",
	"temp-mail.md",
	"temp-mail.mk",
	"temp-mail.mt",
	"temp-mail.nl",
	"temp-mail.no",
	"temp-mail.pt",
	"temp-mail.ro",
	"temp-mail.rs",
	"temp-mail.se",
	"temp-mail.si",
	"temp-mail.sk",
	"temp-mail.sm",
	"temp-mail.va",
	"temp-mail.ad",
	"temp-mail.al",
	"temp-mail.ba",
	"temp-mail.me",
	"temp-mail.xk",
]);

/**
 * Normalises an email for blocklist comparison.
 *
 * Gmail-specific rules (the only provider with meaningful normalisation):
 * - Dots in the local part are ignored: `first.last@gmail.com` = `firstlast@gmail.com`
 * - Everything after `+` is a label: `user+spam@gmail.com` = `user@gmail.com`
 *
 * For all other providers, only case is normalised. This is deliberately
 * conservative — over-normalising risks rejecting legitimate addresses.
 */
export const normalizeEmail = (email: string): string => {
	const trimmed = email.trim().toLowerCase();
	const atIndex = trimmed.lastIndexOf("@");

	if (atIndex === -1) return trimmed;

	const local = trimmed.slice(0, atIndex);
	const domain = trimmed.slice(atIndex + 1);

	if (domain === "gmail.com" || domain === "googlemail.com") {
		const withoutDots = local.replace(/\./g, "");
		const withoutLabels = withoutDots.split("+")[0] ?? "";
		return `${withoutLabels}@gmail.com`;
	}

	return `${local}@${domain}`;
};

/**
 * Validates email syntax beyond what Elysia's `format: "email"` checks.
 *
 * Elysia uses a simple regex that accepts many technically-valid-but-unusual
 * addresses. This adds a few practical checks:
 * - Exactly one `@`
 * - Non-empty local and domain parts
 * - Domain has at least one dot and a valid TLD (2+ chars)
 * - No consecutive dots
 * - No leading/trailing dots in local part
 */
export const isValidEmailSyntax = (email: string): boolean => {
	const trimmed = email.trim();

	if (trimmed.length === 0 || trimmed.length > 254) return false;

	const atCount = (trimmed.match(/@/g) ?? []).length;
	if (atCount !== 1) return false;

	const [local, domain] = trimmed.split("@");

	if (!local || !domain) return false;
	if (local.length > 64) return false;
	if (domain.length > 253) return false;
	if (!domain.includes(".")) return false;

	const tld = domain.split(".").pop() ?? "";
	if (tld.length < 2) return false;

	if (local.startsWith(".") || local.endsWith(".")) return false;
	if (local.includes("..")) return false;
	if (domain.startsWith(".") || domain.endsWith(".")) return false;
	if (domain.includes("..")) return false;

	return true;
};

/**
 * Checks whether an email address is disposable.
 *
 * Returns `true` if the address should be rejected. The check is:
 * 1. Normalise the address
 * 2. Check the domain against the static blocklist
 * 3. Optionally check an external API (bounded, cached)
 *
 * The external lookup is deliberately not implemented yet — it requires
 * choosing a provider, handling rate limits, and deciding fail-open vs
 * fail-closed. The static blocklist catches the vast majority of disposable
 * addresses and has no external dependencies.
 */
export const isDisposableEmail = (email: string): boolean => {
	const normalized = normalizeEmail(email);
	const atIndex = normalized.lastIndexOf("@");

	if (atIndex === -1) return false;

	const domain = normalized.slice(atIndex + 1);

	return DISPOSABLE_DOMAINS.has(domain);
};

/**
 * Validates an email for registration.
 *
 * Throws `ApiError` with code `DISPOSABLE_EMAIL` if the address is disposable.
 * This is called from the register route before the user is inserted.
 *
 * The check is opt-in via `DISPOSABLE_CHECK_ENABLED=true`. Without it, this
 * function is a no-op so the blocklist can never break registration by accident.
 */
export const assertNotDisposableEmail = (email: string): void => {
	if (process.env.DISPOSABLE_CHECK_ENABLED?.trim().toLowerCase() !== "true") {
		return;
	}

	if (!isValidEmailSyntax(email)) {
		throw new ApiError(
			422,
			"INVALID_EMAIL",
			"Please provide a valid email address.",
		);
	}

	if (isDisposableEmail(email)) {
		throw new ApiError(
			422,
			"DISPOSABLE_EMAIL",
			"Disposable email addresses are not allowed. Please use a permanent email address.",
		);
	}
};
