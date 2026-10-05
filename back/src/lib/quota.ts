import { and, count, eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { analyses, conversations, projects, sequences } from "../db/schema";
import { ApiError } from "./api-error";
import type { Principal } from "./current-user";

/**
 * Resource quotas for guest sessions.
 *
 * These limits exist because a guest session is free to create and has no
 * accountability beyond a rate limit per IP. Without quotas, a single visitor
 * can fill the database with projects, sequences, and analyses that will never
 * be claimed by a real account.
 *
 * The limits are deliberately generous enough that a legitimate guest doing
 * real work never hits them, but tight enough that abuse is bounded.
 *
 * These are enforced on the server, not the client. The client may show
 * "remaining" counts for UX, but the server is the authority.
 */

export const GUEST_QUOTAS = {
	MAX_PROJECTS: 50,
	MAX_SEQUENCES_PER_PROJECT: 200,
	MAX_ANALYSES_PER_SEQUENCE: 100,
	MAX_CONVERSATIONS_PER_PROJECT: 500,
} as const;

const ownerColumn = (principal: Principal) =>
	principal.kind === "guest" ? projects.guestId : projects.userId;

/**
 * Counts how many projects a principal already owns.
 */
const countProjects = async (principal: Principal): Promise<number> => {
	const [row] = await getDb()
		.select({ value: count() })
		.from(projects)
		.where(eq(ownerColumn(principal), principal.id));

	return row?.value ?? 0;
};

/**
 * Counts how many sequences belong to a project.
 */
const countSequences = async (projectId: string): Promise<number> => {
	const [row] = await getDb()
		.select({ value: count() })
		.from(sequences)
		.where(eq(sequences.projectId, projectId));

	return row?.value ?? 0;
};

/**
 * Counts how many analyses belong to a sequence.
 */
const countAnalyses = async (sequenceId: string): Promise<number> => {
	const [row] = await getDb()
		.select({ value: count() })
		.from(analyses)
		.where(eq(analyses.sequenceId, sequenceId));

	return row?.value ?? 0;
};

/**
 * Counts how many conversations belong to a project.
 */
const countConversations = async (projectId: string): Promise<number> => {
	const [row] = await getDb()
		.select({ value: count() })
		.from(conversations)
		.where(eq(conversations.projectId, projectId));

	return row?.value ?? 0;
};

/**
 * Asserts that a guest can create another project.
 *
 * Throws `ApiError` with code `GUEST_QUOTA_EXCEEDED` if the limit is reached.
 * Users (non-guest) are not subject to quotas.
 */
export const assertCanCreateProject = async (principal: Principal): Promise<void> => {
	if (principal.kind !== "guest") return;

	const current = await countProjects(principal);

	if (current >= GUEST_QUOTAS.MAX_PROJECTS) {
		throw new ApiError(
			422,
			"GUEST_QUOTA_EXCEEDED",
			`Guest sessions are limited to ${GUEST_QUOTAS.MAX_PROJECTS} projects. Sign up to create more.`,
			{ limit: GUEST_QUOTAS.MAX_PROJECTS, current },
		);
	}
};

/**
 * Asserts that a guest can create another sequence in a project.
 */
export const assertCanCreateSequence = async (
	projectId: string,
	principal: Principal,
): Promise<void> => {
	if (principal.kind !== "guest") return;

	const current = await countSequences(projectId);

	if (current >= GUEST_QUOTAS.MAX_SEQUENCES_PER_PROJECT) {
		throw new ApiError(
			422,
			"GUEST_QUOTA_EXCEEDED",
			`Guest sessions are limited to ${GUEST_QUOTAS.MAX_SEQUENCES_PER_PROJECT} sequences per project. Sign up to add more.`,
			{ limit: GUEST_QUOTAS.MAX_SEQUENCES_PER_PROJECT, current },
		);
	}
};

/**
 * Asserts that a guest can create another analysis for a sequence.
 */
export const assertCanCreateAnalysis = async (
	sequenceId: string,
	principal: Principal,
): Promise<void> => {
	if (principal.kind !== "guest") return;

	const current = await countAnalyses(sequenceId);

	if (current >= GUEST_QUOTAS.MAX_ANALYSES_PER_SEQUENCE) {
		throw new ApiError(
			422,
			"GUEST_QUOTA_EXCEEDED",
			`Guest sessions are limited to ${GUEST_QUOTAS.MAX_ANALYSES_PER_SEQUENCE} analyses per sequence. Sign up to add more.`,
			{ limit: GUEST_QUOTAS.MAX_ANALYSES_PER_SEQUENCE, current },
		);
	}
};

/**
 * Asserts that a guest can create another conversation in a project.
 */
export const assertCanCreateConversation = async (
	projectId: string,
	principal: Principal,
): Promise<void> => {
	if (principal.kind !== "guest") return;

	const current = await countConversations(projectId);

	if (current >= GUEST_QUOTAS.MAX_CONVERSATIONS_PER_PROJECT) {
		throw new ApiError(
			422,
			"GUEST_QUOTA_EXCEEDED",
			`Guest sessions are limited to ${GUEST_QUOTAS.MAX_CONVERSATIONS_PER_PROJECT} conversations per project. Sign up to add more.`,
			{ limit: GUEST_QUOTAS.MAX_CONVERSATIONS_PER_PROJECT, current },
		);
	}
};
