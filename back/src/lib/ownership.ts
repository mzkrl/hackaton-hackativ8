import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { analyses, projects, sequences } from "../db/schema";
import { ApiError } from "./api-error";
import type { Principal } from "./current-user";

/**
 * The column a principal is matched against.
 *
 * A user owns rows through `projects.user_id`; a guest owns them through
 * `projects.guest_id`. The two are mutually exclusive by construction — a
 * project is created by exactly one principal — so the check is a simple
 * column pick rather than a union.
 */
const ownerColumn = (principal: Principal) =>
	principal.kind === "guest" ? projects.guestId : projects.userId;

export const assertProjectOwner = async (
	projectId: string,
	principal: Principal,
): Promise<void> => {
	const [project] = await getDb()
		.select({ id: projects.id })
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(ownerColumn(principal), principal.id)))
		.limit(1);

	if (!project) {
		throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
	}
};

export const findOwnedSequence = async (sequenceId: string, principal: Principal) => {
	const [row] = await getDb()
		.select({ sequence: sequences })
		.from(sequences)
		.innerJoin(projects, eq(sequences.projectId, projects.id))
		.where(and(eq(sequences.id, sequenceId), eq(ownerColumn(principal), principal.id)))
		.limit(1);

	if (!row) {
		throw new ApiError(404, "SEQUENCE_NOT_FOUND", "Sequence not found.");
	}

	return row.sequence;
};

export const findOwnedSequenceByObjectKey = async (
	objectKey: string,
	principal: Principal,
) => {
	const [row] = await getDb()
		.select({ sequence: sequences })
		.from(sequences)
		.innerJoin(projects, eq(sequences.projectId, projects.id))
		.where(
			and(eq(sequences.objectKey, objectKey), eq(ownerColumn(principal), principal.id)),
		)
		.limit(1);

	if (!row) {
		throw new ApiError(404, "OBJECT_NOT_FOUND", "Stored object not found.");
	}

	return row.sequence;
};

export const findOwnedAnalysis = async (
	analysisId: string,
	principal: Principal,
) => {
	const [row] = await getDb()
		.select({ analysis: analyses })
		.from(analyses)
		.innerJoin(sequences, eq(analyses.sequenceId, sequences.id))
		.innerJoin(projects, eq(sequences.projectId, projects.id))
		.where(and(eq(analyses.id, analysisId), eq(ownerColumn(principal), principal.id)))
		.limit(1);

	if (!row) {
		throw new ApiError(404, "ANALYSIS_NOT_FOUND", "Analysis not found.");
	}

	return row.analysis;
};
